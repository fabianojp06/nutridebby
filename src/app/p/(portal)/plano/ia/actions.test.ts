import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// As ações da conversa e do consentimento (US-171, US-172, DP-16): só a costura (sessão, tenant da tela, origem da
// requisição, tradução do código para o texto). As regras de perguntar/avaliar/encaminhar/aceitarNoApp (RN-170, RN-177,
// US-171) têm os testes delas em src/modules/ia/nutri-paciente, contra o Postgres.
const s = vi.hoisted(() => ({
  ctx: { tenantId: 't1', role: 'paciente', patientId: 'p1', actorUserId: 'u1' } as Record<string, unknown>,
  perguntar: vi.fn(),
  enviarANutri: vi.fn(),
  avaliar: vi.fn(),
  encaminhar: vi.fn(),
  aceitar: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: s.ctx }) }));
vi.mock('next/cache', () => ({ revalidatePath: s.revalidatePath }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'Navegador/1.0' }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));
vi.mock('@/lib/ip', () => ({ clientIp: () => '10.9.29.56' }));
vi.mock('@/env', () => ({
  getEnv: () => ({ APP_URL: 'http://app.test', TRUSTED_PROXIES: [], IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }),
  // o pool do getDb() (parâmetro padrão de avaliar/encaminhar) nasce sem conectar: porta fechada — se alguma consulta
  // chegasse ao banco, o teste falharia em vez de passar por acaso
  getServerEnv: () => ({ DATABASE_URL: 'postgres://ninguem@127.0.0.1:1/nada' }),
}));
vi.mock('@/modules/ia/nutri-paciente/conversa', async (orig) => {
  const real = await orig<typeof import('@/modules/ia/nutri-paciente/conversa')>();
  return { perguntar: s.perguntar, enviarANutri: s.enviarANutri, avaliar: s.avaliar, encaminhar: s.encaminhar, real };
});
vi.mock('@/modules/ia/nutri-paciente/consentimento', () => ({ aceitarNoApp: s.aceitar }));
const real = ((await import('@/modules/ia/nutri-paciente/conversa')) as unknown as { real: typeof import('@/modules/ia/nutri-paciente/conversa') }).real;
const { MSG_IA_NUTRI } = await import('@/modules/ia/nutri-paciente/constantes');
const { IaNutriError } = await import('@/modules/ia/nutri-paciente/participacao');
const { textoExibidoIaNutri } = await import('@/modules/ia/textos-legais');
const { aceitarIaNutriAction, avaliarAction, encaminharAction, enviarANutriAction, perguntarAction } = await import('./actions');

const ID = '00000000-0000-4000-8000-0000000000a1';
const fd = (texto: string) => {
  const f = new FormData();
  f.set('texto', texto);
  return f;
};
const PERGUNTA = 'Posso trocar o arroz por batata?';

beforeEach(() => {
  for (const f of [s.perguntar, s.enviarANutri, s.avaliar, s.encaminhar, s.aceitar, s.revalidatePath]) f.mockReset();
  // sem mock específico, avaliar e encaminhar são os de verdade: id/valor fora do formato voltam sem tocar o banco
  s.avaliar.mockImplementation(real.avaliar);
  s.encaminhar.mockImplementation(real.encaminhar);
});

