import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MensagemDoPaciente } from '@/modules/ia/nutri-paciente/conversa';
import { MSG_IA_NUTRI, SESSAO_MS } from '@/modules/ia/nutri-paciente/constantes';
import type { EntradaIaNutri } from '@/modules/ia/nutri-paciente/estado';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';

// Só a montagem da página (sessão, entrada, conversa e plano simulados). As regras da entrada (T7) e da projeção fechada
// (T8) têm os testes delas em src/modules/ia/nutri-paciente, contra o Postgres.
const OUTRA = '00000000-0000-4000-8000-0000000000c2';
const s = vi.hoisted(() => ({ entrada: 'conversa' as string, mensagens: [] as unknown[], conversa: 0 }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => {} }),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: { role: 'paciente' }, tenant: { id: 't1', fuso: 'America/Sao_Paulo' }, vinculo: { patientId: 'p1' } }),
}));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ entradaDoPaciente: async () => s.entrada }));
vi.mock('@/modules/ia/nutri-paciente/conversa', () => ({
  conversaDoPaciente: async () => {
    s.conversa += 1;
    return s.mensagens;
  },
}));
vi.mock('@/modules/portal/plano', () => ({
  planoDoPaciente: async () => ({ refeicoes: [{ id: '00000000-0000-4000-8000-0000000000b1', nome: 'Almoço' }] }),
}));
vi.mock('./actions', () => ({
  perguntarAction: async () => ({}),
  enviarANutriAction: async () => ({}),
  avaliarAction: async () => ({}),
  encaminharAction: async () => ({}),
}));
const { default: IaNutri } = await import('./page');
const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await IaNutri({ searchParams: Promise.resolve(busca) } as never));

let n = 0;
const msg = (o: Partial<MensagemDoPaciente>): MensagemDoPaciente => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  criadaEm: new Date(),
  autor: 'paciente',
  texto: null,
  textoFixo: null,
  status: null,
  avaliacao: null,
  duvida: null,
  podeEncaminhar: false,
  rotuloCategoria: null,
  risco: false,
  ...o,
});
const conta = (html: string, t: string) => html.split(t).length - 1;
const entrada = (e: EntradaIaNutri) => void (s.entrada = e);

beforeEach(() => {
  s.entrada = 'conversa';
  s.mensagens = [];
  s.conversa = 0;
});

