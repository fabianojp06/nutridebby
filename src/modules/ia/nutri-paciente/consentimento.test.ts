import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { IA_TESTE } from '../../../../test/ia';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, mensagemNoBanco, PAUSADA, SEM_PAUSA } from '../../../../test/ia-nutri';
import { ctxPaciente, novoTenant } from '../../../../test/pacientes';
import { planoPublicado } from '../../../../test/plano';
import { pacienteComConta } from '../../../../test/portal';
import { closeDb } from '@/db/client';
import { iaNutriConsentimentos, iaNutriMensagens, iaNutriParticipacoes, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import type { ConfigIA } from '../modo';
import { IA_NUTRI_TERMO_VERSAO, textoExibidoIaNutri } from '../textos-legais';
import { aceitarNoApp, desativarNoApp, desativarPelaNutri } from './consentimento';
import { MSG_IA_NUTRI } from './constantes';
import type { DepsIaNutri } from './deps';
import { blocoIaNutriDoApp, entradaDoPaciente } from './estado';
import { IaNutriError } from './participacao';
import type { DadosRevogacaoIaNutri } from './revogacao-job';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

async function cenario(o: { liberar?: boolean; plano?: boolean; aceite?: boolean } = {}) {
  const T = await novoTenant(app.db);
  await iaNutriPronta(app.db, T.tenantId);
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  if (o.plano !== false) await planoPublicado(app.db, T, p.id);
  if (o.liberar !== false) await liberarNoBanco(app.db, T.ctx, p.id);
  const P = ctxPaciente(T.tenantId, p.id, userId);
  if (o.aceite) await aceiteNoBanco(app.db, P);
  const tenant = async () => (await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0] as TenantRow;
  const eventos = () => withTenant(T.ctx, (tx) => tx.select().from(iaNutriConsentimentos).where(eq(iaNutriConsentimentos.patientId, p.id)).orderBy(asc(iaNutriConsentimentos.registradoEm)), app.db);
  const deps = (extra: Partial<DepsIaNutri> = {}): DepsIaNutri => ({ ia: IA_TESTE, appUrl: 'https://app.test', db: app.db, pausa: SEM_PAUSA, ...extra });
  const entrada = async (ia: ConfigIA = IA_TESTE, pausa: { pausadaEm: Date | null } = SEM_PAUSA) => entradaDoPaciente(P, await tenant(), ia, { db: app.db, pausa });
  const bloco = async (ia: ConfigIA = IA_TESTE, pausa: { pausadaEm: Date | null } = SEM_PAUSA) => blocoIaNutriDoApp(P, await tenant(), ia, { db: app.db, pausa });
  const bloquearParticipacao = () => withTenant(T.ctx, (tx) => tx.update(iaNutriParticipacoes).set({ bloqueadaEm: new Date() }).where(eq(iaNutriParticipacoes.patientId, p.id)), app.db);
  const desligarConsultorio = () => app.db.update(tenants).set({ iaNutriAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
  return { T, p, P, userId, tenant, eventos, deps, entrada, bloco, bloquearParticipacao, desligarConsultorio };
}
const erro = (pr: Promise<unknown>) => pr.then(() => null, (e: unknown) => (e instanceof IaNutriError ? e.mensagem : e));
const jobsDeRevogacao = async (patientId: string) =>
  (await (await getBoss()).findJobs<DadosRevogacaoIaNutri>('ia-nutri-revogacao')).map((j) => j.data).filter((d) => d.patientId === patientId);
const LIDO = textoExibidoIaNutri('teste');

describe('entradaDoPaciente (§7.2, tabela de estados)', () => {
  it('não liberado → nenhuma; liberado sem consentimento → decidir; com o aceite da versão de agora → conversa; outro destino → texto_mudou', async () => {
    const naoLiberado = await cenario({ liberar: false });
    expect(await naoLiberado.entrada()).toBe('nenhuma');
    const c = await cenario();
    expect(await c.entrada()).toBe('decidir');
    await aceiteNoBanco(app.db, c.P);
    expect(await c.entrada()).toBe('conversa');
    expect(await c.entrada({ ...IA_TESTE, destino: 'anthropic-us' })).toBe('texto_mudou');
    expect(await c.entrada({ ...IA_TESTE, modo: 'ausente' })).toBe('nenhuma');
  });

  it('sem plano publicado → sem_plano; pausada → indisponivel; IA Nutri desativada no consultório → nenhuma; participação bloqueada → nenhuma', async () => {
    const semPlano = await cenario({ plano: false, aceite: true });
    expect(await semPlano.entrada()).toBe('sem_plano');
    const c = await cenario({ aceite: true });
    expect(await c.entrada(IA_TESTE, PAUSADA)).toBe('indisponivel');
    expect(await c.entrada({ ...IA_TESTE, nutriDesligada: true })).toBe('indisponivel');
    await c.desligarConsultorio();
    expect(await c.entrada()).toBe('nenhuma');
    const b = await cenario({ aceite: true });
    await b.bloquearParticipacao();
    expect(await b.entrada()).toBe('nenhuma');
    expect(await b.entrada(IA_TESTE, PAUSADA)).toBe('nenhuma'); // bloqueado: a entrada some, mesmo na pausa
  });

  it('paciente arquivado ou perfil profissional incompleto → nenhuma', async () => {
    const c = await cenario({ aceite: true });
    await withTenant(c.T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, c.p.id)), app.db);
    expect(await c.entrada()).toBe('nenhuma');
    const semPerfil = await cenario({ aceite: true });
    await app.db.update(tenants).set({ crn: null }).where(eq(tenants.id, semPerfil.T.tenantId));
    expect(await semPerfil.entrada()).toBe('nenhuma');
  });
});

describe('US-171 — aceitarNoApp', () => {
  it('grava o aceite (versão de agora, destino, canal app, a conta, IP e user-agent até 300); de novo → ja_vigente, nada novo', async () => {
    const c = await cenario();
    expect(await aceitarNoApp(c.P, LIDO, c.deps({ ip: '203.0.113.9', userAgent: 'U'.repeat(400) }))).toBe('registrado');
    const [e] = await c.eventos();
    expect(e).toMatchObject({ evento: 'aceite', versao: IA_NUTRI_TERMO_VERSAO, destino: 'teste', canal: 'app', registradoPor: c.userId, ip: '203.0.113.9' });
    expect(e.userAgent).toHaveLength(300);
    expect(await aceitarNoApp(c.P, LIDO, c.deps())).toBe('ja_vigente');
    expect(await c.eventos()).toHaveLength(1);
    expect(await c.entrada()).toBe('conversa');
  });

  it('o texto exibido de outro destino ou versão → "O texto mudou…", nada gravado; o novo destino (texto_mudou) grava com o texto dele', async () => {
    const c = await cenario();
    for (const exibido of [undefined, null, 'teste', textoExibidoIaNutri('anthropic-us'), { ...LIDO, versao: '0.1-provisorio' }]) {
      expect(await erro(aceitarNoApp(c.P, exibido, c.deps())), JSON.stringify(exibido)).toBe(MSG_IA_NUTRI.textoMudouNoToque);
    }
    expect(await c.eventos()).toHaveLength(0);
    await aceitarNoApp(c.P, LIDO, c.deps());
    const us = { ...IA_TESTE, destino: 'anthropic-us' as const };
    expect(await c.entrada(us)).toBe('texto_mudou');
    expect(await erro(aceitarNoApp(c.P, LIDO, c.deps({ ia: us })))).toBe(MSG_IA_NUTRI.textoMudouNoToque);
    expect(await aceitarNoApp(c.P, textoExibidoIaNutri('anthropic-us'), c.deps({ ia: us }))).toBe('registrado');
    expect((await c.eventos()).map((e) => e.destino)).toEqual(['teste', 'anthropic-us']);
  });

  it('não liberado, pausada, participação bloqueada ou consultório desligado → "não está disponível", nada gravado', async () => {
    const naoLiberado = await cenario({ liberar: false });
    expect(await erro(aceitarNoApp(naoLiberado.P, LIDO, naoLiberado.deps()))).toBe(MSG_IA_NUTRI.naoDisponivel);
    const c = await cenario();
    expect(await erro(aceitarNoApp(c.P, LIDO, c.deps({ pausa: PAUSADA })))).toBe(MSG_IA_NUTRI.naoDisponivel);
    expect(await erro(aceitarNoApp(c.P, LIDO, c.deps({ ia: { ...IA_TESTE, nutriDesligada: true } })))).toBe(MSG_IA_NUTRI.naoDisponivel);
    await c.desligarConsultorio();
    expect(await erro(aceitarNoApp(c.P, LIDO, c.deps()))).toBe(MSG_IA_NUTRI.naoDisponivel);
    expect(await c.eventos()).toHaveLength(0);
    const b = await cenario();
    await b.bloquearParticipacao();
    expect(await erro(aceitarNoApp(b.P, LIDO, b.deps()))).toBe(MSG_IA_NUTRI.naoDisponivel);
    expect(await b.eventos()).toHaveLength(0);
  });

  it('só a sessão de paciente com conta', async () => {
    const c = await cenario();
    const semConta: TenantContext = { tenantId: c.T.tenantId, role: 'paciente', patientId: c.p.id, semConta: true };
    await expect(aceitarNoApp(semConta, LIDO, c.deps())).rejects.toThrow('aceitarNoApp: só a sessão de paciente com conta');
    await expect(aceitarNoApp(c.T.ctx, LIDO, c.deps())).rejects.toThrow('aceitarNoApp: só a sessão de paciente com conta');
    expect(await c.eventos()).toHaveLength(0);
  });
});

describe('US-177 / RN-182 — desativarNoApp', () => {
  it('grava a revogação (canal app, a conta, IP) e enfileira ia-nutri-revogacao só com ids; sem consentimento → nada_a_desativar, sem job', async () => {
    const c = await cenario();
    expect(await desativarNoApp(c.P, c.deps())).toBe('nada_a_desativar');
    expect(await jobsDeRevogacao(c.p.id)).toEqual([]);
    await aceitarNoApp(c.P, LIDO, c.deps());
    expect(await desativarNoApp(c.P, c.deps({ ip: '203.0.113.9', userAgent: 'U'.repeat(400) }))).toBe('desativada');
    const rev = (await c.eventos()).find((e) => e.evento === 'revogacao')!;
    expect(rev).toMatchObject({ canal: 'app', registradoPor: c.userId, ip: '203.0.113.9', versao: null, destino: null });
    expect(rev.userAgent).toHaveLength(300);
    expect(await jobsDeRevogacao(c.p.id)).toEqual([{ tenantId: c.T.tenantId, patientId: c.p.id, revogacaoId: rev.id }]);
    expect(await desativarNoApp(c.P, c.deps())).toBe('nada_a_desativar');
    expect(await c.entrada()).toBe('decidir');
  });

  it.each([
    ['participação bloqueada pela nutricionista', 'bloqueada'],
    ['IA Nutri desligada no consultório', 'desligado'],
    ['plataforma pausada (emergência)', 'pausada'],
  ] as const)('Review Focus 5: funciona com %s', async (_, caso) => {
    const c = await cenario({ aceite: true });
    if (caso === 'bloqueada') await c.bloquearParticipacao();
    if (caso === 'desligado') await c.desligarConsultorio();
    expect(await desativarNoApp(c.P, c.deps({ pausa: caso === 'pausada' ? PAUSADA : SEM_PAUSA }))).toBe('desativada');
    expect((await c.eventos()).at(-1)?.evento).toBe('revogacao');
    expect(await jobsDeRevogacao(c.p.id)).toHaveLength(1);
  });

  it('só a sessão de paciente com conta', async () => {
    const c = await cenario({ aceite: true });
    await expect(desativarNoApp(c.T.ctx, c.deps())).rejects.toThrow('desativarNoApp: só a sessão de paciente com conta');
  });
});

describe('DP-17 — desativarPelaNutri (a pedido do paciente, na ficha)', () => {
  it('paciente arquivado com consentimento: revogação canal nutricionista em nome da usuária, o conteúdo apagado e o job; de novo → nada_a_desativar', async () => {
    const c = await cenario({ aceite: true });
    const m = await mensagemNoBanco(app.db, c.T.tenantId, c.p.id, { status: 'respondida' });
    await withTenant(c.T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, c.p.id)), app.db);
    expect(await desativarPelaNutri(c.T.ctx, c.p.id, { db: app.db })).toBe('desativada');
    const rev = (await c.eventos()).at(-1)!;
    expect(rev).toMatchObject({ evento: 'revogacao', canal: 'nutricionista', registradoPor: c.T.nutriId, ip: null, userAgent: null });
    const [msg] = await withTenant(c.T.ctx, (tx) => tx.select().from(iaNutriMensagens).where(eq(iaNutriMensagens.id, m)), app.db);
    expect(msg.texto).toBeNull();
    expect(msg.revogadaEm).not.toBeNull();
    expect(await jobsDeRevogacao(c.p.id)).toEqual([{ tenantId: c.T.tenantId, patientId: c.p.id, revogacaoId: rev.id }]);
    expect(await desativarPelaNutri(c.T.ctx, c.p.id, { db: app.db })).toBe('nada_a_desativar');
    // o paciente volta a ativo: decide de novo
    await withTenant(c.T.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, c.p.id)), app.db);
    expect(await c.entrada()).toBe('decidir');
  });

  it('sem consentimento → nada_a_desativar, sem job; id inválido → nada_a_desativar; paciente de outro consultório → não encontrado; só a sessão da nutricionista', async () => {
    const c = await cenario();
    expect(await desativarPelaNutri(c.T.ctx, c.p.id, { db: app.db })).toBe('nada_a_desativar');
    expect(await jobsDeRevogacao(c.p.id)).toEqual([]);
    expect(await desativarPelaNutri(c.T.ctx, 'nao-e-uuid', { db: app.db })).toBe('nada_a_desativar');
    const outro = await cenario({ aceite: true });
    await expect(desativarPelaNutri(c.T.ctx, outro.p.id, { db: app.db })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(desativarPelaNutri(c.T.ctx, randomUUID(), { db: app.db })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(desativarPelaNutri(outro.P, outro.p.id, { db: app.db })).rejects.toThrow('desativarPelaNutri: só a sessão da nutricionista');
    expect((await outro.eventos()).map((e) => e.evento)).toEqual(['aceite']);
  });
});

