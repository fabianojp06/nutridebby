import { beforeEach, describe, expect, it, vi } from 'vitest';

// As ações de IA do app (US-106/US-109): só a costura (sessão, origem da requisição, retorno). As regras de autorizarNoApp
// e retirarNoApp (D10, RN-107, RN-108) têm os testes delas em src/modules/ia, contra o Postgres.
const s = vi.hoisted(() => ({
  ctx: { tenantId: 't1', role: 'paciente', patientId: 'p1', actorUserId: 'u1' } as Record<string, unknown>,
  autorizar: vi.fn(),
  retirar: vi.fn(),
  desativarNutri: vi.fn(),
  semProvedor: false,
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
  getEnv: () => ({ APP_URL: 'http://app.test', TRUSTED_PROXIES: [], IA_PROVEDOR: s.semProvedor ? undefined : 'sandbox', IA_RETENCAO_ZERO: '1', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }),
}));
vi.mock('@/modules/ia/autorizacao', async (orig) => ({
  AutorizacaoError: (await orig<typeof import('@/modules/ia/autorizacao')>()).AutorizacaoError,
  autorizarNoApp: s.autorizar,
  retirarNoApp: s.retirar,
}));
vi.mock('@/modules/ia/nutri-paciente/consentimento', () => ({ desativarNoApp: s.desativarNutri }));
// Plano 23 (T10, US-414): o bloco do aniversário — só a costura; as regras (trava, menor, CS-404) em aniversarios.test.ts
const aniv = vi.hoisted(() => ({ autorizar: vi.fn(), retirar: vi.fn() }));
vi.mock('@/modules/agenda/aniversarios', () => ({ autorizarPeloApp: aniv.autorizar, retirarAutorizacao: aniv.retirar }));
const { AutorizacaoError } = await import('@/modules/ia/autorizacao');
const { MSG_AUTORIZACAO } = await import('@/modules/ia/constantes');
const { textoExibido } = await import('@/modules/ia/textos-legais');
const LIDO = textoExibido('teste');
const { autorizarAniversarioAction, autorizarIaAction, desativarIaNutriAction, retirarAniversarioAction, retirarIaAction } = await import('./actions');

beforeEach(() => {
  s.autorizar.mockReset();
  s.retirar.mockReset();
  s.desativarNutri.mockReset();
  s.revalidados = [];
});

describe('ações de IA em Eu › Privacidade (US-106, US-109)', () => {
  it('"Autorizo…": grava com o destino em uso, o IP e o navegador (RN-107) e volta a Eu com "?ia=autorizou", na âncora do bloco de IA (o retorno fica na vista)', async () => {
    s.autorizar.mockResolvedValue('registrada');
    await expect(autorizarIaAction('t1', LIDO)).rejects.toThrow(/^redirect \/p\/perfil\?ia=autorizou#eu-ia$/);
    expect(s.autorizar).toHaveBeenCalledTimes(1);
    const [ctx, exibido, deps] = s.autorizar.mock.calls[0];
    expect(ctx).toBe(s.ctx);
    // o texto que a página mostrou vai inteiro à conferência de autorizarNoApp (RN-107, revisão da T6)
    expect(exibido).toBe(LIDO);
    expect(deps).toMatchObject({ appUrl: 'http://app.test', ip: '10.9.27.36', userAgent: 'Navegador/1.0', ia: { destino: 'teste' } });
  });

  it('o consultório do texto lido não é o do vínculo aberto (troca em outra aba): nada gravado, volta a Eu', async () => {
    await expect(autorizarIaAction('t2', LIDO)).rejects.toThrow(/^redirect \/p\/perfil$/);
    expect(s.autorizar).not.toHaveBeenCalled();
  });

  it('a IA deixou de estar ativa entre a leitura e o toque (AutorizacaoError): volta a Eu sem o retorno', async () => {
    s.autorizar.mockRejectedValue(new AutorizacaoError({ geral: 'x' }));
    await expect(autorizarIaAction('t1', LIDO)).rejects.toThrow(/^redirect \/p\/perfil$/);
  });

  it('o texto mudou entre a leitura e o toque (deploy, RN-107): nada gravado, volta a /p/perfil/ia para ler o de agora', async () => {
    s.autorizar.mockRejectedValue(new AutorizacaoError({ geral: MSG_AUTORIZACAO.textoMudou }));
    await expect(autorizarIaAction('t1', { ...LIDO, versao: '0.0' })).rejects.toThrow(/^redirect \/p\/perfil\/ia$/);
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

describe('"Desativar a IA Nutri e apagar as conversas" em Eu › Privacidade (US-177, RN-182)', () => {
  it('"IA Nutri desativada." e Eu recarregada; a origem da requisição vai junto; nada a desativar → sem texto', async () => {
    s.desativarNutri.mockResolvedValue('desativada');
    expect(await desativarIaNutriAction()).toEqual({ ok: 'IA Nutri desativada.' });
    const [ctx, deps] = s.desativarNutri.mock.calls[0];
    expect(ctx).toBe(s.ctx);
    expect(deps).toMatchObject({ appUrl: 'http://app.test', ip: '10.9.27.36', userAgent: 'Navegador/1.0' });
    expect(s.revalidados).toEqual(['/p/perfil']);
    s.desativarNutri.mockResolvedValue('nada_a_desativar');
    expect(await desativarIaNutriAction()).toEqual({});
  });

  it('sem IA_PROVEDOR (modo ausente) a desativação NÃO é recusada pela ação (LGPD art. 8º, § 5º; aviso da T7)', async () => {
    s.semProvedor = true;
    try {
      s.desativarNutri.mockResolvedValue('desativada');
      expect(await desativarIaNutriAction()).toEqual({ ok: 'IA Nutri desativada.' });
      expect(s.desativarNutri).toHaveBeenCalledTimes(1);
      expect(s.desativarNutri.mock.calls[0][1]).toMatchObject({ ia: { modo: 'ausente' } });
    } finally {
      s.semProvedor = false;
    }
  });
});

describe('Plano 23 (T10, US-414): mensagem de aniversário em Eu', () => {
  beforeEach(() => {
    aniv.autorizar.mockReset();
    aniv.retirar.mockReset();
  });
  it('"Autorizar": grava pela sessão do paciente e recarrega Eu; "Retirar autorização": o próprio paciente (o id vem da sessão, nunca do formulário)', async () => {
    aniv.autorizar.mockResolvedValue(undefined);
    expect(await autorizarAniversarioAction()).toEqual({});
    expect(aniv.autorizar).toHaveBeenCalledWith(s.ctx);
    aniv.retirar.mockResolvedValue(undefined);
    // nenhum id do formulário chega à ação: o paciente vem da sessão
    expect(await retirarAniversarioAction()).toEqual({});
    expect(aniv.retirar).toHaveBeenCalledWith(s.ctx, 'p1');
    expect(s.revalidados).toEqual(['/p/perfil', '/p/perfil']);
  });
  it('menor de idade (o botão vem desabilitado; o envio forjado é recusado pelo módulo) ou qualquer falha → "Não foi possível salvar. Tente de novo.", sem recarregar', async () => {
    aniv.autorizar.mockRejectedValue(Object.assign(new Error('Menor de idade'), { name: 'AniversarioError' }));
    expect(await autorizarAniversarioAction()).toEqual({ erro: 'Não foi possível salvar. Tente de novo.' });
    aniv.retirar.mockRejectedValue(new Error('conexão caiu'));
    expect(await retirarAniversarioAction()).toEqual({ erro: 'Não foi possível salvar. Tente de novo.' });
    expect(s.revalidados).toEqual([]);
  });
});
