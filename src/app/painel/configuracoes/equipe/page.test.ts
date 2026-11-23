import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Equipe, MembroNaLista } from '@/modules/plataforma/equipe';

// Plano 26 (US-488, §7.2): a tela Equipe com a constante ligada (o teste injeta: no PR 2 ela nasce desligada, RE-D52)
const estado = vi.hoisted(() => ({ ligada: true, equipe: null as unknown as Equipe, chamadas: [] as unknown[][] }));
class NotFound extends Error {}
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound('notFound');
  },
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/modules/plataforma/equipe-textos', async (orig) => ({
  ...(await orig<typeof import('@/modules/plataforma/equipe-textos')>()),
  get EQUIPE_LIGADA() {
    return estado.ligada;
  },
}));
const ctx = { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002' };
vi.mock('@/lib/tenant-session', () => ({
  requireNutri: vi.fn(async (...a: unknown[]) => {
    estado.chamadas.push(a);
    return { ctx, tenant: { fuso: 'America/Sao_Paulo' }, data: { user: { id: ctx.actorUserId } } };
  }),
}));
vi.mock('@/modules/plataforma/equipe', () => ({ listarEquipe: vi.fn(async () => estado.equipe) }));
vi.mock('./actions', () => ({ convidarAction: vi.fn(), reenviarAction: vi.fn(), permissaoAction: vi.fn(), desativarAction: vi.fn(), reativarAction: vi.fn() }));
const { default: EquipePage } = await import('./page');

const ID = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const pessoa = (n: number, o: Partial<MembroNaLista>): MembroNaLista => ({
  id: ID(n), nome: `Pessoa ${n}`, email: `p${n}@ex.com`, financeiro: false, situacao: 'ativo', conviteValeAte: null, desativadaEm: null, ultimoAcessoEm: null, ...o,
});
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await EquipePage({ searchParams: Promise.resolve(sp) } as never));

beforeEach(() => {
  estado.ligada = true;
  estado.chamadas = [];
  estado.equipe = { membros: [], ativas: 0, limiteAtingido: false };
});