describe('perguntarAction (US-172)', () => {
  it('cada código vira o texto certo; nada da pergunta volta no retorno', async () => {
    const casos = [
      ['limite_dia', MSG_IA_NUTRI.limiteDia],
      ['limite_mes', MSG_IA_NUTRI.limiteMes],
      ['em_andamento', MSG_IA_NUTRI.emAndamento],
      ['indisponivel', MSG_IA_NUTRI.naoDisponivel],
      ['sem_plano', MSG_IA_NUTRI.semPlano],
    ] as const;
    for (const [codigo, texto] of casos) {
      s.perguntar.mockResolvedValueOnce({ codigo, mensagemId: null, textoFixo: null });
      const r = await perguntarAction('t1', fd(PERGUNTA));
      expect(r, codigo).toEqual({ aviso: texto });
      expect(JSON.stringify(r)).not.toContain('arroz');
    }
  });

  it('ok → { limpar: true }; risco gravado → limpa sem texto fixo (a conversa relida o mostra); risco sem mensagem → o texto fixo no retorno; risco sempre com "A resposta chegou." e a marca para o foco ir ao texto fixo (revisão da T12, I1)', async () => {
    s.perguntar.mockResolvedValueOnce({ codigo: 'ok', mensagemId: ID, textoFixo: null });
    expect(await perguntarAction('t1', fd(PERGUNTA))).toEqual({ limpar: true });
    const [ctx, texto, deps] = s.perguntar.mock.calls[0];
    expect(ctx).toBe(s.ctx);
    expect(texto).toBe(PERGUNTA);
    expect(deps).toMatchObject({ appUrl: 'http://app.test', ip: '10.9.29.56', userAgent: 'Navegador/1.0', ia: { destino: 'teste' } });
    s.perguntar.mockResolvedValueOnce({ codigo: 'risco', mensagemId: ID, textoFixo: 'risco_emergencia' });
    expect(await perguntarAction('t1', fd('x'))).toEqual({ limpar: true, textoFixo: null, aviso: MSG_IA_NUTRI.respostaChegou, risco: true });
    s.perguntar.mockResolvedValueOnce({ codigo: 'risco', mensagemId: null, textoFixo: 'risco_emergencia' });
    expect(await perguntarAction('t1', fd('x'))).toEqual({ limpar: true, textoFixo: 'risco_emergencia', aviso: MSG_IA_NUTRI.respostaChegou, risco: true });
  });

  it('a pergunta longa (IaNutriError) volta como aviso; outro erro sobe', async () => {
    s.perguntar.mockRejectedValueOnce(new IaNutriError(MSG_IA_NUTRI.longa));
    expect(await perguntarAction('t1', fd('x'))).toEqual({ aviso: MSG_IA_NUTRI.longa });
    s.perguntar.mockRejectedValueOnce(new Error('boom'));
    await expect(perguntarAction('t1', fd('x'))).rejects.toThrow('boom');
  });

  it('outro consultório na tela (troca de vínculo em outra aba): nada gravado, a tela recarrega', async () => {
    await expect(perguntarAction('t2', fd(PERGUNTA))).rejects.toThrow(/^redirect \/p\/plano\/ia$/);
    expect(s.perguntar).not.toHaveBeenCalled();
  });
});

describe('enviarANutriAction (DP-16)', () => {
  it('encaminhada (também com o limite do dia atingido) → limpa e "Pronto!…"; limite de dúvidas; indisponível; risco', async () => {
    s.enviarANutri.mockResolvedValueOnce({ codigo: 'encaminhada', mensagemId: ID, textoFixo: null });
    expect(await enviarANutriAction('t1', fd(PERGUNTA))).toEqual({ limpar: true, aviso: MSG_IA_NUTRI.encaminhada });
    s.enviarANutri.mockResolvedValueOnce({ codigo: 'limite', mensagemId: null, textoFixo: null });
    expect(await enviarANutriAction('t1', fd(PERGUNTA))).toEqual({ aviso: MSG_IA_NUTRI.limiteDuvidas });
    s.enviarANutri.mockResolvedValueOnce({ codigo: 'indisponivel', mensagemId: null, textoFixo: null });
    expect(await enviarANutriAction('t1', fd(PERGUNTA))).toEqual({ aviso: MSG_IA_NUTRI.naoDisponivel });
    s.enviarANutri.mockResolvedValueOnce({ codigo: 'risco', mensagemId: null, textoFixo: 'sintoma_agudo' });
    expect(await enviarANutriAction('t1', fd('x'))).toEqual({ limpar: true, textoFixo: 'sintoma_agudo', aviso: MSG_IA_NUTRI.respostaChegou, risco: true });
  });
});

describe('avaliarAction e encaminharAction (US-172, US-174)', () => {
  it('avaliar: "Obrigado pela avaliação." com feito; valor ou id fora do formato → "não disponível", sem erro 500', async () => {
    s.avaliar.mockResolvedValueOnce(true);
    expect(await avaliarAction('t1', ID, 'ajudou')).toEqual({ feito: true, aviso: MSG_IA_NUTRI.avaliado });
    expect(await avaliarAction('t1', ID, 'otimo')).toEqual({ aviso: MSG_IA_NUTRI.naoDisponivel });
    expect(await avaliarAction('t1', 'abc', 'ajudou')).toEqual({ aviso: MSG_IA_NUTRI.naoDisponivel });
  });

  it('encaminhar: encaminhada com feito; limite; id fora do formato → "não disponível", sem erro 500', async () => {
    s.encaminhar.mockResolvedValueOnce('encaminhada');
    expect(await encaminharAction('t1', ID)).toEqual({ feito: true, aviso: MSG_IA_NUTRI.encaminhada });
    s.encaminhar.mockResolvedValueOnce('limite');
    expect(await encaminharAction('t1', ID)).toEqual({ aviso: MSG_IA_NUTRI.limiteDuvidas });
    expect(await encaminharAction('t1', 'abc')).toEqual({ aviso: MSG_IA_NUTRI.naoDisponivel });
    // /code-review do PR #37 (RN-170): a conferência do consultório usa a configuração do servidor (a mesma de perguntar)
    const [ctx, id, deps] = s.encaminhar.mock.calls[0];
    expect([ctx, id]).toEqual([s.ctx, ID]);
    expect(deps).toMatchObject({ ia: { modo: 'sandbox', destino: 'teste' }, appUrl: 'http://app.test' });
  });

  it('outro consultório na tela: nada gravado', async () => {
    await expect(avaliarAction('t2', ID, 'ajudou')).rejects.toThrow(/^redirect \/p\/plano\/ia$/);
    await expect(encaminharAction('t2', ID)).rejects.toThrow(/^redirect \/p\/plano\/ia$/);
    expect(s.avaliar).not.toHaveBeenCalled();
    expect(s.encaminhar).not.toHaveBeenCalled();
  });
});