describe('/p/plano/ia — a conversa (US-172, §7.8, RN-173, RNF-167)', () => {
  it('com conversa: "Sua dúvida" com o contador por aria-describedby, a abertura antes da 1ª mensagem, o rodapé e "Ajudou"/"Não ajudou" em cada resposta, a linha de emergência com tel:, "Voltar para Plano" e os dois botões', async () => {
    const pergunta = msg({ texto: 'Posso trocar o arroz?', status: 'respondida', podeEncaminhar: true });
    const resposta = msg({ autor: 'ia', texto: 'No seu plano, as opções de substituição são:\n• Batata, 150 g' });
    s.mensagens = [pergunta, resposta];
    const html = await pagina();
    const id = /<textarea[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<p id="${id}"[^>]*>0 de 500 caracteres</p>`));
    expect(html).toMatch(/<label for="duvida"[^>]*>Sua dúvida<\/label>/);
    expect(html.indexOf(MSG_IA_NUTRI.avisoInicio)).toBeLessThan(html.indexOf('Posso trocar o arroz?'));
    expect(conta(html, MSG_IA_NUTRI.avisoInicio)).toBe(1); // sessão em curso: só a abertura da 1ª mensagem
    expect(html).toContain(MSG_IA_NUTRI.rodapeResposta);
    expect(html).toMatch(/<button[^>]*>Ajudou<\/button>/);
    expect(html).toMatch(/<button[^>]*>Não ajudou<\/button>/);
    expect(html).toContain('href="tel:192"');
    expect(html).toContain('href="tel:188"');
    expect(html).toContain('Voltar para Plano');
    expect(html).toMatch(/<a [^>]*href="\/p\/plano"/);
    // US-172 (resposta montada): "Enviar para minha nutricionista" abaixo da resposta, não da pergunta
    expect(html.indexOf('>Enviar para minha nutricionista<')).toBeGreaterThan(html.indexOf(MSG_IA_NUTRI.rodapeResposta));
    expect(html).toMatch(/<button[^>]*>Perguntar<\/button>/);
    expect(html).toMatch(/<button[^>]*>Enviar direto para minha nutricionista<\/button>/);
    expect(html).toMatch(/<details class="[^"]*">/); // com mensagens: "Como a IA Nutri funciona" fechado
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toMatch(/<ol[^>]*aria-label="Conversa"/);
    expect(html).toContain('>Você<');
    expect(html).toContain(`>${MSG_IA_NUTRI.autorIa}<`);
    expect(html).toMatch(/<p tabindex="-1" role="status"[^>]*><\/p>/); // a região viva sempre montada, vazia
  });

  it('conversa vazia: a mensagem de abertura antes de perguntar e "Como a IA Nutri funciona" aberto com a explicação', async () => {
    const html = await pagina();
    expect(html).toContain(MSG_IA_NUTRI.avisoInicio);
    expect(html.indexOf(MSG_IA_NUTRI.avisoInicio)).toBeLessThan(html.indexOf('<textarea'));
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>Como a IA Nutri funciona<\/summary>/);
    for (const t of MSG_IA_NUTRI.comoFuncionaTexto.slice(0, 3)) expect(html, t).toContain(t);
    // o summary com 44 px, sem trocar o display (block/flex/grid tiram o marcador ▶/▼ que diz que abre)
    expect(html).toMatch(/<summary class="[^"]*\bmin-h-11\b/);
    expect(html).not.toMatch(/<summary[^>]*class="[^"]*\b(block|flex|grid|inline-flex)\b/);
  });

  it('última mensagem há mais de 30 min: a abertura de novo no fim da lista, antes do campo (RN-173)', async () => {
    const antes = new Date(Date.now() - SESSAO_MS - 60_000);
    s.mensagens = [msg({ texto: 'Que horas é o lanche?', status: 'respondida', criadaEm: antes }), msg({ autor: 'ia', texto: 'No seu plano, o horário é:\n• 16:00', criadaEm: antes })];
    const html = await pagina();
    expect(conta(html, MSG_IA_NUTRI.avisoInicio)).toBe(2);
    expect(html.lastIndexOf(MSG_IA_NUTRI.avisoInicio)).toBeGreaterThan(html.indexOf('16:00'));
    expect(html.lastIndexOf(MSG_IA_NUTRI.avisoInicio)).toBeLessThan(html.indexOf('<textarea'));
  });

  it('"Enviar para minha nutricionista" abaixo de um texto fixo de recusa; nenhum abaixo da resposta de risco (os 188 e 192 viram tel: com 44 px de área de toque)', async () => {
    s.mensagens = [msg({ texto: 'Qual remédio tomo?', status: 'respondida', podeEncaminhar: true }), msg({ autor: 'ia', textoFixo: 'suplemento_ou_remedio' })];
    let html = await pagina();
    expect(html).toContain(TEXTOS_FIXOS.suplemento_ou_remedio);
    expect(conta(html, '>Enviar para minha nutricionista<')).toBe(1);
    s.mensagens = [msg({ texto: 'x', status: 'respondida', risco: true, duvida: 'aberta' }), msg({ autor: 'ia', textoFixo: 'risco_emergencia' })];
    html = await pagina();
    expect(html).toContain('Sinto muito que você esteja passando por isso.');
    expect(html).not.toContain('>Enviar para minha nutricionista<');
    // a pergunta de risco vai à fila sozinha: sem o "Pronto!…" sob ela (só o texto fixo de risco)
    expect(html).not.toContain(MSG_IA_NUTRI.encaminhada);
    // em linha (sem inline-block: a frase não quebra antes do número), com 44 px de área de toque pelo py-3
    for (const tel of ['188', '192']) expect(html).toMatch(new RegExp(`<a href="tel:${tel}" class="[^"]*\\bpy-3\\b[^"]*">${tel}</a>`));
    expect(html).not.toMatch(/<a href="tel:[^"]*" class="[^"]*\binline-(block|flex)\b/);
  });

  it('a pergunta que falhou sem resposta ganha o botão nela; a dúvida aberta mostra "Pronto!…"; a vista, "Sua dúvida foi vista no consultório."', async () => {
    s.mensagens = [msg({ texto: 'Pergunta que falhou', status: 'falhou', podeEncaminhar: true })];
    let html = await pagina();
    expect(html.indexOf('>Enviar para minha nutricionista<')).toBeGreaterThan(html.indexOf('Pergunta que falhou'));
    s.mensagens = [msg({ texto: 'Aberta', status: 'respondida', duvida: 'aberta' }), msg({ texto: 'Vista', status: 'respondida', duvida: 'vista' })];
    html = await pagina();
    expect(html.indexOf(MSG_IA_NUTRI.encaminhada)).toBeGreaterThan(html.indexOf('Aberta'));
    expect(html.indexOf(MSG_IA_NUTRI.encaminhada)).toBeLessThan(html.indexOf('Vista'));
    expect(html).toContain(MSG_IA_NUTRI.duvidaVista);
    expect(conta(html, MSG_IA_NUTRI.encaminhada)).toBe(1);
  });

  it('?sobre=<id de uma refeição do plano> → o campo começa com "Sobre {refeição}: "; texto qualquer ou outra refeição → nada da URL e o campo vazio', async () => {
    let html = await pagina({ sobre: '00000000-0000-4000-8000-0000000000b1' });
    expect(html).toMatch(/<textarea[^>]*>Sobre Almoço: <\/textarea>/);
    html = await pagina({ sobre: 'texto <b>qualquer</b>' });
    expect(html).not.toContain('qualquer');
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
    html = await pagina({ sobre: OUTRA });
    expect(html).not.toContain(OUTRA);
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
  });

  it('sem consentimento → a tela de decisão; texto mudou → a tela com "mudou"', async () => {
    entrada('decidir');
    await expect(pagina()).rejects.toThrow('redirect /p/plano/ia/autorizar?de=plano');
    entrada('texto_mudou');
    await expect(pagina()).rejects.toThrow('redirect /p/plano/ia/autorizar?de=plano&mudou=1');
    expect(s.conversa).toBe(0); // nada lido (nem auditRead) antes do consentimento
  });

  it('sem plano publicado: "A IA Nutri fica disponível quando…" (DP-5)', async () => {
    entrada('sem_plano');
    const html = await pagina();
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${MSG_IA_NUTRI.semPlano}<`));
    expect(html).not.toContain('<textarea');
  });

  it('indisponível (bloqueado, consultório desligado, pausa) ou "nenhuma" com conversa guardada (também sem IA_PROVEDOR): "não está disponível" e a conversa só para ler', async () => {
    for (const e of ['indisponivel', 'nenhuma'] as const) {
      entrada(e);
      s.mensagens = [msg({ texto: 'Guardada', status: 'respondida', podeEncaminhar: true }), msg({ autor: 'ia', texto: 'Resposta guardada' })];
      const html = await pagina();
      expect(html, e).toMatch(new RegExp(`role="status"[^>]*>${MSG_IA_NUTRI.naoDisponivel}<`));
      expect(html, e).toContain('Guardada');
      expect(html, e).toContain('Resposta guardada');
      expect(html, e).not.toContain('<textarea');
      expect(html, e).not.toContain('>Perguntar<');
      // só para ler: sem avaliar nem encaminhar (a função não está disponível)
      expect(html, e).not.toContain('>Ajudou<');
      expect(html, e).not.toContain('>Enviar para minha nutricionista<');
      expect(html, e).not.toContain(MSG_IA_NUTRI.avisoInicio + '</li>'); // sem campo, sem abertura de sessão nova no fim
    }
  });
});
