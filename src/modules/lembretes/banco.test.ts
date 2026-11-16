import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, lembretesRotina, lembretesRotinaEnvios, patients } from '@/db/schema';
import type { Tx } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 17 (spec §5.3, §5.5): o banco confere quem muda o quê nos lembretes de rotina — gatilhos lembretes_rotina_regras,
 * lembretes_rotina_envios_do_worker e patients_lembretes_do_paciente, e a lista de colunas do paciente (paciente_colunas), 0119.
 */
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

const AGUA = { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: [0, 1, 2, 3, 4, 5, 6] };
const HORARIOS = { horarios: ['08:00'], dias: [1, 2, 3, 4, 5] };
/** Data bem no passado: o gatilho troca pelo relógio do banco, então o valor gravado nunca é este. */
const ANTIGA = new Date('2000-01-01T00:00:00Z');
const recente = (d: Date | null) => d !== null && Math.abs(d.getTime() - Date.now()) < 60_000;

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const comoPaciente = ctxPaciente(T.tenantId, p.id);
  const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
  const em = <R>(ctx: TenantContext, fn: (tx: Tx) => Promise<R>) => withTenant(ctx, fn, app.db);
  const criar = (v: Partial<typeof lembretesRotina.$inferInsert> = {}, ctx: TenantContext = T.ctx) =>
    em(ctx, (tx) =>
      tx
        .insert(lembretesRotina)
        .values({ tenantId: T.tenantId, patientId: p.id, tipo: 'agua', config: AGUA, criadoPor: T.nutriId, ...v })
        .returning(),
    ).then((r) => r[0]);
  const lembrete = (ctx: TenantContext, id: string, v: Partial<typeof lembretesRotina.$inferInsert>) =>
    em(ctx, (tx) => tx.update(lembretesRotina).set(v).where(eq(lembretesRotina.id, id)).returning());
  const paciente = (ctx: TenantContext, v: Partial<typeof patients.$inferInsert>) =>
    em(ctx, (tx) => tx.update(patients).set(v).where(eq(patients.id, p.id)).returning());
  return { T, p, comoPaciente, worker, em, criar, lembrete, paciente };
}