describe('/code-review do PR #37: cada releitura da conversa grava um auditRead', () => {
  it('perguntar e enviar direto revalidam /p/plano/ia uma vez; avaliar e encaminhar, nenhuma', async () => {
    s.perguntar.mockResolvedValueOnce({ codigo: 'ok', mensagemId: ID, textoFixo: null });
    await perguntarAction('t1', fd(PERGUNTA));
    expect(s.revalidatePath.mock.calls).toEqual([['/p/plano/ia']]);
    s.revalidatePath.mockReset();
    s.enviarANutri.mockResolvedValueOnce({ codigo: 'encaminhada', mensagemId: ID, textoFixo: null });
    await enviarANutriAction('t1', fd(PERGUNTA));
    expect(s.revalidatePath.mock.calls).toEqual([['/p/plano/ia']]);
    s.revalidatePath.mockReset();
    s.avaliar.mockResolvedValueOnce(true);
    s.encaminhar.mockResolvedValueOnce('encaminhada');
    await avaliarAction('t1', ID, 'nao_ajudou');
    await encaminharAction('t1', ID);
    expect(s.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('aceitarIaNutriAction (US-171)', () => {
  const LIDO = textoExibidoIaNutri('teste');
  it('aceite → a conversa; o texto que a tela mostrou vai inteiro à conferência', async () => {
    s.aceitar.mockResolvedValueOnce('registrado');
    await expect(aceitarIaNutriAction('t1', LIDO, 'hoje')).rejects.toThrow(/^redirect \/p\/plano\/ia$/);
    const [ctx, exibido, deps] = s.aceitar.mock.calls[0];
    expect(ctx).toBe(s.ctx);
    expect(exibido).toBe(LIDO);
    expect(deps).toMatchObject({ ip: '10.9.29.56', userAgent: 'Navegador/1.0', ia: { destino: 'teste' } });
  });

  it('o texto de outro destino (mudou entre a leitura e o toque) → a tela de decisão de novo, com "mudou"', async () => {
    s.aceitar.mockRejectedValueOnce(new IaNutriError(MSG_IA_NUTRI.textoMudouNoToque));
    await expect(aceitarIaNutriAction('t1', { ...LIDO, destino: 'us' }, 'plano')).rejects.toThrow(/^redirect \/p\/plano\/ia\/autorizar\?de=plano&mudou=1$/);
    s.aceitar.mockRejectedValueOnce(new IaNutriError(MSG_IA_NUTRI.textoMudouNoToque));
    // a origem só da lista fechada: valor livre vira "plano"
    await expect(aceitarIaNutriAction('t1', LIDO, 'https://fora')).rejects.toThrow(/^redirect \/p\/plano\/ia\/autorizar\?de=plano&mudou=1$/);
  });

  it('paciente bloqueado, consultório desligado ou pausa (naoDisponivel) → /p/plano?ia-nutri=indisponivel (nunca um redirect mudo)', async () => {
    s.aceitar.mockRejectedValueOnce(new IaNutriError(MSG_IA_NUTRI.naoDisponivel));
    await expect(aceitarIaNutriAction('t1', LIDO, 'eu')).rejects.toThrow(/^redirect \/p\/plano\?ia-nutri=indisponivel$/);
    s.aceitar.mockRejectedValueOnce(new Error('boom'));
    await expect(aceitarIaNutriAction('t1', LIDO, 'eu')).rejects.toThrow('boom');
  });

  it('outro consultório na tela: nada gravado', async () => {
    await expect(aceitarIaNutriAction('t2', LIDO, 'plano')).rejects.toThrow(/^redirect \/p\/plano\/ia$/);
    expect(s.aceitar).not.toHaveBeenCalled();
  });
});

describe('guarda', () => {
  it('toda Server Action do arquivo tem requirePaciente na primeira linha', () => {
    const fonte = readFileSync(path.resolve('src/app/p/(portal)/plano/ia/actions.ts'), 'utf8');
    const acoes = [...fonte.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s*(.*)/g)];
    expect(acoes.map((a) => a[1]).sort()).toEqual(['aceitarIaNutriAction', 'avaliarAction', 'encaminharAction', 'enviarANutriAction', 'perguntarAction']);
    for (const [, nome, primeira] of acoes) expect(primeira, nome).toMatch(/^const \{ ctx \} = await requirePaciente\(/);
  });
});
