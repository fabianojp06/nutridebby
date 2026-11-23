import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 26 (RE-D52): com `EQUIPE_LIGADA = false` (o valor do PR 2), toda action da Equipe recusa antes de ler a sessão e
// nada é gravado — o notFound() da página não fecha um POST direto
const estado = vi.hoisted(() => ({ ligada: false }));
class NotFound extends Error {}
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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
const { ctx, requireNutri } = vi.hoisted(() => {
  const ctx = { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002', ip: '203.0.113.9' };
  return { ctx, requireNutri: vi.fn<(caminho: string) => Promise<unknown>>(async () => ({ ctx, tenant: {}, data: { user: { id: ctx.actorUserId } } })) };
});
vi.mock('@/lib/tenant-session', () => ({ requireNutri }));
const modulo = vi.hoisted(() => ({
  convidarRecepcao: vi.fn(async () => ({ membroId: '00000000-0000-4000-8000-000000000101' })),
  reenviarConviteRecepcao: vi.fn(),
  definirPermissaoFinanceiro: vi.fn(),
  desativarRecepcao: vi.fn(),
  reativarRecepcao: vi.fn(),
}));
vi.mock('@/modules/plataforma/equipe', async (orig) => ({ ...(await orig<typeof import('@/modules/plataforma/equipe')>()), ...modulo }));
const { convidarAction, reenviarAction, permissaoAction, desativarAction, reativarAction } = await import('./actions');

const ID = '00000000-0000-4000-8000-000000000101';
const fd = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  estado.ligada = false;
});

describe('actions da Equipe com EQUIPE_LIGADA = false (RE-D52)', () => {
  it.each([
    ['convidar', () => convidarAction({}, fd({ nome: 'Carla Lima', email: 'carla@ex.com', financeiro: 'on' }))],
    ['reenviar', () => reenviarAction(fd({ id: ID }))],
    ['permissão', () => permissaoAction(fd({ id: ID, financeiro: 'on' }))],
    ['desativar', () => desativarAction(fd({ id: ID }))],
    ['reativar', () => reativarAction(fd({ id: ID }))],
  ])('%s: recusa (notFound) sem ler a sessão nem gravar nada', async (_nome, chamar) => {
    await expect(chamar()).rejects.toBeInstanceOf(NotFound);
    expect(requireNutri).not.toHaveBeenCalled();
    for (const f of Object.values(modulo)) expect(f).not.toHaveBeenCalled();
  });
});

describe('actions da Equipe ligada (o teste injeta)', () => {
  beforeEach(() => {
    estado.ligada = true;
  });
  it('convidar: a sessão da nutricionista e os campos do formulário; volta com ?ok=convidada e o marcador', async () => {
    await expect(convidarAction({}, fd({ nome: 'Carla Lima', email: 'carla@ex.com', financeiro: 'on', tenantId: 'outro' }))).rejects.toThrow(
      /^redirect \/painel\/configuracoes\/equipe\?ok=convidada&r=[0-9a-f]{8}$/,
    );
    expect(requireNutri).toHaveBeenCalledWith('/painel/configuracoes/equipe');
    expect(modulo.convidarRecepcao).toHaveBeenCalledWith(ctx, { nome: 'Carla Lima', email: 'carla@ex.com', financeiro: true });
  });
  it('convidar com erro do módulo: devolve os erros por campo e os valores, sem redirect', async () => {
    const { EquipeError } = await import('@/modules/plataforma/equipe');
    modulo.convidarRecepcao.mockRejectedValueOnce(new EquipeError('validacao', { nome: 'Informe o nome (3 a 80 caracteres)' }));
    const r = await convidarAction({}, fd({ nome: 'Ca', email: 'carla@ex.com' }));
    expect(r).toMatchObject({ erros: { nome: 'Informe o nome (3 a 80 caracteres)' }, valores: { nome: 'Ca', email: 'carla@ex.com', financeiro: false } });
  });
  it('desativar: volta com ?ok=desativada, a pessoa (foco na linha) e o marcador', async () => {
    await expect(desativarAction(fd({ id: ID }))).rejects.toThrow(new RegExp(`^redirect /painel/configuracoes/equipe\\?ok=desativada&m=${ID}&r=[0-9a-f]{8}$`));
    expect(modulo.desativarRecepcao).toHaveBeenCalledWith(ctx, ID);
  });
  it('permissão: a caixa marcada vira true; desmarcada, false', async () => {
    await expect(permissaoAction(fd({ id: ID, financeiro: 'on' }))).rejects.toThrow(/ok=permissao/);
    await expect(permissaoAction(fd({ id: ID }))).rejects.toThrow(/ok=permissao/);
    expect(modulo.definirPermissaoFinanceiro.mock.calls).toEqual([[ctx, ID, true], [ctx, ID, false]]);
  });
  it('reativar acima do limite: volta com ?erro=limite (sem ok)', async () => {
    const { EquipeError } = await import('@/modules/plataforma/equipe');
    modulo.reativarRecepcao.mockRejectedValueOnce(new EquipeError('limite', { geral: 'O consultório pode ter até 3 pessoas ativas na recepção.' }));
    await expect(reativarAction(fd({ id: ID }))).rejects.toThrow(new RegExp(`^redirect /painel/configuracoes/equipe\\?erro=limite&m=${ID}&r=[0-9a-f]{8}$`));
  });
  it('pessoa não encontrada: notFound', async () => {
    const { EquipeError } = await import('@/modules/plataforma/equipe');
    modulo.reenviarConviteRecepcao.mockRejectedValueOnce(new EquipeError('nao_encontrado', { geral: 'x' }));
    await expect(reenviarAction(fd({ id: ID }))).rejects.toBeInstanceOf(NotFound);
  });
});
