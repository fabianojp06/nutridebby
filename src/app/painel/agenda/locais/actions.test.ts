import { beforeEach, describe, expect, it, vi } from 'vitest';

const chamadas = vi.hoisted(() => ({ erro: null as Error | null }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => ({ ctx: { tenantId: 't', role: 'nutri' } }) }));
vi.mock('@/modules/agenda/locais', async (original) => {
  const real = await original<typeof import('@/modules/agenda/locais')>();
  const acao = async () => {
    if (chamadas.erro) throw chamadas.erro;
  };
  return { ...real, salvarLocal: async () => (await acao(), { id: 'x' }), definirPrincipal: acao, arquivarLocal: acao, reativarLocal: acao, excluirLocal: acao };
});
const { LocalError } = await import('@/modules/agenda/locais');
const { MSG_LOCAIS } = await import('@/modules/agenda/constantes');
const actions = await import('./actions');

const destino = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { url?: string }).url;
  }
  throw new Error('esperava redirect');
};
const ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  chamadas.erro = null;
});

describe('volta das ações de Locais (RNF-401: marcador `r` para anunciar de novo e levar o foco ao h1)', () => {
  it('cada volta leva ok ou erro e um marcador novo de 8 hex', async () => {
    const a = await destino(actions.arquivarLocalAction(ID));
    const b = await destino(actions.arquivarLocalAction(ID));
    expect(a).toMatch(/^\/painel\/agenda\/locais\?ok=arquivado&r=[0-9a-f]{8}$/);
    expect(b).toMatch(/^\/painel\/agenda\/locais\?ok=arquivado&r=[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(await destino(actions.definirPrincipalAction(ID))).toMatch(/\?ok=salvo&r=[0-9a-f]{8}$/);
    expect(await destino(actions.reativarLocalAction(ID))).toMatch(/^\/painel\/agenda\/locais\?arquivados=1&ok=reativado&r=[0-9a-f]{8}$/);
    expect(await destino(actions.excluirLocalAction(ID, false))).toMatch(/^\/painel\/agenda\/locais\?ok=excluido&r=[0-9a-f]{8}$/);
    expect(await destino(actions.salvarLocalAction(null, {}, new FormData()))).toMatch(/^\/painel\/agenda\/locais\?ok=salvo&r=[0-9a-f]{8}$/);
  });

  it('erro de LocalError volta pela chave fixa, também com marcador; o formulário devolve erros e valores sem redirecionar', async () => {
    chamadas.erro = new LocalError({ geral: MSG_LOCAIS.principalNaoArquiva });
    expect(await destino(actions.arquivarLocalAction(ID))).toMatch(/^\/painel\/agenda\/locais\?erro=principalNaoArquiva&r=[0-9a-f]{8}$/);
    chamadas.erro = new LocalError({ nome: MSG_LOCAIS.nomeTamanho });
    const fd = new FormData();
    fd.set('nome', 'A');
    expect(await actions.salvarLocalAction(null, {}, fd)).toEqual({ erros: { nome: MSG_LOCAIS.nomeTamanho }, valores: { nome: 'A' } });
  });
});
