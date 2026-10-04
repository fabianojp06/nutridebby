import { beforeEach, describe, expect, it, vi } from 'vitest';

const marcarGuia = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => ({ data: { user: { id: 'u1', tema: 'sistema' } } })) }));
vi.mock('@/modules/plataforma/preferencias', async (original) => ({
  ...(await original<typeof import('@/modules/plataforma/preferencias')>()),
  marcarGuia: (...a: unknown[]) => marcarGuia(...a),
}));
const { marcarGuiaAction } = await import('./actions');
const { GUIAS } = await import('@/modules/ajuda/conteudo');

beforeEach(() => marcarGuia.mockReset());

describe('marcarGuiaAction (D27): só os guias que existem, até a versão atual', () => {
  it('guia existente na versão atual (ou menor, aba antiga) grava na conta da sessão', async () => {
    const g = GUIAS[1];
    await marcarGuiaAction(g.id, g.versao, 'visto');
    expect(marcarGuia).toHaveBeenCalledWith('u1', g.id, g.versao, 'visto');
  });
  it.each([
    ['id no formato, mas fora de GUIAS', 'qualquer-coisa', 1],
    ['array (vira texto no regex)', ['agenda'], 1],
    ['versão maior que a do guia', 'agenda', 2],
    ['versão que não é número', 'agenda', '1'],
  ])('%s → nada gravado', async (_n, id, versao) => {
    await marcarGuiaAction(id as string, versao as number, 'visto');
    expect(marcarGuia).not.toHaveBeenCalled();
  });
  // achado 5 do /code-review do PR #12: sem isto, o PreferenciaError do módulo virava 500 (e ruído no Sentry) para quem
  // chamasse a action com um valor qualquer
  it.each([
    ['estado fora de ESTADOS_GUIA', 1, 'apagado'],
    ['estado que não é texto', 1, ['visto']],
    ['versão zero', 0, 'visto'],
    ['versão negativa', -1, 'visto'],
    ['versão fracionária', 0.5, 'visto'],
    ['versão NaN', Number.NaN, 'visto'],
  ])('%s → recusa calada (nem erro, nem gravação)', async (_n, versao, estado) => {
    const g = GUIAS[1];
    await expect(marcarGuiaAction(g.id, versao as number, estado as 'visto')).resolves.toBeUndefined();
    expect(marcarGuia).not.toHaveBeenCalled();
  });
});
