import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// S-5 (débitos pré-go-live): "Entrar (já sou paciente)" leva o consultório (?v=) — com 2+ vínculos, abre a agenda do
// consultório desta página, não o do cookie.
const carregar = vi.hoisted(() => vi.fn());
vi.mock('@/modules/agenda/agendamento-publico', () => ({ carregarPaginaPublica: carregar }));
// Plano 23 (T4): o formulário de verdade (escolha do local e horários); só o widget do Turnstile fica de fora
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => null }));
vi.mock('@/env', () => ({ getEnv: () => ({ TURNSTILE_SITE_KEY: 'k' }) }));

const { default: PaginaPublica } = await import('./page');

const CONSULTORIO = '11111111-1111-4111-8111-111111111111';
const CENTRO = '22222222-2222-4222-8222-222222222222';
const ATIVA = {
  estado: 'ativa',
  tenantId: '0b6f4a52-6c63-4a39-9d52-6a3b8a0e1f11',
  nome: 'Debby Silva',
  cabecalho: { nome: 'Debby Silva', crn: null as string | null },
  locais: [{ id: CONSULTORIO, nome: 'Consultório', tipo: 'presencial', cidade: 'Santos', endereco: null }],
  localInicial: CONSULTORIO as string | null,
  semana: '2026-10-12',
  primeira: '2026-10-12',
  ultima: '2026-12-01',
  horarios: [] as unknown[],
};
const horario = (hora: string, localId: string) => ({ inicio: `2026-10-15T${hora}:00.000Z`, dia: 'qui., 15/10', data: '2026-10-15', hora, modalidades: ['presencial'], localId });
const render = async (searchParams: Record<string, string> = {}) =>
  renderToStaticMarkup(await PaginaPublica({ params: Promise.resolve({ slug: 'debby' }), searchParams: Promise.resolve(searchParams) } as never));
/** A tag `<input …>` do rádio com este valor. */
const radio = (html: string, valor: string) => new RegExp(`<input[^>]*value="${valor}"[^>]*>`).exec(html)?.[0] ?? '';

beforeEach(() => carregar.mockReset());

describe('/n/[slug]: "Entrar (já sou paciente)"', () => {
  it('vai a /p/agenda com o consultório da página (?v=)', async () => {
    carregar.mockResolvedValue(ATIVA);
    const html = await render();
    expect(html).toContain(`href="/p/agenda?v=${ATIVA.tenantId}"`);
    expect(html).toContain('Entrar (já sou paciente)');
  });
});

describe('/n/[slug]: Plano 23 (US-403, I-13)', () => {
  it('dois locais: "Onde você quer ser atendido?" com "Nome · Cidade" e o endereço só quando a projeção o traz (Mostrar o endereço); os horários são do local escolhido', async () => {
    carregar.mockResolvedValue({
      ...ATIVA,
      locais: [ATIVA.locais[0], { id: CENTRO, nome: 'Clínica Centro', tipo: 'presencial', cidade: 'Campinas', endereco: 'Av. Central, 500' }],
      localInicial: CENTRO,
      horarios: [horario('08:00', CONSULTORIO), horario('09:00', CENTRO)],
    });
    const html = await render({ local: CENTRO });
    expect(html).toContain('Onde você quer ser atendido?');
    expect(html).toContain('Consultório · Santos');
    expect(html).toContain('Clínica Centro · Campinas');
    expect(html).toContain('Av. Central, 500');
    expect(radio(html, CENTRO)).toContain('checked');
    expect(radio(html, CONSULTORIO)).not.toContain('checked');
    expect(html).toContain('09:00');
    expect(html).not.toContain('08:00'); // o horário do outro local fica fora até trocar o local
    expect(carregar).toHaveBeenCalledWith('debby', expect.objectContaining({ local: CENTRO }));
  });

  it('um local só: sem a escolha (o local vai num campo escondido)', async () => {
    carregar.mockResolvedValue({ ...ATIVA, horarios: [horario('08:00', CONSULTORIO)] });
    const html = await render();
    expect(html).not.toContain('Onde você quer ser atendido?');
    expect(html).toMatch(new RegExp(`<input type="hidden" name="localId" value="${CONSULTORIO}"`));
    expect(html).toContain('08:00');
  });

  it('cabeçalho: "{nome} · Nutricionista · {CRN}"; sem CRN, "{nome} · Nutricionista"', async () => {
    carregar.mockResolvedValue({ ...ATIVA, cabecalho: { nome: 'Débora Silva Lima', crn: 'CRN-3 12345/P' } });
    expect(await render()).toContain('Débora Silva Lima · Nutricionista · CRN-3 12345/P');
    carregar.mockResolvedValue(ATIVA);
    const html = await render();
    expect(html).toContain('Debby Silva · Nutricionista');
    expect(html).not.toContain('Nutricionista ·');
  });
});

describe('/n/[slug]: Plano 23 (RN-429, AG-D21): ponto de coleta', () => {
  const FRASE =
    'Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede (IP) do seu aparelho só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados depois de 24 horas, na limpeza diária.';
  it('com a chave dos pedidos ligada, a frase aparece antes de enviar; desligada, não', async () => {
    carregar.mockResolvedValue({ ...ATIVA, confirmarPedidos: true, horarios: [horario('08:00', CONSULTORIO)] });
    const html = await render();
    expect(html).toContain(FRASE);
    expect(html.indexOf(FRASE)).toBeLessThan(html.indexOf('Enviar código'));
    carregar.mockResolvedValue({ ...ATIVA, confirmarPedidos: false, horarios: [horario('08:00', CONSULTORIO)] });
    expect(await render()).not.toContain(FRASE);
  });
});

describe('/n/[slug]: Plano 23 (revisão da T7, RN-429): ponto de coleta também na etapa do código', () => {
  const FRASE = 'Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede (IP) do seu aparelho só para este pedido.';
  it('a chave que `solicitarCodigo` devolveu ligada → a frase antes de "Confirmar agendamento"; desligada → sem a frase', async () => {
    const { EtapaDoCodigo } = await import('./agendar-form');
    const ligada = renderToStaticMarkup(EtapaDoCodigo({ email: 'ana@ex.com', pontoDeColeta: true, enviando: false }));
    expect(ligada).toContain(FRASE);
    expect(ligada.indexOf(FRASE)).toBeLessThan(ligada.indexOf('Confirmar agendamento'));
    expect(ligada).toContain('Enviamos um código de 6 dígitos para ana@ex.com');
    expect(renderToStaticMarkup(EtapaDoCodigo({ email: 'ana@ex.com', pontoDeColeta: false, enviando: false }))).not.toContain(FRASE);
  });
});