describe('lembretes_rotina: quem muda o quê (Plano 17, §5.3)', () => {
  it('paciente só desliga o próprio lembrete', async () => {
    const { T, p, comoPaciente, criar, lembrete } = await cenario();
    const agua = await criar();
    const supl = await criar({ tipo: 'suplemento', config: HORARIOS, texto: 'Vitamina D' });

    const [desligado] = await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: ANTIGA, updatedAt: ANTIGA });
    expect(desligado.desligadoPeloPacienteEm).not.toEqual(ANTIGA); // o valor é o do banco (clock_timestamp)
    expect(recente(desligado.desligadoPeloPacienteEm)).toBe(true);
    // religar também é do paciente
    expect((await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: null }))[0].desligadoPeloPacienteEm).toBeNull();

    expect(await falhaCom(lembrete(comoPaciente, agua.id, { config: { ...AGUA, intervaloMin: 60 } }))).toBe('42501');
    expect(await falhaCom(lembrete(comoPaciente, agua.id, { ligado: false }))).toBe('42501');
    expect(await falhaCom(lembrete(comoPaciente, supl.id, { texto: 'Outro' }))).toBe('42501');
    expect(await falhaCom(lembrete(comoPaciente, supl.id, { criadoPor: randomUUID() }))).toBe('42501');

    // o de outro paciente do mesmo consultório nem aparece (RLS de paciente)
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await lembrete(ctxPaciente(T.tenantId, outro.id), agua.id, { desligadoPeloPacienteEm: new Date() })).toEqual([]);
    const [depois] = await withTenant(T.ctx, (tx) => tx.select().from(lembretesRotina).where(eq(lembretesRotina.id, agua.id)), app.db);
    expect(depois).toMatchObject({ patientId: p.id, desligadoPeloPacienteEm: null, ligado: true });
  });

  it('paciente pausa os próprios lembretes', async () => {
    const { comoPaciente, paciente } = await cenario();
    const [pausado] = await paciente(comoPaciente, { lembretesPausadosEm: ANTIGA });
    expect(pausado.lembretesPausadosEm).not.toEqual(ANTIGA);
    expect(recente(pausado.lembretesPausadosEm)).toBe(true);
    expect((await paciente(comoPaciente, { lembretesPausadosEm: null }))[0].lembretesPausadosEm).toBeNull();
  });

  it('nutricionista não religa', async () => {
    const { T, comoPaciente, criar, lembrete, paciente } = await cenario();
    const agua = await criar();
    const [desligado] = await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: new Date() });
    await paciente(comoPaciente, { lembretesPausadosEm: new Date() });

    expect(await falhaCom(lembrete(T.ctx, agua.id, { desligadoPeloPacienteEm: null }))).toBe('42501');
    expect(await falhaCom(lembrete(T.ctx, agua.id, { desligadoPeloPacienteEm: new Date() }))).toBe('42501');
    expect(await falhaCom(paciente(T.ctx, { lembretesPausadosEm: null }))).toBe('42501');
    expect(await falhaCom(paciente(T.ctx, { lembretesPausadosEm: new Date() }))).toBe('42501');

    // UPDATE sem mudança passa; editar o lembrete não limpa a marca do paciente (Review Focus 5)
    // (em SQL: o Date do JS perde os microssegundos do clock_timestamp e seria uma mudança de verdade)
    const semMudanca = sql`update lembretes_rotina set desligado_pelo_paciente_em = desligado_pelo_paciente_em, tenant_id = tenant_id, patient_id = patient_id where id = ${agua.id}`;
    expect((await withTenant(T.ctx, (tx) => tx.execute(semMudanca), app.db)).rowCount).toBe(1);
    const [editado] = await lembrete(T.ctx, agua.id, { config: { ...AGUA, intervaloMin: 60 }, ligado: false, updatedAt: new Date() });
    expect(editado.desligadoPeloPacienteEm).toEqual(desligado.desligadoPeloPacienteEm);
    expect(await paciente(T.ctx, { nome: 'Ana Souza' })).toHaveLength(1);

    // a exclusão atendida (Tarefa 7) limpa a pausa no mesmo UPDATE que leva a `bloqueado` — e só limpa
    expect(await falhaCom(paciente(T.ctx, { status: 'bloqueado', bloqueadoEm: new Date(), lembretesPausadosEm: new Date() }))).toBe('42501');
    const [bloqueado] = await paciente(T.ctx, { status: 'bloqueado', bloqueadoEm: new Date(), lembretesPausadosEm: null });
    expect(bloqueado).toMatchObject({ status: 'bloqueado', lembretesPausadosEm: null });
  });

  it('a equipe não grava a marca do paciente ao criar (lembrete nem paciente)', async () => {
    const { T, criar } = await cenario();
    expect(await falhaCom(criar({ desligadoPeloPacienteEm: new Date() }))).toBe('42501');
    expect(await falhaCom(novoPaciente(app.db, T.ctx, { lembretesPausadosEm: new Date() }))).toBe('42501');
  });

  it('público e conta não alteram; colunas fixas para todos, inclusive o worker', async () => {
    const { T, p, comoPaciente, worker, criar, lembrete, paciente } = await cenario();
    const agua = await criar();
    expect(await falhaCom(lembrete(worker, agua.id, { tipo: 'refeicoes' }))).toBe('42501');
    expect(await falhaCom(lembrete(worker, agua.id, { criadoPor: randomUUID() }))).toBe('42501');
    expect(await falhaCom(lembrete(T.ctx, agua.id, { createdAt: new Date() }))).toBe('42501');
    // o worker (anonimização) muda as marcas do paciente
    await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: new Date() });
    expect((await lembrete(worker, agua.id, { desligadoPeloPacienteEm: null }))[0].desligadoPeloPacienteEm).toBeNull();
    await paciente(comoPaciente, { lembretesPausadosEm: new Date() });
    expect((await paciente(worker, { lembretesPausadosEm: null }))[0].lembretesPausadosEm).toBeNull();
    // o público lê patients (PUBLICO_LIBERADO), mas não altera a linha (sem UPDATE na RLS; o gatilho é a segunda linha)
    expect(await paciente({ tenantId: T.tenantId, role: 'publico' }, { lembretesPausadosEm: new Date() })).toEqual([]);
    const [visto] = await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), app.db);
    expect(visto).toMatchObject({ id: p.id, lembretesPausadosEm: null });
  });

  it('CHECK do texto por tipo', async () => {
    const { criar } = await cenario();
    expect(await falhaCom(criar({ tipo: 'agua', texto: 'Água' }))).toBe('23514');
    expect(await falhaCom(criar({ tipo: 'suplemento', config: HORARIOS, texto: null }))).toBe('23514');
    expect(await falhaCom(criar({ tipo: 'suplemento', config: HORARIOS, texto: '   ' }))).toBe('23514');
    expect(await falhaCom(criar({ tipo: 'suplemento', config: HORARIOS, texto: 'x'.repeat(61) }))).toBe('23514');
    expect(await falhaCom(criar({ tipo: 'livre', config: HORARIOS, texto: null }))).toBe('23514');
    expect(await falhaCom(criar({ tipo: 'livre', config: HORARIOS, texto: 'x'.repeat(121) }))).toBe('23514');
    expect(await falhaCom(criar({ tipo: 'pesagem' }))).toBe('23514');
    await criar({ tipo: 'suplemento', config: HORARIOS, texto: 'x'.repeat(60) });
    await criar({ tipo: 'livre', config: HORARIOS, texto: 'x'.repeat(120) });
    await criar({ tipo: 'livre', config: HORARIOS, texto: 'Outro lembrete livre' }); // suplemento e livre: vários
    // água e refeições: um por paciente (índice único parcial)
    await criar();
    expect(await falhaCom(criar())).toBe('23505');
    await criar({ tipo: 'refeicoes', config: { antecedenciaMin: 0, diarioDepoisMin: null } });
    expect(await falhaCom(criar({ tipo: 'refeicoes', config: { antecedenciaMin: 15, diarioDepoisMin: 30 } }))).toBe('23505');
  });
});

