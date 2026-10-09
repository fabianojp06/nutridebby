import { beforeEach, describe, expect, it, vi } from 'vitest';

// As ações de IA do app (US-106/US-109): só a costura (sessão, origem da requisição, retorno). As regras de autorizarNoApp
// e retirarNoApp (D10, RN-107, RN-108) têm os testes delas em src/modules/ia, contra o Postgres.
const s = vi.hoisted(() => ({
  ctx: { tenantId: 't1', role: 'paciente', patientId: 'p1', actorUserId: 'u1' } as Record<string, unknown>,
  autorizar: vi.fn(),
  retirar: vi.fn(),
  revalidados: [] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: s.ctx }) }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => void s.revalidados.push(p) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'Navegador/1.0' }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));
vi.mock('@/lib/ip', () => ({ clientIp: () => '10.9.27.36' }));
vi.mock('@/env', () => ({
  getEnv: () => ({ APP_URL: 'http://app.test', TRUSTED_PROXIES: [], IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }),
}));
vi.mock('@/modules/ia/autorizacao', async (orig) => ({
  AutorizacaoError: (await orig<typeof import('@/modules/ia/autorizacao')>()).AutorizacaoError,
  autorizarNoApp: s.autorizar,
  retirarNoApp: s.retirar,
}));
const { AutorizacaoError } = await import('@/modules/ia/autorizacao');
const { autorizarIaAction, retirarIaAction } = await import('./actions');

beforeEach(() => {
  s.autorizar.mockReset();
  s.retirar.mockReset();
  s.revalidados = [];
});

describe('ações de IA em Eu › Privacidade (US-106, US-109)', () => {
  it('"Autorizo…": grava com o destino em uso, o IP e o navegador (RN-107) e volta a Eu com "?ia=autorizou"', async () => {
    s.autorizar.mockResolvedValue('registrada');
    await expect(autorizarIaAction('t1')).rejects.toThrow('redirect /p/perfil?ia=autorizou');
    expect(s.autorizar).toHaveBeenCalledTimes(1);
    const [ctx, deps] = s.autorizar.mock.calls[0];
    expect(ctx).toBe(s.ctx);
    expect(deps).toMatchObject({ appUrl: 'http://app.test', ip: '10.9.27.36', userAgent: 'Navegador/1.0', ia: { destino: 'teste' } });
  });

  it('o consultório do texto lido não é o do vínculo aberto (troca em outra aba): nada gravado, volta a Eu', async () => {
    await expect(autorizarIaAction('t2')).rejects.toThrow(/^redirect \/p\/perfil$/);
    expect(s.autorizar).not.toHaveBeenCalled();
  });

  it('a IA deixou de estar ativa entre a leitura e o toque (AutorizacaoError): volta a Eu sem o retorno', async () => {
    s.autorizar.mockRejectedValue(new AutorizacaoError({ geral: 'x' }));
    await expect(autorizarIaAction('t1')).rejects.toThrow(/^redirect \/p\/perfil$/);
  });

  it('"Retirar autorização": "Autorização retirada." e Eu recarregada; nada a retirar → sem texto', async () => {
    s.retirar.mockResolvedValue('retirada');
    expect(await retirarIaAction()).toEqual({ ok: 'Autorização retirada.' });
    expect(s.retirar).toHaveBeenCalledWith(s.ctx, { ip: '10.9.27.36', userAgent: 'Navegador/1.0' });
    expect(s.revalidados).toEqual(['/p/perfil']);
    s.retirar.mockResolvedValue('nada_a_retirar');
    expect(await retirarIaAction()).toEqual({});
  });
});
