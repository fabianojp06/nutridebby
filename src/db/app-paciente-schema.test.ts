import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { auditLog, diaryEntries, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
const falhaCom = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigo(e);
  }
  return 'sem erro';
};

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const comoPaciente = ctxPaciente(T.tenantId, p.id);
  const registro = (ctx: Parameters<typeof withTenant>[0], v: Partial<typeof diaryEntries.$inferInsert>) =>
    withTenant(ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', ...v }).returning({ id: diaryEntries.id }), app.db);
  return { T, p, comoPaciente, registro };
}

describe('diary_entries: respostas à refeição do plano (Plano 16, §9, RN-197)', () => {
  it('"Comi assim" sem texto nem foto entra pela sessão do paciente (paciente_diario_insert continua valendo)', async () => {
    const { comoPaciente, registro } = await cenario();
    const [r] = await registro(comoPaciente, { resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30' });
    expect(r.id).toBeTruthy();
  });

  it('CHECKs: resposta da lista; refeição do plano junto da resposta (e só com ela), de 1 a 80 caracteres; "outra coisa" e registro comum exigem texto ou foto', async () => {
    const { comoPaciente, registro } = await cenario();
    expect(await falhaCom(registro(comoPaciente, { resposta: 'talvez', refeicaoDoPlano: 'Almoço · 12:30', texto: 'x' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'como_no_plano' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { refeicaoDoPlano: 'Almoço · 12:30', texto: 'arroz' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'como_no_plano', refeicaoDoPlano: 'x'.repeat(81) }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'como_no_plano', refeicaoDoPlano: '' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, {}))).toBe('23514'); // a regra antiga continua: sem texto, sem foto, sem "Comi assim"
    await registro(comoPaciente, { resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30', texto: 'Sanduíche natural' });
    await registro(comoPaciente, { texto: 'arroz e feijão' });
  });

  it('a resposta do paciente vira audit_log pelo gatilho (entidade diario, ator = a conta do paciente)', async () => {
    const { T, p, registro } = await cenario();
    const conta = randomUUID();
    const [r] = await registro(ctxPaciente(T.tenantId, p.id, conta), { resposta: 'como_no_plano', refeicaoDoPlano: 'Jantar · 19:30' });
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'diario'), eq(auditLog.entidadeId, r.id))), app.db);
    expect(linhas).toEqual([expect.objectContaining({ acao: 'criar', actorUserId: conta, patientId: p.id })]);
  });
});

describe('patients.peso_oculto_no_app_em (Plano 16, G-D1, RN-205)', () => {
  it('a sessão de paciente não liga nem desliga a opção (gatilho paciente_colunas, 0085: a coluna fica fora de `livres`)', async () => {
    const { p, comoPaciente } = await cenario();
    const mudar = (v: Date | null) => withTenant(comoPaciente, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: v }).where(eq(patients.id, p.id)), app.db);
    expect(await falhaCom(mudar(new Date()))).toBe('42501');
  });

  it('a equipe liga e desliga; cada troca vira audit_log (entidade patients, ação alterar, ator = quem trocou)', async () => {
    const { T, p } = await cenario();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: null }).where(eq(patients.id, p.id)), app.db);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'patients'), eq(auditLog.entidadeId, p.id), eq(auditLog.acao, 'alterar'))), app.db);
    expect(linhas.filter((l) => l.actorUserId === T.nutriId)).toHaveLength(2);
  });

  it('o paciente lê a própria opção pela RLS (o portal filtra no servidor), e não a de outro paciente', async () => {
    const { T, p, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: new Date() }).where(eq(patients.id, outro.id)), app.db);
    const vistos = await withTenant(comoPaciente, (tx) => tx.execute(sql`select id, peso_oculto_no_app_em from patients`), app.db);
    expect(vistos.rows).toEqual([{ id: p.id, peso_oculto_no_app_em: null }]);
  });
});
