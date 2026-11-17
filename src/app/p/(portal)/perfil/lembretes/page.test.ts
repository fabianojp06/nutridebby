import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LembreteDoPaciente } from '@/modules/lembretes/paciente';

const estado = vi.hoisted(() => ({ lembretes: [] as LembreteDoPaciente[], pausadoEm: null as Date | null, caminho: '' }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async (caminho: string) => {
    estado.caminho = caminho;
    return { ctx: {}, vinculo: { patientId: 'p1' }, tenant: { fuso: 'America/Sao_Paulo' }, data: { user: { id: 'u1' } } };
  },
}));
vi.mock('@/modules/lembretes/paciente', () => ({ meusLembretes: async () => ({ lembretes: estado.lembretes, pausadoEm: estado.pausadoEm }) }));
vi.mock('./actions', () => ({ desligarLembreteAction: async () => ({}), pausarLembretesAction: async () => ({}) }));
const { default: Lembretes } = await import('./page');

const AGUA: LembreteDoPaciente = { id: 'l-agua', tipo: 'agua', resumo: 'Água: das 08:00 às 20:00, a cada 2 h · todos os dias', textoDaNutri: null, desligado: false };
const SUPLEMENTO: LembreteDoPaciente = { id: 'l-sup', tipo: 'suplemento', resumo: 'Suplemento: 08:00 e 20:00 · seg a sex', textoDaNutri: 'Vitamina D', desligado: true };
const pagina = async () => renderToStaticMarkup(await Lembretes());

describe('/p/perfil/lembretes — Eu › Lembretes (Plano 17, §5.3)', () => {
  it('tela de detalhe de Eu: o título, "Voltar para Eu", a introdução, cada lembrete com o resumo, o texto da nutricionista e o interruptor; "Pausar todos os lembretes"', async () => {
    estado.lembretes = [AGUA, SUPLEMENTO];
    estado.pausadoEm = null;
    const html = await pagina();
    expect(estado.caminho).toBe('/p/perfil/lembretes');
    expect(html).toMatch(/<h1[^>]*>Lembretes<\/h1>/);
    expect(html).toContain('Voltar para Eu');
    expect(html).toContain(
      'Sua nutricionista configurou estes lembretes. Você pode desligar qualquer um ou pausar todos; ela vê o que você desligou ou pausou e se as notificações estão ativas.',
    );
    expect(html).toContain('Água: das 08:00 às 20:00, a cada 2 h · todos os dias');
    expect(html).toContain('Suplemento: 08:00 e 20:00 · seg a sex');
    expect(html).toContain('Sua nutricionista: Vitamina D');
    // o interruptor: switch com o nome do resumo e o estado no texto visível ao lado
    expect(html).toMatch(/<button type="button" role="switch" aria-checked="true" aria-labelledby="lembrete-l-agua-resumo"/);
    // T6-02: no suplemento (e no livre) o nome do interruptor leva também o texto da nutricionista
    expect(html).toMatch(/<button type="button" role="switch" aria-checked="false" aria-labelledby="lembrete-l-sup-resumo lembrete-l-sup-texto"/);
    expect(html).toMatch(/<p id="lembrete-l-sup-texto"[^>]*>Sua nutricionista: Vitamina D<\/p>/);
    expect(html).toMatch(/aria-labelledby="lembrete-l-agua-resumo"[ >]/); // água: só o resumo
    expect(html).toMatch(/<p id="lembrete-l-agua-resumo"[^>]*>Água: das 08:00/);
    expect(html).toContain('>Ligado<');
    expect(html).toContain('>Desligado<');
    expect(html).toMatch(/<button type="button"[^>]*>Pausar todos os lembretes<\/button>/);
    expect(html).not.toContain('Lembretes pausados. Você não vai receber avisos até retomar.');
    // a região de status sempre montada (vazia até a primeira mudança)
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
  });

  it('com a pausa ativa: o aviso no topo e "Retomar os lembretes"; os interruptores continuam mostrando Ligado/Desligado', async () => {
    estado.lembretes = [AGUA, SUPLEMENTO];
    estado.pausadoEm = new Date('2026-11-16T12:00:00Z');
    const html = await pagina();
    const aviso = html.indexOf('Lembretes pausados. Você não vai receber avisos até retomar.');
    expect(aviso).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(html.indexOf('Água: das 08:00'));
    expect(html).toMatch(/<button type="button"[^>]*>Retomar os lembretes<\/button>/);
    expect(html).not.toContain('Pausar todos os lembretes');
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    expect(html).toContain('>Ligado<');
  });

  it('o texto da nutricionista e o resumo quebram (nome longo sem espaço não faz a página rolar na horizontal)', async () => {
    estado.lembretes = [{ ...SUPLEMENTO, textoDaNutri: 'Polivitamínico'.repeat(5) }];
    estado.pausadoEm = null;
    const html = await pagina();
    expect(html).toMatch(/<p id="lembrete-l-sup-texto" class="[^"]*\bwrap-break-word\b[^"]*">Sua nutricionista: (Polivitamínico){5}<\/p>/);
    expect(html).toMatch(/<p id="lembrete-l-sup-resumo" class="[^"]*\bwrap-break-word\b/);
  });

  it('sem nenhum lembrete ligado pela equipe: não redireciona (o push antigo abre algo com sentido) — a frase, sem introdução nem interruptores', async () => {
    estado.lembretes = [];
    estado.pausadoEm = null;
    const html = await pagina();
    expect(html).toContain('Sua nutricionista ainda não configurou lembretes para você.');
    expect(html).not.toContain('Sua nutricionista configurou estes lembretes.');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('Pausar todos os lembretes');
  });

  it('T6-02: dois suplementos com o mesmo resumo (Vitamina D e Ômega 3 às 08:00, todos os dias) têm interruptores com nomes diferentes', async () => {
    const resumo = 'Suplemento: 08:00 · todos os dias';
    estado.lembretes = [
      { id: 's1', tipo: 'suplemento', resumo, textoDaNutri: 'Vitamina D', desligado: false },
      { id: 's2', tipo: 'suplemento', resumo, textoDaNutri: 'Ômega 3', desligado: false },
    ];
    estado.pausadoEm = null;
    const html = await pagina();
    expect(html).toContain('aria-labelledby="lembrete-s1-resumo lembrete-s1-texto"');
    expect(html).toContain('aria-labelledby="lembrete-s2-resumo lembrete-s2-texto"');
    expect(html).toContain('<p id="lembrete-s1-texto" class="wrap-break-word">Sua nutricionista: Vitamina D</p>');
    expect(html).toContain('<p id="lembrete-s2-texto" class="wrap-break-word">Sua nutricionista: Ômega 3</p>');
  });
});