describe('lembretes_rotina: a equipe não apaga o que o paciente desligou (Plano 17, §5.3; 0120)', () => {
  const apagar = (ctx: TenantContext, id: string) =>
    withTenant(ctx, (tx) => tx.delete(lembretesRotina).where(eq(lembretesRotina.id, id)).returning({ id: lembretesRotina.id }), app.db);

  it('nutri não apaga o lembrete desligado pelo paciente', async () => {
    const { T, comoPaciente, criar, lembrete } = await cenario();
    const agua = await criar();
    await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: new Date() });
    expect(await falhaCom(apagar(T.ctx, agua.id))).toBe('42501');
    // continua lá, e a equipe ainda o desliga do lado dela
    expect((await lembrete(T.ctx, agua.id, { ligado: false }))[0]).toMatchObject({ ligado: false });
  });

  it('nutri apaga lembrete não desligado', async () => {
    const { T, criar } = await cenario();
    const agua = await criar();
    expect(await apagar(T.ctx, agua.id)).toEqual([{ id: agua.id }]);
  });

  it('com o paciente bloqueado, a nutri apaga o desligado', async () => {
    const { T, comoPaciente, criar, lembrete, paciente } = await cenario();
    const agua = await criar();
    await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: new Date() });
    await paciente(T.ctx, { status: 'bloqueado', bloqueadoEm: new Date() });
    expect(await apagar(T.ctx, agua.id)).toEqual([{ id: agua.id }]);
  });

  it('o worker apaga o desligado', async () => {
    const { comoPaciente, worker, criar, lembrete } = await cenario();
    const agua = await criar();
    await lembrete(comoPaciente, agua.id, { desligadoPeloPacienteEm: new Date() });
    expect(await apagar(worker, agua.id)).toEqual([{ id: agua.id }]);
  });
});

describe('lembretes_rotina_envios: a marca do último envio (Plano 17, §5.5)', () => {
  it('marca de envio só pelo worker', async () => {
    const { T, worker, em, criar } = await cenario();
    const agua = await criar();
    const marca = (ctx: TenantContext, em2: Date) =>
      em(ctx, (tx) => tx.insert(lembretesRotinaEnvios).values({ lembreteId: agua.id, tenantId: T.tenantId, patientId: agua.patientId, ultimoSlotEm: em2 }).returning());
    const mudar = (ctx: TenantContext, q: SQL) => em(ctx, (tx) => tx.execute(q));

    expect(await falhaCom(marca(T.ctx, new Date()))).toBe('42501');
    const [m] = await marca(worker, new Date('2026-11-16T11:00:00Z'));
    expect(m.ultimoSlotEm).toEqual(new Date('2026-11-16T11:00:00Z'));

    // UPDATE sem mudança passa pela equipe (o teste de isolamento faz `set tenant_id = tenant_id`); com mudança, não
    expect((await mudar(T.ctx, sql`update lembretes_rotina_envios set ultimo_slot_em = ultimo_slot_em`)).rowCount).toBe(1);
    expect(await falhaCom(mudar(T.ctx, sql`update lembretes_rotina_envios set ultimo_slot_em = now()`))).toBe('42501');
    expect((await mudar(worker, sql`update lembretes_rotina_envios set ultimo_slot_em = '2026-11-16T13:00:00Z', updated_at = now()`)).rowCount).toBe(1);
    // tenant, paciente e lembrete fixos, inclusive para o worker
    expect(await falhaCom(mudar(worker, sql`update lembretes_rotina_envios set lembrete_id = gen_random_uuid()`))).toBe('42501');

    // apagar o lembrete leva a marca junto (ON DELETE CASCADE)
    await em(T.ctx, (tx) => tx.delete(lembretesRotina).where(eq(lembretesRotina.id, agua.id)));
    expect(await em(worker, (tx) => tx.select().from(lembretesRotinaEnvios))).toEqual([]);
  });

  it('escrita da equipe vira audit_log', async () => {
    const { T, p, worker, em, criar } = await cenario();
    const agua = await criar();
    const doPaciente = () => em(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.patientId, p.id))));
    expect((await doPaciente()).filter((l) => l.entidade === 'lembretes')).toEqual([
      expect.objectContaining({ acao: 'criar', entidadeId: agua.id, actorUserId: T.nutriId }),
    ]);
    const antes = (await doPaciente()).length;
    await em(worker, (tx) => tx.insert(lembretesRotinaEnvios).values({ lembreteId: agua.id, tenantId: T.tenantId, patientId: p.id, ultimoSlotEm: new Date() }));
    await em(worker, (tx) => tx.update(lembretesRotinaEnvios).set({ ultimoSlotEm: new Date(), updatedAt: new Date() }));
    expect(await doPaciente()).toHaveLength(antes);
  });
});
