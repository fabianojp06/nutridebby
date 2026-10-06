import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { exameComLaudo, tarefaNoBanco } from '../../../test/ia';
import { excluirExame } from '@/modules/pacientes/exames';
import { closeDb } from '@/db/client';
import { iaGastoPlataforma, iaTarefas, iaUso, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { cancelarTarefas } from './cancelar';
import { acertar, avisarSeChegou80Ia, CotaIaError, estornar, marcarIncerto, mesNoFuso, reduzirReserva, reservar, situacaoDaCotaIa } from './cota';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-cota-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

// cada teste usa um "mês da plataforma" próprio (ano 2091…), para o contador global não somar entre testes
let ano = 2090;
const agoraNovo = () => new Date(`${++ano}-10-15T15:00:00Z`);
const TETO = 50_000_000;
const uso = (custo = 0) => ({ entrada: 1000, cacheLeitura: 0, cacheGravacao: 0, saida: 100, geo: 'us', custo });
const reserva = (T: { tenantId: string }, microUsd: number, agora: Date, teto = TETO) => ({
  tenantId: T.tenantId, tarefaId: randomUUID(), tipo: 'leitura_exame', modelo: 'claude-opus-5-5', promptVersao: 't', microUsd, agora, tetoGlobalMicroUsd: teto,
});
const plataforma = async (agora: Date) => (await app.db.select().from(iaGastoPlataforma).where(eq(iaGastoPlataforma.mes, mesNoFuso(agora, 'America/Sao_Paulo'))))[0]?.custoMicroUsd ?? 0;

describe('cota da IA (RN-104, US-102) e teto da plataforma (D3)', () => {
  it('reserva até a cota exata; um micro-dólar a mais → CotaIaError("cota"), sem linha nova', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaCotaMensalUsd: 1 }).where(eq(tenants.id, T.tenantId));
    const agora = agoraNovo();
    await withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 600_000, agora)), app.db);
    await withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 400_000, agora)), app.db);
    await expect(withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 1, agora)), app.db)).rejects.toMatchObject({ name: 'CotaIaError', motivo: 'cota' });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(iaUso), app.db)).toHaveLength(2);
    expect(await plataforma(agora)).toBe(1_000_000);
  });

  it('cota 0 bloqueia tudo; estornado não conta; o mês vira no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaCotaMensalUsd: 0 }).where(eq(tenants.id, T.tenantId));
    await expect(withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 1, agoraNovo())), app.db)).rejects.toBeInstanceOf(CotaIaError);
    await app.db.update(tenants).set({ iaCotaMensalUsd: 1 }).where(eq(tenants.id, T.tenantId));
    const fimDoMes = new Date(`${++ano}-11-01T02:59:00Z`); // 31/10 23:59 em Brasília
    const r = reserva(T, 1_000_000, fimDoMes);
    await withTenant(T.ctx, (tx) => reservar(tx, r), app.db);
    await withTenant(T.ctx, (tx) => estornar(tx, r.tarefaId, fimDoMes), app.db);
    await withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 1_000_000, fimDoMes)), app.db); // o estorno devolveu o saldo
    const comecoDoMes = new Date(`${ano}-11-01T03:00:00Z`); // 01/11 00:00 em Brasília: mês novo
    await withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 1_000_000, comecoDoMes)), app.db);
  });

  it('teto global: soma de todos os tenants; atingido → CotaIaError("teto_plataforma") e nada muda', async () => {
    const agora = agoraNovo();
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    await withTenant(A.ctx, (tx) => reservar(tx, reserva(A, 3_000_000, agora, 5_000_000)), app.db);
    await expect(withTenant(B.ctx, (tx) => reservar(tx, reserva(B, 2_000_001, agora, 5_000_000)), app.db)).rejects.toMatchObject({ motivo: 'teto_plataforma' });
    await withTenant(B.ctx, (tx) => reservar(tx, reserva(B, 2_000_000, agora, 5_000_000)), app.db);
    expect(await plataforma(agora)).toBe(5_000_000);
  });

  it('duas reservas ao mesmo tempo com saldo para uma: só uma passa (linha do tenant travada)', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaCotaMensalUsd: 1 }).where(eq(tenants.id, T.tenantId));
    const agora = agoraNovo();
    const r = await Promise.allSettled([0, 1].map(() => withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 700_000, agora)), app.db)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('reduzir (portão do envio): desce a reserva e o contador global; nunca sobe; só age sobre "reservado"', async () => {
    const T = await novoTenant(app.db);
    const agora = agoraNovo();
    const r = reserva(T, 900_000, agora);
    await withTenant(T.ctx, (tx) => reservar(tx, r), app.db);
    await withTenant(T.ctx, (tx) => reduzirReserva(tx, r.tarefaId, 400_000, agora), app.db);
    await withTenant(T.ctx, (tx) => reduzirReserva(tx, r.tarefaId, 1_000_000, agora), app.db); // subir: nada
    const [u] = await withTenant(T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, r.tarefaId)), app.db);
    expect(u).toMatchObject({ custoMicroUsd: 400_000, situacao: 'reservado' });
    expect(await plataforma(agora)).toBe(400_000);
  });

  it('acerto troca a reserva pelo custo real (e o contador global pela diferença); incerto mantém; idempotentes', async () => {
    const T = await novoTenant(app.db);
    const agora = agoraNovo();
    const r1 = reserva(T, 900_000, agora);
    const r2 = reserva(T, 900_000, agora);
    await withTenant(T.ctx, async (tx) => {
      await reservar(tx, r1);
      await reservar(tx, r2);
    }, app.db);
    await withTenant(T.ctx, (tx) => acertar(tx, { tarefaId: r1.tarefaId, custoMicroUsd: 171_600, uso: uso(), recusaCategoria: null, requestId: 'req_1', agora }), app.db);
    await withTenant(T.ctx, (tx) => acertar(tx, { tarefaId: r1.tarefaId, custoMicroUsd: 1, uso: uso(), recusaCategoria: null, requestId: 'x', agora }), app.db); // já confirmado: nada
    await withTenant(T.ctx, (tx) => marcarIncerto(tx, r2.tarefaId, agora), app.db);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(iaUso), app.db);
    expect(linhas.find((l) => l.tarefaId === r1.tarefaId)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: 171_600, requestId: 'req_1', tokensEntrada: 1000, inferenceGeo: 'us' });
    expect(linhas.find((l) => l.tarefaId === r2.tarefaId)).toMatchObject({ situacao: 'incerto', custoMicroUsd: 900_000 });
    expect(await plataforma(agora)).toBe(171_600 + 900_000);
    const s = await situacaoDaCotaIa(T.ctx, { fuso: 'America/Sao_Paulo', iaCotaMensalUsd: 15 }, agora, app.db);
    expect(s).toMatchObject({ usadoMicroUsd: 1_071_600, cotaMicroUsd: 15_000_000, percentual: 7, nivel: 'ok' });
  });

  it('cancelarTarefas: na fila → cancelada com estorno; pronta → cancelada e esvaziada; processando fica para o worker', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const agora = agoraNovo();
    const naFila = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'na_fila', reservaMicroUsd: 500_000 });
    await withTenant(T.ctx, (tx) => reservar(tx, { ...reserva(T, 500_000, agora), tarefaId: naFila }), app.db);
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'pronta', resultado: { versao: 1, dataColeta: null, linhas: [], descartadas: 0 } });
    const processando = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'processando' });
    expect(await withTenant(T.ctx, (tx) => cancelarTarefas(tx, { patientId: p.id, agora, por: T.nutriId }), app.db)).toBe(2);
    const ts = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas), app.db);
    expect(ts.find((t) => t.id === naFila)).toMatchObject({ status: 'cancelada', resultado: null, encerradoPor: T.nutriId });
    expect(ts.find((t) => t.id === pronta)).toMatchObject({ status: 'cancelada', resultado: null });
    expect(ts.find((t) => t.id === processando)).toMatchObject({ status: 'processando' });
    const [u] = await withTenant(T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, naFila)), app.db);
    expect(u.situacao).toBe('estornado');
  });

  it('D20: excluirExame cancela as tarefas DO EXAME (fila estornada, pronta esvaziada) antes do DELETE; as de outro exame ficam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const e1 = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const e2 = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const agora = agoraNovo();
    const resultado = { versao: 1 as const, dataColeta: null, linhas: [], descartadas: 0 };
    const naFila = await tarefaNoBanco(app.db, T.ctx, p.id, e1, { status: 'na_fila', reservaMicroUsd: 500_000 });
    await withTenant(T.ctx, (tx) => reservar(tx, { ...reserva(T, 500_000, agora), tarefaId: naFila }), app.db);
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, e1, { status: 'pronta', resultado });
    const outra = await tarefaNoBanco(app.db, T.ctx, p.id, e2, { status: 'pronta', resultado });
    expect(await excluirExame(T.ctx, p.id, e1, { db: app.db, dataDir })).toBe(true);
    const ts = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas), app.db);
    expect(ts.find((t) => t.id === naFila)).toMatchObject({ status: 'cancelada', examId: null, resultado: null, encerradoPor: T.nutriId });
    expect(ts.find((t) => t.id === pronta)).toMatchObject({ status: 'cancelada', examId: null, resultado: null });
    expect(ts.find((t) => t.id === outra)).toMatchObject({ status: 'pronta', examId: e2 });
    const [u] = await withTenant(T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, naFila)), app.db);
    expect(u.situacao).toBe('estornado');
  });

  it('US-102: 80% → um e-mail à nutricionista por mês (marca em tenants.ia_aviso_mes)', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaCotaMensalUsd: 1 }).where(eq(tenants.id, T.tenantId));
    const agora = agoraNovo();
    await withTenant(T.ctx, (tx) => reservar(tx, reserva(T, 800_000, agora)), app.db);
    await avisarSeChegou80Ia(app.db, T.tenantId, agora, 'https://nutri.exemplo.com');
    await avisarSeChegou80Ia(app.db, T.tenantId, agora, 'https://nutri.exemplo.com');
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect(await emailsNaFila('cota_ia', nutri.email)).toEqual([{ tipo: 'cota_ia', para: nutri.email, link: 'https://nutri.exemplo.com/painel/configuracoes' }]);
    const [t] = await app.db.select({ m: tenants.iaAvisoMes }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.m).toBe(mesNoFuso(agora, 'America/Sao_Paulo'));
  });
});