describe('/painel/configuracoes/equipe (US-488, §7.2)', () => {
  it('desligada (RE-D52): requireNutri e depois notFound, sem ler a equipe', async () => {
    estado.ligada = false;
    await expect(render()).rejects.toBeInstanceOf(NotFound);
    expect(estado.chamadas).toEqual([['/painel/configuracoes/equipe']]);
  });

  it('h1 "Equipe", a explicação do topo e o formulário "Convidar recepcionista" com a dica e os campos', async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>Equipe<\/h1>/);
    expect(html).toContain('A recepção cuida da agenda e do cadastro dos pacientes. Ela não vê anamnese, medidas, exames, planos, documentos, notas do atendimento, a observação do cadastro nem nada da IA.');
    expect(html).toContain('Convidar recepcionista');
    expect(html).toContain('Convide só quem trabalha para você no consultório. A pessoa vai aceitar um termo de confidencialidade.');
    expect(html).toContain('Permitir acesso ao Controle Financeiro');
    expect(html).toContain('Lançamentos, pagamentos pendentes e relatórios financeiros. As configurações do Financeiro continuam só suas.');
    expect(html).toContain('Enviar convite');
    expect(html).not.toContain('O consultório pode ter até 3 pessoas ativas na recepção.');
  });

  it('no limite, o botão de convidar some e aparece o aviso do limite', async () => {
    estado.equipe = { membros: [1, 2, 3].map((n) => pessoa(n, {})), ativas: 3, limiteAtingido: true };
    const html = await render();
    expect(html).not.toContain('Convidar recepcionista');
    expect(html).not.toContain('Enviar convite');
    expect(html).toMatch(/<p[^>]*id="limite-equipe"[^>]*>O consultório pode ter até 3 pessoas ativas na recepção\.<\/p>/);
  });

  it('as situações, o último acesso e as ações de cada linha, com aria-label pelo nome', async () => {
    estado.equipe = {
      membros: [
        pessoa(1, { nome: 'Dora Reis', situacao: 'convite_enviado', conviteValeAte: new Date('2026-11-20T13:32:00Z') }),
        pessoa(2, { nome: 'Eva Melo', situacao: 'convite_vencido' }),
        pessoa(3, { nome: 'Carla Lima', situacao: 'ativo', financeiro: true, ultimoAcessoEm: new Date('2026-11-17T12:12:00Z') }),
        pessoa(4, { nome: 'Rui Paz', situacao: 'desativado', desativadaEm: new Date('2026-11-17T15:00:00Z'), ultimoAcessoEm: new Date('2026-11-16T12:00:00Z') }),
      ],
      ativas: 3,
      limiteAtingido: true,
    };
    const html = await render();
    expect(html).toContain('Convite enviado (vale até 20/11/2026 às 10:32)');
    expect(html).toContain('Convite vencido');
    expect(html).toContain('Ativo');
    expect(html).toContain('Acesso desativado em 17/11/2026');
    expect(html).toContain('Último acesso: 17/11/2026 às 09:12');
    expect(html).toContain('Último acesso: 16/11/2026 às 09:00');
    expect(html.split('Ainda não entrou').length - 1).toBe(2);
    expect(html).toContain('aria-label="Reenviar convite Dora Reis"');
    expect(html).toContain('aria-label="Reenviar convite Eva Melo"');
    expect(html).not.toContain('aria-label="Reenviar convite Carla Lima"');
    expect(html).toContain('aria-label="Salvar permissão Carla Lima"');
    expect(html).toContain('aria-label="Desativar Carla Lima"');
    expect(html).toContain('aria-label="Reativar Rui Paz"');
    expect(html).not.toContain('aria-label="Desativar Rui Paz"');
    // a tabela fica numa região rolável e focável (§7.2), com as 6 colunas
    expect(html).toMatch(/<div[^>]*role="region"[^>]*tabindex="0"/);
    for (const c of ['Nome', 'E-mail', 'Situação', 'Financeiro', 'Último acesso', 'Ações']) expect(html).toContain(`>${c}</th>`);
  });

  it.each([
    ['convidada', 'Convite enviado.'],
    ['reenviado', 'Convite reenviado.'],
    ['permissao', 'Permissão atualizada.'],
    ['desativada', 'Acesso desativado.'],
    ['reativada', 'Acesso reativado.'],
  ])('?ok=%s: a região de aviso diz "%s"', async (ok, texto) => {
    expect(await render({ ok, r: 'abcdef12' })).toContain(texto);
  });

  it('?ok= fora da lista e ?erro= fora da lista: nada', async () => {
    const html = await render({ ok: 'outro', erro: 'outro' });
    for (const t of ['Convite enviado.', 'Acesso desativado.', 'A senha já foi criada']) expect(html).not.toContain(t);
  });

  it('revisão da P26-07: ?erro=limite com o limite atingido — o texto aparece uma vez só (o aviso fixo)', async () => {
    estado.equipe = { membros: [1, 2, 3].map((n) => pessoa(n, {})), ativas: 3, limiteAtingido: true };
    const html = await render({ erro: 'limite', r: 'abcdef12' });
    expect(html.split('O consultório pode ter até 3 pessoas ativas na recepção.').length - 1).toBe(1);
    expect(html).toContain('id="limite-equipe"');
  });

  it('revisão da P26-07: o e-mail quebra só no fim (break-words, min-w-48) e o cabeçalho "E-mail" não quebra; a caixa do Financeiro tem 44 px', async () => {
    estado.equipe = { membros: [pessoa(1, { email: 'uma.pessoa.com.email.comprido@consultorio.exemplo.com.br' })], ativas: 1, limiteAtingido: false };
    const html = await render();
    expect(html).toMatch(/<td class="min-w-48 px-2 py-2 break-words">uma\.pessoa/);
    expect(html).toMatch(/<th scope="col" class="[^"]*whitespace-nowrap[^"]*">E-mail<\/th>/);
    expect(html).toMatch(/<label class="grid min-h-11 min-w-11[^"]*place-items-center"><input form="permissao-/);
  });

  it.each([
    ['ja_tem_senha', 'A senha já foi criada. Se a pessoa esqueceu, use &quot;Esqueci minha senha&quot;.'],
    ['conta_suspensa', 'Conta suspensa: não é possível convidar agora.'],
    ['limite', 'O consultório pode ter até 3 pessoas ativas na recepção.'],
  ])('?erro=%s: o aviso de erro da spec', async (erro, texto) => {
    expect(await render({ erro, r: 'abcdef12' })).toContain(texto);
  });
});
