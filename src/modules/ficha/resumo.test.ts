import { afterAll, describe, expect, inject, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, mealPlans } from '@/db/schema';
import { TenantContextError, withTenant } from '@/db/tenant';
import { auditRead } from '@/modules/plataforma/audit';
import { cartaoResumo, linhasDoResumo } from './resumo';

// Plano 18 (RN-276): o cartão Resumo do Início — aniversário, paciente desde e o plano publicado —, sem auditRead.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const FUSO = 'America/Sao_Paulo';

async function plano(T: TenantDeTeste, patientId: string, o: { status: 'rascunho' | 'publicado' | 'arquivado'; versao: number; publicadoEm?: Date }) {
  await withTenant(
    T.ctx,
    (tx) => tx.insert(mealPlans).values({ tenantId: T.tenantId, patientId, titulo: 'Plano', status: o.status, versao: o.versao, publicadoEm: o.publicadoEm ?? null }),
    app.db,
  );
}

// Conta dentro de withTenant: o nutri_app (NOBYPASSRLS) fora dele não vê linha nenhuma de audit_log (tenant_isolation),
// e a contagem daria sempre 0.
const trilha = async (T: TenantDeTeste) =>
  (await withTenant(T.ctx, (tx) => tx.select({ n: count() }).from(auditLog).where(eq(auditLog.tenantId, T.tenantId)), app.db))[0].n;

describe('cartaoResumo e linhasDoResumo (RN-276)', () => {
  it('chaves exatas; aniversário "{dia} de {mês}", paciente desde no fuso e o plano publicado no fuso', async () => {
    const T = await novoTenant(app.db);
    // 01h UTC de 04/02 = 22h de 03/02 em São Paulo
    const p = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-05-07', createdAt: new Date('2025-02-04T01:00:00Z') });
    await plano(T, p.id, { status: 'arquivado', versao: 1, publicadoEm: new Date('2026-09-02T12:00:00Z') });
    await plano(T, p.id, { status: 'publicado', versao: 2, publicadoEm: new Date('2026-11-11T02:00:00Z') });
    await plano(T, p.id, { status: 'rascunho', versao: 3 });
    const c = await cartaoResumo(T.ctx, FUSO, p, { db: app.db });
    expect(Object.keys(c).sort()).toEqual(['aniversario', 'pacienteDesde', 'planoPublicadoEm']);
    expect(c).toEqual({ aniversario: '7 de maio', pacienteDesde: '03/02/2025', planoPublicadoEm: '10/11/2026' });
    expect(linhasDoResumo(c)).toEqual(['Aniversário: 7 de maio', 'Paciente desde 03/02/2025', 'Plano alimentar publicado em 10/11/2026']);
  });

  it('sem plano publicado (só rascunho e arquivado): "Nenhum plano publicado"; sem nascimento, sem a linha do aniversário', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { createdAt: new Date('2026-01-15T15:00:00Z') });
    await plano(T, p.id, { status: 'arquivado', versao: 1, publicadoEm: new Date('2026-09-02T12:00:00Z') });
    await plano(T, p.id, { status: 'rascunho', versao: 2 });
    const c = await cartaoResumo(T.ctx, FUSO, { ...p, dataNascimento: null }, { db: app.db });
    expect(c).toEqual({ aniversario: null, pacienteDesde: '15/01/2026', planoPublicadoEm: null });
    expect(linhasDoResumo(c)).toEqual(['Paciente desde 15/01/2026', 'Nenhum plano publicado']);
  });

  it('sem trilha: abrir o cartão não grava audit_log', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await plano(T, p.id, { status: 'publicado', versao: 1, publicadoEm: new Date('2026-11-11T12:00:00Z') });
    const antes = await trilha(T);
    expect(antes).toBeGreaterThan(0); // o "criar" do plano (gatilho de auditoria) já está na trilha
    await cartaoResumo(T.ctx, FUSO, p, { db: app.db });
    expect(await trilha(T)).toBe(antes);
    // controle positivo: um auditRead explícito sobe a contagem
    await withTenant(T.ctx, (tx) => auditRead(tx, { entidade: 'patients', entidadeId: p.id, patientId: p.id }), app.db);
    expect(await trilha(T)).toBe(antes + 1);
  });

  it('outro tenant: o plano publicado de B não aparece pelo ctx de A', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await plano(B, pb.id, { status: 'publicado', versao: 1, publicadoEm: new Date('2026-11-11T12:00:00Z') });
    expect((await cartaoResumo(A.ctx, FUSO, pb, { db: app.db })).planoPublicadoEm).toBeNull();
  });

  it('papel: só a sessão da nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(cartaoResumo(ctxPaciente(T.tenantId, p.id), FUSO, p, { db: app.db })).rejects.toThrow(TenantContextError);
    await expect(cartaoResumo({ tenantId: T.tenantId, role: 'worker' }, FUSO, p, { db: app.db })).rejects.toThrow(TenantContextError);
  });
});
