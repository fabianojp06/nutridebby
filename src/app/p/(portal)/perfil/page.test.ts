import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ vinculos: 2, documentos: true }));
const blocoIa = vi.hoisted(() => ({ valor: null as null | { situacao: { tipo: string; em?: Date; versao?: string }; podeDecidir: boolean } }));
const blocoNutri = vi.hoisted(() => ({ valor: null as null | { situacao: string; podeDecidir: boolean; podeDesativar: boolean; temConversa: boolean }, retorno: {} as { ok?: string } }));
// o retorno da desativação (useActionState) simulado: no servidor o estado é o inicial
vi.mock('react', async (orig) => {
  const r = await orig<typeof import('react')>();
  const acoes = await import('./actions');
  return { ...r, useActionState: (acao: unknown, inicial: unknown) => [acao === acoes.desativarIaNutriAction ? blocoNutri.retorno : inicial, () => {}, false] };
});
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({
    ctx: {},
    data: { user: { email: 'marina@ex.com' } },
    vinculo: { patientId: 'p1' },
    vinculos: Array.from({ length: estado.vinculos }, (_, i) => ({ tenantId: `t${i}` })),
    tenant: { documentosLiberados: estado.documentos, fuso: 'America/Sao_Paulo' },
  }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/perfil', () => ({ situacaoDoWhatsapp: async () => ({ ativo: false }) }));
vi.mock('@/modules/ia/autorizacao', () => ({ blocoIaDoApp: async () => blocoIa.valor }));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ blocoIaNutriDoApp: async () => blocoNutri.valor }));
vi.mock('./actions', () => ({ meusDadosAction: async () => ({}), exclusaoAction: async () => ({}), whatsappAction: async () => ({}), retirarIaAction: async () => ({}), desativarIaNutriAction: async () => ({}) }));
// no servidor o Instalar não renderiza nada (o estado vem do navegador): o marcador deixa a posição da seção conferida
vi.mock('./instalar-no-eu', () => ({ InstalarNoEu: () => 'Instalar o app' }));
const { default: Eu } = await import('./page');
const eu = (busca: Record<string, string> = {}) => Eu({ searchParams: Promise.resolve(busca) } as never);

