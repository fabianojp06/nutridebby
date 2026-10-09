import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { exameComLaudo, iaPronta, tarefaNoBanco } from '../../test/ia';
import { adminActions, exams, iaTarefas, iaUso, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { excluirExame } from '@/modules/pacientes/exames';

const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-schema-'));
afterAll(async () => {
  await app.pool.end();
  await dono.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
const falhaCom = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigo(e);
  }
  return 'sem erro';
};

describe('Plano 11 — banco da IA (spec v0.3 §11, §5.11)', () => {
  it('tenants nascem com a IA bloqueada e a cota padrão de US$ 15,00 (A-D10)', async () => {
    const T = await novoTenant(app.db);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toMatchObject({ iaLiberada: false, iaAtivadaEm: null, iaAditivoVersao: null, iaCotaMensalUsd: 15, iaAvisoMes: null });
    await expect(app.db.update(tenants).set({ iaCotaMensalUsd: 1000.01 }).where(eq(tenants.id, T.tenantId))).rejects.toSatisfy((e) => codigo(e) === '23514');
  });

  it('excluir o exame deixa a tarefa com exam_id nulo (ON DELETE SET NULL (exam_id)) — a tarefa não some', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'falhou', erro: 'interrompida' });
    expect(await excluirExame(T.ctx, p.id, examId, { db: app.db, dataDir })).toBe(true);
    const [t] = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db);
    expect(t).toMatchObject({ id, examId: null, patientId: p.id, status: 'falhou' });
  });

  it('RNF-110: ninguém apaga tarefa de paciente não anonimizado — nem a nutricionista nem o worker (gatilho, 42501); ninguém apaga ia_uso', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'falhou', erro: 'interrompida' });
    expect(await falhaCom(withTenant(T.ctx, (tx) => tx.delete(iaTarefas).where(eq(iaTarefas.id, id)), app.db))).toBe('42501');
    // o papel worker também roda no processo web: sem o paciente anonimizado, o gatilho recusa (a anonimização apaga: T15)
    expect(await falhaCom(withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.delete(iaTarefas).where(eq(iaTarefas.id, id)), app.db))).toBe('42501');
    await withTenant(T.ctx, (tx) => tx.insert(iaUso).values({ tenantId: T.tenantId, tarefaId: id, tipo: 'leitura_exame', modelo: 'claude-opus-5-5', promptVersao: 'x', custoMicroUsd: 10, mes: '2026-10' }), app.db);
    expect(await falhaCom(withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.delete(iaUso).where(eq(iaUso.tarefaId, id)), app.db))).toBe('42501');
  });

  it('CHECKs: resultado só em "pronta"; erro só em "falhou"; tipo só leitura_exame; uma leitura em andamento por exame', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const resultado = { versao: 1 as const, dataColeta: null, linhas: [], descartadas: 0 };
    expect(await falhaCom(tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'falhou', erro: 'recusa', resultado }))).toBe('23514');
    expect(await falhaCom(tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'pronta', erro: 'recusa' }))).toBe('23514');
    expect(await falhaCom(tarefaNoBanco(app.db, T.ctx, p.id, examId, { tipo: 'resumo_historico' }))).toBe('23514');
    await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'na_fila' });
    expect(await falhaCom(tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'processando' }))).toBe('23505');
  });

  it('a sessão de paciente não altera a ciência nem a recusa de IA (gatilho paciente_colunas, 0085)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const comoPaciente = { tenantId: T.tenantId, role: 'paciente' as const, patientId: p.id, actorUserId: randomUUID() };
    const mudar = (set: Partial<typeof patients.$inferInsert>) => withTenant(comoPaciente, (tx) => tx.update(patients).set(set).where(eq(patients.id, p.id)), app.db);
    expect(await falhaCom(mudar({ iaAvisoVersao: '9', iaAvisoEm: new Date(), iaAvisoCanal: 'email' }))).toBe('42501');
    expect(await falhaCom(mudar({ iaRecusadaEm: new Date() }))).toBe('42501');
  });

  it('RN-128 (Plano 14A, 0109): as colunas de ciência e recusa do Plano 11 estão congeladas para qualquer sessão do app; no contexto vazio, passam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    // (o contexto publico não vê a linha para o UPDATE — PUBLICO_LIBERADO.patients é só select/insert —, então só o INSERT dele abaixo)
    const contextos = [T.ctx, { tenantId: T.tenantId, role: 'worker' as const }];
    for (const ctx of contextos) {
      for (const set of [{ iaRecusadaEm: new Date() }, { iaAvisoEnviadoEm: new Date() }, { iaAvisoVersao: '0.1-provisorio', iaAvisoEm: new Date(), iaAvisoCanal: 'em_maos' }]) {
        expect(await falhaCom(withTenant(ctx, (tx) => tx.update(patients).set(set).where(eq(patients.id, p.id)), app.db)), `${ctx.role} ${Object.keys(set)}`).toBe('42501');
      }
    }
    expect(await falhaCom(novoPaciente(app.db, T.ctx, { iaAvisoVersao: '1', iaAvisoEm: new Date(), iaAvisoCanal: 'em_maos' }))).toBe('42501');
    expect(await falhaCom(novoPaciente(app.db, { tenantId: T.tenantId, role: 'publico' }, { origem: 'agendamento_publico', iaRecusadaEm: new Date() }))).toBe('42501');
    // contexto vazio (migration, script do dono): passa — a remoção futura das colunas é a PM-17
    await dono.db.update(patients).set({ iaRecusadaEm: new Date() }).where(eq(patients.id, p.id));
    // o resto do cadastro segue livre para a nutricionista
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ nome: 'Ana Souza Lima' }).where(eq(patients.id, p.id)), app.db);
  });

  it('Minor 2 (revisão final): a tarefa não muda de consultório, de paciente, de exame, de quem pediu nem de modelo; saiu_em não volta a nulo', async () => {
    const T = await novoTenant(app.db);
    const outro = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const p2 = await novoPaciente(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const outroExame = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const saiu = new Date('2026-10-01T12:00:00Z');
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'falhou', erro: 'interrompida', saiuEm: saiu });
    const mudar = (set: Partial<typeof iaTarefas.$inferInsert>) => withTenant(T.ctx, (tx) => tx.update(iaTarefas).set(set).where(eq(iaTarefas.id, id)), app.db);
    expect(await falhaCom(mudar({ patientId: p2.id }))).toBe('42501');
    expect(await falhaCom(mudar({ tenantId: outro.tenantId }))).toBe('42501');
    expect(await falhaCom(mudar({ examId: outroExame }))).toBe('42501');
    expect(await falhaCom(mudar({ pedidoPor: randomUUID() }))).toBe('42501');
    expect(await falhaCom(mudar({ modelo: 'outro' }))).toBe('42501');
    expect(await falhaCom(mudar({ saiuEm: null }))).toBe('42501');
    expect(await falhaCom(mudar({ saiuEm: new Date() }))).toBe('42501');
    expect(await falhaCom(withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(iaTarefas).set({ saiuEm: null }).where(eq(iaTarefas.id, id)), app.db))).toBe('42501');
    // o que a execução muda segue livre, e o exame só vai a nulo
    await mudar({ status: 'cancelada', erro: null, encerradoEm: new Date(), updatedAt: new Date() });
    await mudar({ examId: null });
    const [t] = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db);
    expect(t).toMatchObject({ patientId: p.id, examId: null, status: 'cancelada', saiuEm: saiu });
  });

  it('Minor 3 (revisão final): os interruptores da admin (IA, limite, documentos) não mudam de dentro de withTenant; fora dele, sim', async () => {
    const T = await novoTenant(app.db);
    const contextos = [T.ctx, { tenantId: T.tenantId, role: 'worker' as const }, { tenantId: T.tenantId, role: 'publico' as const }];
    for (const ctx of contextos) {
      for (const set of [{ iaLiberada: true }, { iaCotaMensalUsd: 999 }, { documentosLiberados: true }]) {
        expect(await falhaCom(withTenant(ctx, (tx) => tx.update(tenants).set(set).where(eq(tenants.id, T.tenantId)), app.db)), `${ctx.role} ${Object.keys(set)[0]}`).toBe('42501');
      }
    }
    // a nutricionista ainda ativa e desativa a IA (outras colunas) dentro do withTenant
    await withTenant(T.ctx, (tx) => tx.update(tenants).set({ iaAtivadaEm: null, updatedAt: new Date() }).where(eq(tenants.id, T.tenantId)), app.db);
    // a admin (sem app.role) liga
    await app.db.update(tenants).set({ iaLiberada: true, iaCotaMensalUsd: 20, documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toMatchObject({ iaLiberada: true, iaCotaMensalUsd: 20, documentosLiberados: true });
  });

  it('Minor 4 (revisão final): o worker apaga a tarefa do paciente anonimizado (único DELETE permitido)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', bloqueadoEm: new Date(), anonimizadoEm: new Date() });
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'cancelada' });
    expect(await falhaCom(withTenant(T.ctx, (tx) => tx.delete(iaTarefas).where(eq(iaTarefas.id, id)), app.db))).toBe('42501');
    const r = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.delete(iaTarefas).where(eq(iaTarefas.id, id)).returning({ id: iaTarefas.id }), app.db);
    expect(r).toEqual([{ id }]);
  });

  it('a ciência é "tudo ou nada" e o canal é da lista', async () => {
    const T = await novoTenant(app.db);
    // pelo dono (contexto vazio): o gatilho da 0109 recusa antes do CHECK em qualquer sessão do app (e-mail, nascimento e sexo
    // preenchidos para a recusa vir só do CHECK da ciência)
    const base = { tenantId: T.tenantId, nome: 'X', dataNascimento: '1991-03-10', sexo: 'F', email: `x-${randomUUID().slice(0, 8)}@ex.com` };
    expect(await falhaCom(dono.db.insert(patients).values({ ...base, iaAvisoVersao: '0.1-provisorio' }))).toBe('23514');
    expect(await falhaCom(dono.db.insert(patients).values({ ...base, iaAvisoVersao: '1', iaAvisoEm: new Date(), iaAvisoCanal: 'whatsapp' }))).toBe('23514');
  });

  it('admin_actions: as ações de IA exigem o consultório e nenhum usuário-alvo; o 2FA continua exigindo o usuário', async () => {
    const T = await novoTenant(app.db);
    const admin = randomUUID();
    await app.db.insert(adminActions).values({ adminUserId: admin, acao: 'liberar_ia', alvoTenantId: T.tenantId, origem: 'admin' });
    expect(await falhaCom(app.db.insert(adminActions).values({ adminUserId: admin, acao: 'ajustar_cota_ia', origem: 'admin' }))).toBe('23514');
    expect(await falhaCom(app.db.insert(adminActions).values({ adminUserId: admin, acao: 'bloquear_ia', alvoTenantId: T.tenantId, alvoUserId: admin, alvoPapel: 'nutri', origem: 'admin' }))).toBe('23514');
    expect(await falhaCom(app.db.insert(adminActions).values({ adminUserId: admin, acao: 'liberar_ia', alvoTenantId: T.tenantId, alvoUserId: admin, origem: 'admin' }))).toBe('23514'); // usuário sem papel também não
    expect(await falhaCom(app.db.insert(adminActions).values({ adminUserId: admin, acao: 'reiniciar_2fa', alvoTenantId: T.tenantId, origem: 'admin' }))).toBe('23514');
  });

  it('admin_metricas_ia(): só contagens e somas do mês, por tenant; recusa rodar dentro de withTenant', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    const mes = await app.db.execute<{ m: string }>(sql`select to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') as m`);
    const m = mes.rows[0].m;
    await withTenant(T.ctx, (tx) => tx.insert(iaUso).values([
      { tenantId: T.tenantId, tarefaId: randomUUID(), tipo: 'leitura_exame', modelo: 'claude-opus-5-5', promptVersao: 'x', custoMicroUsd: 170_000, situacao: 'confirmado', mes: m },
      { tenantId: T.tenantId, tarefaId: randomUUID(), tipo: 'leitura_exame', modelo: 'claude-opus-5-5', promptVersao: 'x', custoMicroUsd: 900_000, situacao: 'estornado', mes: m },
    ]), app.db);
    const r = await app.db.execute<{ tenant_id: string; tarefas_mes: string; custo_mes_micro_usd: string }>(sql`select * from admin_metricas_ia()`);
    expect(r.rows.find((x) => x.tenant_id === T.tenantId)).toMatchObject({ tarefas_mes: '2', custo_mes_micro_usd: '170000' });
    expect(await falhaCom(withTenant(T.ctx, (tx) => tx.execute(sql`select * from admin_metricas_ia()`), app.db))).toBe('55000');
  });

  it('exams: a UNIQUE nova (tenant_id, patient_id, id) existe para a FK da tarefa', async () => {
    const r = await app.db.execute<{ n: number }>(sql`select count(*)::int as n from pg_constraint where conname = 'exams_tenant_paciente_id_unique'`);
    expect(r.rows[0].n).toBe(1);
    expect(exams).toBeDefined();
  });
});
