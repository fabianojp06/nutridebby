import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, diaryEntries, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { COTA_BYTES, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { MSG_DIARIO } from './diario-constantes';
import { DiarioError, diarioDoPaciente, registrarNoDiario } from './diario';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-diario-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const deps = (agora = new Date('2026-10-05T15:00:00Z')) => ({ db: app.db, dataDir, agora });
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DiarioError) return e.erros;
    throw e;
  }
  throw new Error('esperava DiarioError');
};

describe('diário (US-042, RN-07)', () => {
  it('"Almoço" com texto e foto: registro na hora, foto original guardada com dono e o job de conversão na fila', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const r = await registrarNoDiario(ctx, SP, { refeicao: 'Almoço', texto: 'arroz, feijão, frango', foto: JPEG }, deps());
    expect(r.semFoto).toBe(false);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, r.id)), app.db);
    expect(e).toMatchObject({ refeicao: 'Almoço', texto: 'arroz, feijão, frango', fotoStatus: 'processando', fotoPath: null });
    expect(e.fotoOriginalPath).toMatch(new RegExp(`^${T.tenantId}/diario_foto_original/`));
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, e.fotoOriginalPath!)), app.db);
    expect(f.patientId).toBe(p.id);
    const jobs = await (await getBoss()).findJobs('diario-foto');
    expect(jobs.some((j) => (j.data as { entryId: string }).entryId === r.id)).toBe(true);
  });

  it('validação: refeição fora da lista, vazio, texto longo, PDF no lugar da foto', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Brunch', texto: 'x', foto: null }, deps()))).toEqual({ refeicao: MSG_DIARIO.refeicao });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: '   ', foto: null }, deps()))).toEqual({ geral: MSG_DIARIO.vazio });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'a'.repeat(2001), foto: null }, deps()))).toEqual({ texto: MSG_DIARIO.texto });
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'x', foto: pdf }, deps()))).toEqual({ foto: MSG_DIARIO.foto });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'x', foto: Buffer.alloc(10 * 1024 * 1024 + 1, 0xff) }, deps()))).toEqual({ foto: MSG_DIARIO.foto });
  });

  it('limite de 10 por dia no fuso do tenant: o 11º é recusado; 23:30 de Brasília ainda conta no mesmo dia; à 00:10 libera', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    for (let i = 0; i < 10; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps(new Date('2026-10-05T12:00:00Z')));
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: 'mais', foto: null }, deps(new Date('2026-10-06T02:30:00Z'))))).toEqual({ geral: MSG_DIARIO.limite });
    await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: 'novo dia', foto: null }, deps(new Date('2026-10-06T03:10:00Z')));
  });

  it('corrida: com 9 no dia, dois envios ao mesmo tempo → exatamente um entra (Review Focus 3)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    for (let i = 0; i < 9; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps());
    const r = await Promise.allSettled([1, 2].map((n) => registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `c${n}`, foto: null }, deps())));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('cota esgotada (RN-18): o texto é salvo sem a foto; só a foto → "Espaço de armazenamento esgotado"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    const ctx = ctxPaciente(T.tenantId, p.id);
    const r = await registrarNoDiario(ctx, SP, { refeicao: 'Jantar', texto: 'sopa', foto: JPEG }, deps());
    expect(r.semFoto).toBe(true);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, r.id)), app.db);
    expect(e).toMatchObject({ texto: 'sopa', fotoStatus: 'sem_foto', fotoOriginalPath: null });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Jantar', texto: '', foto: JPEG }, deps()))).toEqual({ foto: MSG_COTA_ESGOTADA });
  });

  it('o paciente lê só os próprios registros, mais recentes primeiro; leitura auditada', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await registrarNoDiario(ctxPaciente(T.tenantId, p1.id), SP, { refeicao: 'Café da manhã', texto: 'pão', foto: null }, deps(new Date('2026-10-05T10:00:00Z')));
    await registrarNoDiario(ctxPaciente(T.tenantId, p1.id), SP, { refeicao: 'Almoço', texto: 'arroz', foto: null }, deps(new Date('2026-10-05T15:00:00Z')));
    await registrarNoDiario(ctxPaciente(T.tenantId, p2.id), SP, { refeicao: 'Almoço', texto: 'de outro', foto: null }, deps());
    const lista = await diarioDoPaciente(ctxPaciente(T.tenantId, p1.id), { db: app.db });
    expect(lista.map((x) => x.texto)).toEqual(['arroz', 'pão']);
    expect(lista[0].foto).toEqual({ estado: 'sem_foto' });
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p1.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'diario'))), app.db);
    expect(lidas).toHaveLength(1);
  });
});