describe('/p/perfil — Eu (US-197, molde D-Assuntos)', () => {
  it('na ordem da spec: conta, consultório e "Trocar de nutricionista", meus documentos, notificações, instalar, privacidade com a RN-214, "Como usar o app" e o Sair no fim', async () => {
    blocoIa.valor = null;
    const html = renderToStaticMarkup(await eu());
    const ordem = ['Conectado como marina@ex.com.', 'Consultório Debby', 'Trocar de nutricionista', 'Meus documentos', 'Notificações', 'Instalar o app', 'Privacidade', 'Como usar o app', '>Sair<'];
    const corpo = html.slice(html.indexOf('<main')); // a faixa também diz o nome do consultório
    const posicoes = ordem.map((t) => corpo.indexOf(t));
    expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(html).toContain('Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).');
    expect(html).toMatch(/<a[^>]*href="\/p\/ajuda"[^>]*>Como usar o app<\/a>/);
    expect(html).not.toMatch(/peso/i); // RN-214: nenhuma tela diz que o peso está oculto
  });
  it('um vínculo só: sem "Trocar de nutricionista"; documentos não liberados: sem "Meus documentos"', async () => {
    estado.vinculos = 1;
    estado.documentos = false;
    blocoIa.valor = null;
    const html = renderToStaticMarkup(await eu());
    expect(html).not.toContain('Trocar de nutricionista');
    expect(html).not.toContain('Meus documentos');
  });

  // "Baixar meus dados" também aparece no texto da RN-214 ("…(Baixar meus dados)."): a posição conferida é a do botão
  it('US-106: o bloco "Uso de inteligência artificial (IA)" fica depois do texto da RN-214 e antes de "Baixar meus dados"; sem bloco, nada', async () => {
    blocoIa.valor = { situacao: { tipo: 'nunca' }, podeDecidir: true };
    const html = renderToStaticMarkup(await eu());
    const ordem = ['a critério da sua nutricionista', 'Uso de inteligência artificial (IA)', 'Você ainda não autorizou.', 'Ler e decidir', '>Baixar meus dados</button>'];
    const posicoes = ordem.map((t) => html.indexOf(t));
    expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(html).toMatch(/<a[^>]*href="\/p\/perfil\/ia"[^>]*>Ler e decidir<\/a>/);
    expect(html).not.toContain('Retirar autorização'); // nunca autorizou: nada a retirar
    blocoIa.valor = null;
    expect(renderToStaticMarkup(await eu())).not.toContain('Uso de inteligência artificial');
  });

  it('US-106/US-109: autorizado → "Você autorizou em … (versão …)." e "Retirar autorização"; retirada → "Você retirou…" e "Ler e decidir"; texto novo; retorno do ?ia=', async () => {
    const em = new Date('2026-10-09T15:00:00Z');
    blocoIa.valor = { situacao: { tipo: 'vigente', em, versao: '0.1-provisorio' }, podeDecidir: true };
    let html = renderToStaticMarkup(await eu({ ia: 'autorizou' }));
    expect(html).toContain('Você autorizou em 09/10/2026 (versão 0.1-provisorio).');
    expect(html).toContain('Retirar autorização');
    expect(html).not.toContain('Ler e decidir');
    expect(html).toMatch(/role="status"[^>]*>Autorização registrada\. Você pode retirar quando quiser\.</);
    // a âncora do retorno (#eu-ia, actions.ts e ia/page.tsx) e a região focável (o foco vai para ela ao voltar: anunciada e na vista)
    expect(html).toMatch(/<h3 id="eu-ia"[^>]*>Uso de inteligência artificial \(IA\)<\/h3>/);
    expect(html).toMatch(/<p tabindex="-1" role="status">Autorização registrada\./);
    blocoIa.valor = { situacao: { tipo: 'retirada', em }, podeDecidir: false };
    html = renderToStaticMarkup(await eu());
    expect(html).toContain('Você retirou a autorização em 09/10/2026.');
    expect(html).not.toContain('Ler e decidir'); // a IA não está ativa no consultório: nada a decidir agora
    expect(html).not.toContain('Retirar autorização');
    blocoIa.valor = { situacao: { tipo: 'retirada', em }, podeDecidir: true };
    html = renderToStaticMarkup(await eu());
    expect(html).toMatch(/<a[^>]*href="\/p\/perfil\/ia"[^>]*>Ler e decidir<\/a>/);
    blocoIa.valor = { situacao: { tipo: 'versao_antiga', em, versao: '0.0.9' }, podeDecidir: true };
    html = renderToStaticMarkup(await eu({ ia: 'agora-nao' }));
    expect(html).toContain('O texto da autorização mudou. Leia e decida de novo.');
    expect(html).toContain('Ler e decidir');
    expect(html).toContain('Retirar autorização'); // US-106: retirar sempre possível enquanto houver uma autorização dada
    expect(html).toContain('Tudo bem. Nada muda no seu atendimento.');
    // um ?ia= qualquer não vira texto na tela
    html = renderToStaticMarkup(await eu({ ia: '<b>x</b>' }));
    expect(html).not.toContain('&lt;b&gt;');
    expect(html).not.toContain('Tudo bem.');
  });

  describe('Plano 15 (§7.8, US-177, RN-182): o bloco "IA Nutri" em Eu › Privacidade', () => {
    const vigente = { situacao: 'Você autorizou em 14/10/2026.', podeDecidir: false, podeDesativar: true, temConversa: true };
    it('ao lado do bloco "Uso de inteligência artificial (IA)" e antes de "Baixar meus dados"; sem nada → sem bloco', async () => {
      blocoIa.valor = { situacao: { tipo: 'nunca' }, podeDecidir: true };
      blocoNutri.valor = vigente;
      const html = renderToStaticMarkup(await eu());
      const ordem = ['Uso de inteligência artificial (IA)', '<h3 id="eu-ia-nutri"', 'Você autorizou em 14/10/2026.', '>Baixar meus dados</button>'];
      const posicoes = ordem.map((t) => html.indexOf(t));
      expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
      expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
      expect(html).toMatch(/<section aria-labelledby="eu-ia-nutri"[^>]*><h3 id="eu-ia-nutri"[^>]*>IA Nutri<\/h3>/);
      blocoNutri.valor = null;
      const sem = renderToStaticMarkup(await eu());
      expect(sem).not.toContain('eu-ia-nutri"');
      expect(sem).not.toContain('Desativar a IA Nutri');
    });

    it('Review Focus 5: com o paciente bloqueado (ou consultório desligado, pausa) e o consentimento vigente → "Desativar a IA Nutri e apagar as conversas" e "Ler as conversas"', async () => {
      blocoIa.valor = null;
      blocoNutri.valor = vigente;
      const html = renderToStaticMarkup(await eu());
      expect(html).toMatch(/<button[^>]*>Desativar a IA Nutri e apagar as conversas<\/button>/);
      // `?ler=1`: com o texto mudado (ou depois de desativar com a mensagem de risco guardada), a conversa abre só para ler (revisão da T12, I5)
      expect(html).toMatch(/<a[^>]*href="\/p\/plano\/ia\?ler=1"[^>]*>Ler as conversas<\/a>/);
      expect(html).not.toContain('href="/p/plano/ia/autorizar');
    });

    it('a decidir → "Ler e decidir" para a tela do consentimento, com a origem em Eu', async () => {
      blocoIa.valor = null;
      blocoNutri.valor = { situacao: 'Você ainda não autorizou a IA Nutri.', podeDecidir: true, podeDesativar: false, temConversa: false };
      const html = renderToStaticMarkup(await eu());
      expect(html).toMatch(/<a[^>]*href="\/p\/plano\/ia\/autorizar\?de=eu"[^>]*>Ler e decidir<\/a>/);
      expect(html).not.toContain('Desativar a IA Nutri');
      expect(html).not.toContain('Ler as conversas');
    });

    it('depois de desativar, com o paciente bloqueado: o bloco continua com "Você desativou em …" e a região de status (fora do bloco) com "IA Nutri desativada."', async () => {
      blocoIa.valor = null;
      blocoNutri.valor = { situacao: 'Você desativou em 15/10/2026.', podeDecidir: false, podeDesativar: false, temConversa: false };
      blocoNutri.retorno = { ok: 'IA Nutri desativada.' };
      try {
        const html = renderToStaticMarkup(await eu());
        expect(html).toContain('Você desativou em 15/10/2026.');
        expect(html).toMatch(/<\/section><p tabindex="-1" role="status">IA Nutri desativada\.<\/p>/);
        // mesmo sem o bloco, a confirmação continua na tela (a região é sempre montada)
        blocoNutri.valor = null;
        expect(renderToStaticMarkup(await eu())).toMatch(/<p tabindex="-1" role="status">IA Nutri desativada\.<\/p>/);
      } finally {
        blocoNutri.retorno = {};
      }
    });

    it('os dois botões (retirar a autorização dos exames e desativar a IA Nutri) são diferentes e os dois têm min-h-11 e borda', async () => {
      blocoIa.valor = { situacao: { tipo: 'vigente', em: new Date('2026-10-09T15:00:00Z'), versao: '1.1' }, podeDecidir: true };
      blocoNutri.valor = vigente;
      const html = renderToStaticMarkup(await eu());
      const retirar = /<button([^>]*)>Retirar autorização<\/button>/.exec(html)?.[1];
      const desativar = /<button([^>]*)>Desativar a IA Nutri e apagar as conversas<\/button>/.exec(html)?.[1];
      for (const b of [retirar, desativar]) {
        expect(b).toMatch(/\bmin-h-11\b/);
        expect(b).toMatch(/\bborder\b/);
      }
    });
  });
});
