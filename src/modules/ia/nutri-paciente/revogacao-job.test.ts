import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { IA_TESTE } from '../../../../test/ia';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, mensagemNoBanco, SEM_PAUSA } from '../../../../test/ia-nutri';
import { ctxPaciente, novoTenant } from '../../../../test/pacientes';
import { planoPublicado } from '../../../../test/plano';
import { pacienteComConta } from '../../../../test/portal';
import { closeDb } from '@/db/client';
import { iaGastoPlataforma, iaNutriConsentimentos, iaNutriMensagens, iaUso } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { FUSO_DA_PLATAFORMA, mesNoFuso, reservar } from '../cota';
import { desativarNoApp } from './consentimento';
import { processarRevogacaoIaNutri } from './revogacao-job';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

// um "mês da plataforma" só deste arquivo (o contador global é um para o banco inteiro; cota.test.ts usa 2091…)
const MES = new Date('2187-03-15T15:00:00Z');
const plataforma = async () => (await app.db.select().from(iaGastoPlataforma).where(eq(iaGastoPlataforma.mes, mesNoFuso(MES, FUSO_DA_PLATAFORMA))))[0]?.custoMicroUsd ?? 0;

async function cenario() {
  const T = await novoTenant(app.db);
  await iaNutriPronta(app.db, T.tenantId);
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  await planoPublicado(app.db, T, p.id);
  await liberarNoBanco(app.db, T.ctx, p.id);
  const P = ctxPaciente(T.tenantId, p.id, userId);
  const W = { tenantId: T.tenantId, role: 'worker' } as const;
  /** A pergunta na fila do job `ia-paciente`, com a reserva no escopo do paciente (o que o job faz no passo 2). */
  const pergunta = async (o: { status: 'na_fila' | 'processando'; enviadoEm?: Date; microUsd: number }) => {
    const id = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: o.status, enviadoEm: o.enviadoEm ?? null });
    await withTenant(W, (tx) => reservar(tx, { tenantId: T.tenantId, tarefaId: id, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: 't', microUsd: o.microUsd, agora: MES, tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd }), app.db);
    return id;
  };
  const desativar = async () => {
    expect(await desativarNoApp(P, { ia: IA_TESTE, appUrl: 'https://app.test', db: app.db, pausa: SEM_PAUSA })).toBe('desativada');
    const [r] = await withTenant(T.ctx, (tx) => tx.select({ id: iaNutriConsentimentos.id }).from(iaNutriConsentimentos).where(and(eq(iaNutriConsentimentos.patientId, p.id), eq(iaNutriConsentimentos.evento, 'revogacao'))).orderBy(iaNutriConsentimentos.registradoEm), app.db).then((l) => l.slice(-1));
    return r.id;
  };
  const situacao = async (id: string) => (await withTenant(W, (tx) => tx.select({ s: iaUso.situacao }).from(iaUso).where(eq(iaUso.tarefaId, id)), app.db))[0].s;
  const status = async (id: string) => (await withTenant(W, (tx) => tx.select({ s: iaNutriMensagens.status }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, id)), app.db))[0].s;
  return { T, p, P, desativar, pergunta, situacao, status };
}

describe('job ia-nutri-revogacao (RN-182, D30)', () => {
  it('a que não saiu → estornada (o contador da plataforma desce); a que saiu → incerto; idempotente', async () => {
    const c = await cenario();
    const dados = (revogacaoId: string) => ({ tenantId: c.T.tenantId, patientId: c.p.id, revogacaoId });
    const antes = await plataforma();
    // 1ª: na fila, sem enviado_em; o paciente desativa e consente de novo
    await aceiteNoBanco(app.db, c.P);
    const naoSaiu = await c.pergunta({ status: 'na_fila', microUsd: 5_500 });
    const r1 = await c.desativar();
    // 2ª: já no provedor (enviado_em); o paciente desativa outra vez
    await aceiteNoBanco(app.db, c.P);
    const saiu = await c.pergunta({ status: 'processando', enviadoEm: new Date(), microUsd: 4_000 });
    const r2 = await c.desativar();
    expect([await c.status(naoSaiu), await c.status(saiu)]).toEqual(['cancelada', 'cancelada']);
    expect(await plataforma()).toBe(antes + 9_500);

    expect(await processarRevogacaoIaNutri(dados(r2), { db: app.db })).toBe(2);
    expect(await c.situacao(naoSaiu)).toBe('estornado');
    expect(await c.situacao(saiu)).toBe('incerto');
    expect(await plataforma()).toBe(antes + 4_000);

    // rodar de novo (e o job da primeira revogação, atrasado) não muda nada
    expect(await processarRevogacaoIaNutri(dados(r2), { db: app.db })).toBe(0);
    expect(await processarRevogacaoIaNutri(dados(r1), { db: app.db })).toBe(0);
    expect([await c.situacao(naoSaiu), await c.situacao(saiu)]).toEqual(['estornado', 'incerto']);
    expect(await plataforma()).toBe(antes + 4_000);
  });

  it('só as canceladas criadas antes da revogação: a revogação de antes não toca a pergunta de depois', async () => {
    const c = await cenario();
    await aceiteNoBanco(app.db, c.P);
    const r1 = await c.desativar();
    await aceiteNoBanco(app.db, c.P);
    const depois = await c.pergunta({ status: 'na_fila', microUsd: 1_000 });
    await c.desativar();
    expect(await processarRevogacaoIaNutri({ tenantId: c.T.tenantId, patientId: c.p.id, revogacaoId: r1 }, { db: app.db })).toBe(0);
    expect(await c.situacao(depois)).toBe('reservado');
  });

  it('revogação inexistente, de outro paciente ou um aceite → 0, nada muda', async () => {
    const c = await cenario();
    await aceiteNoBanco(app.db, c.P);
    const pendente = await c.pergunta({ status: 'na_fila', microUsd: 1_000 });
    const r = await c.desativar();
    const outro = await cenario();
    await aceiteNoBanco(app.db, outro.P);
    const [aceite] = await withTenant(outro.T.ctx, (tx) => tx.select({ id: iaNutriConsentimentos.id }).from(iaNutriConsentimentos).where(eq(iaNutriConsentimentos.patientId, outro.p.id)), app.db);
    expect(await processarRevogacaoIaNutri({ tenantId: c.T.tenantId, patientId: c.p.id, revogacaoId: randomUUID() }, { db: app.db })).toBe(0);
    expect(await processarRevogacaoIaNutri({ tenantId: c.T.tenantId, patientId: outro.p.id, revogacaoId: r }, { db: app.db })).toBe(0);
    expect(await processarRevogacaoIaNutri({ tenantId: outro.T.tenantId, patientId: outro.p.id, revogacaoId: aceite.id }, { db: app.db })).toBe(0);
    expect(await c.situacao(pendente)).toBe('reservado');
  });
});