describe('§7.6, RN-182 — blocoIaNutriDoApp (Eu › Privacidade)', () => {
  // como configIA sem IA_PROVEDOR: modo 'ausente' e destino nulo
  const SEM_PROVEDOR: ConfigIA = { ...IA_TESTE, modo: 'ausente', destino: null, retencao: null };

  it('nulo sem nada (nunca liberado, sem conversa, sem evento), também sem IA_PROVEDOR', async () => {
    const c = await cenario({ liberar: false });
    expect(await c.bloco()).toBeNull();
    expect(await c.bloco(SEM_PROVEDOR)).toBeNull();
  });

  it('revisão da T7: sem IA_PROVEDOR, o consentimento vigente com conversa guardada mantém o bloco (revogação a qualquer momento, LGPD art. 8º, § 5º) e desativar funciona', async () => {
    const c = await cenario({ aceite: true });
    await mensagemNoBanco(app.db, c.T.tenantId, c.p.id, { status: 'respondida' });
    const [e] = await c.eventos();
    expect(await c.bloco(SEM_PROVEDOR)).toEqual({ situacao: MSG_IA_NUTRI.situacaoVigente(formatarDataNoFuso(e.registradoEm, (await c.tenant()).fuso)), podeDecidir: false, podeDesativar: true, temConversa: true });
    expect(await desativarNoApp(c.P, c.deps({ ia: SEM_PROVEDOR }))).toBe('desativada');
    const rev = (await c.eventos()).at(-1)!;
    expect(await c.bloco(SEM_PROVEDOR)).toEqual({ situacao: MSG_IA_NUTRI.situacaoDesativada(formatarDataNoFuso(rev.registradoEm, (await c.tenant()).fuso)), podeDecidir: false, podeDesativar: false, temConversa: false });
  });

  it('sem IA_PROVEDOR, liberado e sem nenhum evento nem conversa → nulo (nada a decidir com a IA fora do ar)', async () => {
    const c = await cenario();
    expect(await c.bloco(SEM_PROVEDOR)).toBeNull();
  });

  it('liberado sem consentimento → podeDecidir, "Você ainda não autorizou…"', async () => {
    const c = await cenario();
    expect(await c.bloco()).toEqual({ situacao: MSG_IA_NUTRI.situacaoNunca, podeDecidir: true, podeDesativar: false, temConversa: false });
  });

  it('consentimento vigente com a participação bloqueada → podeDesativar, sem decidir', async () => {
    const c = await cenario({ aceite: true });
    await c.bloquearParticipacao();
    const [e] = await c.eventos();
    expect(await c.bloco()).toEqual({ situacao: MSG_IA_NUTRI.situacaoVigente(formatarDataNoFuso(e.registradoEm, (await c.tenant()).fuso)), podeDecidir: false, podeDesativar: true, temConversa: false });
  });

  it('conversa guardada e a IA Nutri desligada no consultório (ou a plataforma pausada) → aparece com temConversa', async () => {
    const c = await cenario({ aceite: true });
    await mensagemNoBanco(app.db, c.T.tenantId, c.p.id, { status: 'respondida' });
    await c.desligarConsultorio();
    expect(await c.bloco()).toMatchObject({ podeDecidir: false, podeDesativar: true, temConversa: true });
    expect(await c.bloco(IA_TESTE, PAUSADA)).toMatchObject({ podeDecidir: false, podeDesativar: true, temConversa: true });
  });

  it('Review Focus 5: depois de desativar, com a participação bloqueada (nada a decidir nem a desativar), o bloco continua com "Você desativou em…"', async () => {
    const c = await cenario({ aceite: true });
    await c.bloquearParticipacao();
    expect(await desativarNoApp(c.P, c.deps())).toBe('desativada');
    const rev = (await c.eventos()).at(-1)!;
    expect(await c.bloco()).toEqual({ situacao: MSG_IA_NUTRI.situacaoDesativada(formatarDataNoFuso(rev.registradoEm, (await c.tenant()).fuso)), podeDecidir: false, podeDesativar: false, temConversa: false });
  });

  it('/code-review do PR #37: a pergunta de risco guardada pela D22 depois da revogação não traz de volta o botão de desativar', async () => {
    const c = await cenario({ aceite: true });
    const [r] = await withTenant(
      c.P,
      async (tx) => (await tx.execute(sql`select * from app_ia_nutri_perguntar(${'quero sumir'}, ${'emergencia'}, ${'risco_emergencia'}, ${IA_NUTRI_TERMO_VERSAO}, ${'teste'})`)).rows as { codigo: string }[],
      app.db,
    );
    expect(r.codigo).toBe('risco');
    expect(await desativarNoApp(c.P, c.deps())).toBe('desativada');
    const rev = (await c.eventos()).at(-1)!;
    const b = await c.bloco();
    expect(b).toMatchObject({ podeDesativar: false, temConversa: true, situacao: MSG_IA_NUTRI.situacaoDesativada(formatarDataNoFuso(rev.registradoEm, (await c.tenant()).fuso)) });
    expect(await desativarNoApp(c.P, c.deps())).toBe('nada_a_desativar');
  });
});
