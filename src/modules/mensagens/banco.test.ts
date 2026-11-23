import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 25 (spec §9.1–§9.6): as seis tabelas do chat e dos recados no banco — RLS (paciente_chat_envio,
 * paciente_leitura_propria_*, paciente_com_conta, staff_only de recados, paciente_arquivo_insert refeita), CHECKs, REVOKE/GRANT
 * e auditoria. Tudo por SQL cru, sem o módulo (T2 em diante): é o que o banco garante sozinho. Os gatilhos (T1b) e as funções
 * SECURITY DEFINER (T1c, em src/db/migrate-owner.test.ts) acrescentam os próprios `describe`s.
 *
 * Os CHECKs são provados pelo dono (superusuário, sem papel): é o contexto em que os gatilhos da T1b devolvem NEW cedo, para a
 * recusa vir da restrição e não do gatilho.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const comoDono = async (q: SQL): Promise<Row[]> => (await owner.db.execute(q)).rows as Row[];
const naConta = async (q: SQL): Promise<Row[]> => (await withConta(randomUUID(), (tx) => tx.execute(q), app.db)).rows as Row[];
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
const publico = (tenantId: string): TenantContext => ({ tenantId, role: 'publico' });
const semConta = (tenantId: string, patientId: string): TenantContext => ({ tenantId, role: 'paciente', patientId, semConta: true });

const erro = (e: unknown) => {
  let x = e as { code?: string; constraint?: string; message?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 5; i++) {
    if (x.code) return { code: x.code, constraint: x.constraint, message: (x.cause as { message?: string } | undefined)?.message ?? x.message ?? '' };
    x = x.cause as typeof x;
  }
  return { code: undefined, constraint: undefined, message: '' };
};
/** Recusa da RLS da própria tabela (WITH CHECK), nunca de outro motivo. */
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
/** 42501 do gatilho com a mensagem do ramo esperado (não da RLS, da permissão nem de outro ramo do gatilho). */
const doGatilho = (trecho: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && message.includes(trecho) && !/row-level security|permission denied/.test(message);
};
const restricao = (codigo: string, nome: string) => (e: unknown) => {
  const r = erro(e);
  return r.code === codigo && r.constraint === nome;
};
const check = (nome: string) => restricao('23514', nome);

const CARIMBO = { nome: 'Débora Nutricionista', crn: 'CRN-3 12345' };
/** CH-D74: os exemplos novos com o CRN da Debby (CRN-4, RJ). */
const CARIMBO_4 = { nome: 'Debora Rodrigues', crn: 'CRN-4 12345' };
const TABELAS_CHAT = ['chat_conversas', 'chat_mensagens', 'chat_leituras', 'chat_configuracoes', 'chat_horarios'] as const;
// CH-D70: chat_avisos_nutri (staff_only, sem paciente_com_conta: a staff_only já nega toda sessão de paciente)
const TODAS = [...TABELAS_CHAT, 'recados', 'chat_avisos_nutri'] as const;

type Cenario = TenantDeTeste & { p1: string; p2: string; u1: string; u2: string; P1: TenantContext; P2: TenantContext };

/** Tenant com carimbo profissional, dois pacientes ativos com a conversa liberada e as contas (ator) de cada um. */
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', [CARIMBO.nome, CARIMBO.crn, T.tenantId]);
  const p1 = (await novoPaciente(app.db, T.ctx)).id;
  const p2 = (await novoPaciente(app.db, T.ctx)).id;
  const [u1, u2] = [randomUUID(), randomUUID()];
  const C = { ...T, p1, p2, u1, u2, P1: ctxPaciente(T.tenantId, p1, u1), P2: ctxPaciente(T.tenantId, p2, u2) };
  for (const p of [p1, p2]) await liberar(C, p);
  return C;
}
const liberar = (C: TenantDeTeste, p: string) =>
  em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma) values (${C.tenantId}, ${p}, now(), ${C.nutriId}, 'aceite_escrito') returning id`);

type Msg = {
  patientId?: string;
  autor?: string;
  autorUserId?: string;
  autorNome?: string | null;
  autorCrn?: string | null;
  texto?: string | null;
  recadoId?: string | null;
  duvidaEm?: string | null;
  risco?: string | null;
  anexoStatus?: string;
  anexoPath?: string | null;
  anexoOriginalPath?: string | null;
  anexoTipo?: string | null;
  anexoNome?: string | null;
};
/** INSERT em chat_mensagens; por padrão, texto do paciente P1 com o ator dele. */
const mensagem = (C: Cenario, m: Msg = {}) => sql`
  insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto, recado_id, duvida_em, risco,
                              anexo_status, anexo_path, anexo_original_path, anexo_tipo, anexo_nome)
  values (${C.tenantId}, ${m.patientId ?? C.p1}, ${m.autor ?? 'paciente'}, ${m.autorUserId ?? C.u1}, ${m.autorNome ?? null}, ${m.autorCrn ?? null},
          ${m.texto === undefined ? 'Oi' : m.texto}, ${m.recadoId ?? null}, ${m.duvidaEm ?? null}::timestamptz, ${m.risco ?? null},
          ${m.anexoStatus ?? 'sem_anexo'}, ${m.anexoPath ?? null}, ${m.anexoOriginalPath ?? null}, ${m.anexoTipo ?? null}, ${m.anexoNome ?? null})
  returning id`;
const daNutri = (C: Cenario, m: Msg = {}) =>
  mensagem(C, { autor: 'nutri', autorUserId: C.nutriId, autorNome: CARIMBO.nome, autorCrn: CARIMBO.crn, texto: 'Olá', ...m });

/** stored_files gravado pelo dono (a cota e o tipo pelo conteúdo são do módulo, T8). */
const arquivo = async (C: TenantDeTeste, p: string, tipo: string, pasta = tipo) =>
  (
    await comoDono(
      sql`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values (${C.tenantId}, ${p}, ${tipo}, ${`${C.tenantId}/${pasta}/${randomUUID()}.jpg`}, 10, 'image/jpeg') returning caminho`,
    )
  )[0].caminho as string;
const recado = async (C: Cenario) =>
  (
    await em(
      C.ctx,
      sql`insert into recados (tenant_id, texto, filtro, filtro_rotulo, destinatarios, autor_nome, autor_crn, criado_por)
          values (${C.tenantId}, 'Feriado', '{"tipo":"todos"}', 'Todos os pacientes com app', 2, ${CARIMBO.nome}, ${CARIMBO.crn}, ${C.nutriId}) returning id`,
    )
  )[0].id as string;
const leitura = (C: TenantDeTeste, p: string, lado: string) =>
  sql`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values (${C.tenantId}, ${p}, ${lado}, now())`;

describe('Plano 25 — RLS das tabelas do chat (spec §9.1–§9.5)', () => {
  it('paciente com conta lê só a própria conversa, as próprias mensagens e o próprio marcador; lê a configuração e o horário; não lê recados', async () => {
    const C = await cenario();
    for (const p of [C.p1, C.p2]) {
      await em(C.ctx, daNutri(C, { patientId: p }));
      await em(C.ctx, leitura(C, p, 'consultorio'));
    }
    await em(C.P1, leitura(C, C.p1, 'paciente'));
    await em(C.ctx, sql`insert into chat_configuracoes (tenant_id, horario_ativo) values (${C.tenantId}, true)`);
    await em(C.ctx, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, 1, 480, 720)`);
    await recado(C);

    const conversas = await em(C.P1, sql`select patient_id from chat_conversas`);
    expect(conversas).toEqual([{ patient_id: C.p1 }]);
    const msgs = await em(C.P1, sql`select patient_id from chat_mensagens`);
    expect(msgs).toEqual([{ patient_id: C.p1 }]);
    // o SELECT fica livre dentro do próprio paciente: o portal lê o lida_ate do consultório para mostrar "Lida"
    const lidas = await em(C.P1, sql`select patient_id, lado from chat_leituras order by lado`);
    expect(lidas).toEqual([
      { patient_id: C.p1, lado: 'consultorio' },
      { patient_id: C.p1, lado: 'paciente' },
    ]);
    expect(await em(C.P1, sql`select horario_ativo from chat_configuracoes`)).toEqual([{ horario_ativo: true }]);
    expect(await em(C.P1, sql`select dia_semana from chat_horarios`)).toEqual([{ dia_semana: 1 }]);
    expect(await em(C.P1, sql`select 1 from recados`)).toEqual([]);
    expect((await em(C.ctx, sql`select 1 from recados`)).length).toBe(1); // a linha existe: é a staff_only que esconde
  });

  it('paciente sem conta (semConta) não lê nem grava nenhuma chat_* (paciente_com_conta)', async () => {
    const C = await cenario();
    await em(C.ctx, daNutri(C));
    await em(C.ctx, leitura(C, C.p1, 'consultorio'));
    await em(C.ctx, sql`insert into chat_configuracoes (tenant_id) values (${C.tenantId})`);
    await em(C.ctx, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, 1, 480, 720)`);
    await em(C.ctx, sql`insert into chat_avisos_nutri (tenant_id) values (${C.tenantId})`); // a linha existe: é a staff_only que esconde
    await recado(C);
    for (const t of TODAS) expect((await em(C.ctx, sql`select 1 from ${sql.identifier(t)}`)).length, t).toBeGreaterThan(0);
    const S = semConta(C.tenantId, C.p1);
    for (const t of TODAS) expect(await em(S, sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
    const novo = (await novoPaciente(app.db, C.ctx)).id;
    await expect(em(semConta(C.tenantId, novo), sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${novo})`)).rejects.toSatisfy(rlsDe('chat_conversas'));
    await expect(em(S, mensagem(C))).rejects.toSatisfy(rlsDe('chat_mensagens'));
    await expect(em(S, leitura(C, C.p1, 'paciente'))).rejects.toSatisfy(rlsDe('chat_leituras'));
    expect((await withTenant(S, (tx) => tx.execute(sql`update chat_leituras set lida_ate = now()`), app.db)).rowCount).toBe(0);
    await expect(em(S, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, 2, 480, 720)`)).rejects.toSatisfy(rlsDe('chat_horarios'));
    const T2 = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T2.ctx)).id;
    await expect(em(semConta(T2.tenantId, p), sql`insert into chat_configuracoes (tenant_id) values (${T2.tenantId})`)).rejects.toSatisfy(rlsDe('chat_configuracoes'));
  });

  it('a política paciente_com_conta existe, RESTRICTIVE e FOR ALL, nas cinco chat_* (e não em recados, que é staff_only)', async () => {
    const { rows } = await owner.pool.query<{ t: string; cmd: string; permissive: string; qual: string; with_check: string }>(
      `select tablename as t, cmd, permissive, qual, with_check from pg_policies where schemaname = 'public' and policyname = 'paciente_com_conta' order by 1`,
    );
    expect(rows.map((r) => r.t)).toEqual([...TABELAS_CHAT].sort());
    for (const r of rows) {
      expect(r, r.t).toMatchObject({ cmd: 'ALL', permissive: 'RESTRICTIVE' });
      expect(r.qual, r.t).toMatch(/app_current_user\(\) IS NOT NULL/);
      expect(r.with_check, r.t).toMatch(/app_current_user\(\) IS NOT NULL/);
    }
  });

  it('publico e conta não leem nem gravam nada nas seis tabelas', async () => {
    const C = await cenario();
    await em(C.ctx, daNutri(C));
    await em(C.ctx, leitura(C, C.p1, 'consultorio'));
    await em(C.ctx, sql`insert into chat_configuracoes (tenant_id) values (${C.tenantId})`);
    await em(C.ctx, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, 1, 480, 720)`);
    await recado(C);
    await em(C.ctx, sql`insert into chat_avisos_nutri (tenant_id) values (${C.tenantId})`);
    // as linhas das sete tabelas existem (lidas pela equipe): é a política que esconde
    for (const t of TODAS) expect((await em(C.ctx, sql`select 1 from ${sql.identifier(t)}`)).length, t).toBeGreaterThan(0);
    for (const t of TODAS) {
      expect(await em(publico(C.tenantId), sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
      expect(await naConta(sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
    }
    const novo = (await novoPaciente(app.db, C.ctx)).id;
    const escritas: [string, SQL][] = [
      ['chat_conversas', sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${novo})`],
      ['chat_mensagens', daNutri(C)],
      ['chat_leituras', leitura(C, C.p2, 'consultorio')],
      ['chat_horarios', sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, 3, 480, 720)`],
      ['recados', sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por) values (${C.tenantId}, 'x', '{"tipo":"todos"}', 1, 'Nome Teste', 'CRN', ${randomUUID()})`],
    ];
    for (const [t, q] of escritas) {
      await expect(em(publico(C.tenantId), q), t).rejects.toSatisfy(rlsDe(t));
      await expect(withConta(randomUUID(), (tx) => tx.execute(q), app.db), t).rejects.toSatisfy(rlsDe(t));
    }
    const T2 = await novoTenant(app.db);
    const conf = sql`insert into chat_configuracoes (tenant_id) values (${T2.tenantId})`;
    await expect(em(publico(T2.tenantId), conf)).rejects.toSatisfy(rlsDe('chat_configuracoes'));
    await expect(withConta(randomUUID(), (tx) => tx.execute(conf), app.db)).rejects.toSatisfy(rlsDe('chat_configuracoes'));
  });

  it('o worker do tenant B não muda o anexo de mensagem do tenant A (0 linhas)', async () => {
    const A = await cenario();
    const B = await cenario();
    const [m] = await em(A.ctx, daNutri(A));
    const r = await withTenant(worker(B.tenantId), (tx) => tx.execute(sql`update chat_mensagens set anexo_status = 'falhou', updated_at = now() where id = ${m.id}`), app.db);
    expect(r.rowCount).toBe(0);
    expect((await owner.pool.query('select anexo_status from chat_mensagens where id = $1', [m.id])).rows[0].anexo_status).toBe('sem_anexo');
  });
});

describe('Plano 25 — CH-D70: a marca do aviso à nutricionista fica numa tabela só da equipe', () => {
  it('a nutri lê e grava chat_avisos_nutri; o paciente com conta lê 0 linhas e não grava; publico e conta nada', async () => {
    const C = await cenario();
    await em(C.ctx, sql`insert into chat_avisos_nutri (tenant_id) values (${C.tenantId})`);
    expect(await em(C.ctx, sql`select aviso_email, aviso_nutri_em from chat_avisos_nutri`)).toEqual([{ aviso_email: true, aviso_nutri_em: null }]);
    expect(await em(C.ctx, sql`update chat_avisos_nutri set aviso_email = false, aviso_nutri_em = now(), updated_at = now() returning aviso_email`)).toEqual([
      { aviso_email: false },
    ]);
    expect(await em(C.P1, sql`select 1 from chat_avisos_nutri`)).toEqual([]);
    expect(await em(publico(C.tenantId), sql`select 1 from chat_avisos_nutri`)).toEqual([]);
    expect(await naConta(sql`select 1 from chat_avisos_nutri`)).toEqual([]);
    const T2 = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T2.ctx)).id;
    await expect(em(ctxPaciente(T2.tenantId, p), sql`insert into chat_avisos_nutri (tenant_id) values (${T2.tenantId})`)).rejects.toSatisfy(rlsDe('chat_avisos_nutri'));
    expect((await withTenant(C.P1, (tx) => tx.execute(sql`update chat_avisos_nutri set aviso_email = true`), app.db)).rowCount).toBe(0);
    // DELETE revogado: apagar a linha religaria o e-mail e zeraria a janela de 2 h
    await expect(em(C.ctx, sql`delete from chat_avisos_nutri`)).rejects.toSatisfy(permissaoNegada);
  });

  it('o paciente lê chat_configuracoes.horario_ativo, e a tabela não tem mais as colunas do aviso', async () => {
    const C = await cenario();
    await em(C.ctx, sql`insert into chat_configuracoes (tenant_id, horario_ativo) values (${C.tenantId}, true)`);
    expect(await em(C.P1, sql`select * from chat_configuracoes`)).toEqual([expect.objectContaining({ horario_ativo: true })]);
    const { rows } = await owner.pool.query<{ c: string }>(
      `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'chat_configuracoes' order by 1`,
    );
    expect(rows.map((r) => r.c)).toEqual(['horario_ativo', 'tenant_id', 'updated_at']);
    const staff = await owner.pool.query(`select 1 from pg_policies where tablename = 'chat_avisos_nutri' and policyname = 'staff_only' and permissive = 'RESTRICTIVE'`);
    expect(staff.rowCount).toBe(1);
  });
});

describe('Plano 25 — paciente_chat_envio (spec §9.2, RN-443)', () => {
  it('P1 com conta envia texto na conversa liberada', async () => {
    const C = await cenario();
    const [m] = await em(C.P1, mensagem(C));
    const [linha] = (await owner.pool.query('select autor, autor_user_id, autor_nome, autor_crn, anexo_status from chat_mensagens where id = $1', [m.id])).rows;
    expect(linha).toEqual({ autor: 'paciente', autor_user_id: C.u1, autor_nome: null, autor_crn: null, anexo_status: 'sem_anexo' });
  });

  it('P1 envia a foto em processamento apontando o próprio chat_anexo_original', async () => {
    const C = await cenario();
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    const [m] = await em(C.P1, mensagem(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original }));
    expect(m.id).toBeTruthy();
  });

  it('recusa com a conversa não liberada ou pausada', async () => {
    const C = await cenario();
    const p3 = (await novoPaciente(app.db, C.ctx)).id;
    await em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${p3})`);
    await expect(em(ctxPaciente(C.tenantId, p3, C.u1), mensagem(C, { patientId: p3 }))).rejects.toSatisfy(rlsDe('chat_mensagens'));
    // sem conversa nenhuma: a política recusa antes da FK
    const p4 = (await novoPaciente(app.db, C.ctx)).id;
    await expect(em(ctxPaciente(C.tenantId, p4, C.u1), mensagem(C, { patientId: p4 }))).rejects.toSatisfy(rlsDe('chat_mensagens'));
    await em(C.ctx, sql`update chat_conversas set pausada_em = now(), pausada_por = ${C.nutriId} where patient_id = ${C.p1}`);
    await expect(em(C.P1, mensagem(C))).rejects.toSatisfy(rlsDe('chat_mensagens'));
  });

  it('recusa com o titular arquivado, bloqueado ou anonimizado', async () => {
    for (const set of [
      `status = 'arquivado'`,
      `status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01'`,
      `anonimizado_em = now()`,
    ]) {
      const C = await cenario();
      await owner.pool.query(`update patients set ${set} where id = $1`, [C.p1]);
      await expect(em(C.P1, mensagem(C)), set).rejects.toSatisfy(rlsDe('chat_mensagens'));
    }
  });

  it('recusa autor nutri, ator de outro, recado, dúvida, anexo_path, anexo_nome e anexo pronto', async () => {
    const C = await cenario();
    const rec = await recado(C);
    const anexo = await arquivo(C, C.p1, 'chat_anexo');
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    const casos: [string, Msg][] = [
      ['autor nutri', { autor: 'nutri', autorNome: CARIMBO.nome, autorCrn: CARIMBO.crn }],
      ['ator de outro', { autorUserId: randomUUID() }],
      ['recado_id', { recadoId: rec }],
      ['duvida_em', { duvidaEm: new Date().toISOString() }],
      ['anexo_path', { anexoStatus: 'processando', anexoTipo: 'imagem', anexoPath: anexo, anexoOriginalPath: original }],
      ['anexo_nome', { anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original, anexoNome: 'foto.jpg' }],
      ['pronto', { anexoStatus: 'pronto', anexoTipo: 'imagem', anexoPath: anexo }],
    ];
    for (const [nome, m] of casos) await expect(em(C.P1, mensagem(C, m)), nome).rejects.toSatisfy(rlsDe('chat_mensagens'));
    expect((await owner.pool.query('select count(*)::int as n from chat_mensagens where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(0);
  });

  it('recusa o anexo_original_path de outro paciente ou de outro tipo (amarra ao stored_files do mesmo paciente)', async () => {
    const C = await cenario();
    const deP2 = await arquivo(C, C.p2, 'chat_anexo_original');
    const outroTipo = await arquivo(C, C.p1, 'diario_foto_original', 'chat_anexo_original');
    for (const original of [deP2, outroTipo]) {
      await expect(em(C.P1, mensagem(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original }))).rejects.toSatisfy(
        rlsDe('chat_mensagens'),
      );
    }
  });

  it('P2 gravando autor paciente com o próprio ator no patient_id de P1 → recusa da RLS de chat_mensagens', async () => {
    const C = await cenario();
    const r = em(C.P2, mensagem(C, { patientId: C.p1, autorUserId: C.u2 }));
    await expect(r).rejects.toSatisfy(rlsDe('chat_mensagens'));
    // Divergência da spec (§9.2 v0.2, "a recusa vem de patient_isolation"): o Postgres confere as RESTRICTIVE em ordem alfabética
    // e informa a primeira que falha. paciente_chat_envio vem antes de patient_isolation e também falha — o EXISTS da conversa
    // de P1 é falso sob a RLS de P2 —, então nenhuma linha de P1 escapa, e a mensagem cita paciente_chat_envio.
    const { message } = erro(await r.catch((e: unknown) => e));
    expect(message).toContain('policy "paciente_chat_envio" for table "chat_mensagens"');
    expect((await owner.pool.query('select count(*)::int as n from chat_mensagens where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(0);
  });

  it('paciente_arquivo_insert: o paciente grava chat_anexo_original, nunca chat_anexo', async () => {
    const C = await cenario();
    const grava = (tipo: string) =>
      em(C.P1, sql`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values (${C.tenantId}, ${C.p1}, ${tipo}, ${`${C.tenantId}/${tipo}/${randomUUID()}.jpg`}, 10, 'image/jpeg') returning id`);
    expect(await grava('chat_anexo_original')).toHaveLength(1);
    await expect(grava('chat_anexo')).rejects.toSatisfy(rlsDe('stored_files'));
    // os tipos de antes continuam
    expect(await grava('diario_foto_original')).toHaveLength(1);
    expect(await grava('exame_original')).toHaveLength(1);
  });
});

describe('Plano 25 — paciente_leitura_propria_* (spec §9.3, RN-448)', () => {
  it('o paciente grava e avança só o lado paciente', async () => {
    const C = await cenario();
    await em(C.ctx, leitura(C, C.p1, 'consultorio'));
    await expect(em(C.P1, leitura(C, C.p1, 'consultorio'))).rejects.toSatisfy(rlsDe('chat_leituras'));
    await em(C.P1, leitura(C, C.p1, 'paciente'));
    // a USING esconde a linha do consultório do UPDATE do paciente: só a dele muda
    const r = await withTenant(C.P1, (tx) => tx.execute(sql`update chat_leituras set lida_ate = now()`), app.db);
    expect(r.rowCount).toBe(1);
    await expect(em(C.P1, sql`update chat_leituras set lado = 'consultorio' where lado = 'paciente'`)).rejects.toSatisfy(rlsDe('chat_leituras'));
    // ON CONFLICT DO UPDATE do próprio lado (a gravação do módulo)
    const upsert = sql`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values (${C.tenantId}, ${C.p1}, 'paciente', now())
                       on conflict (tenant_id, patient_id, lado) do update set lida_ate = greatest(chat_leituras.lida_ate, excluded.lida_ate)`;
    await expect(em(C.P1, upsert)).resolves.toEqual([]);
  });
});

describe('Plano 25 — CHECKs (spec §9.1–§9.6)', () => {
  it('chat_mensagens: conteúdo, tamanho do texto, anexo, carimbo, recado, risco e nome do anexo', async () => {
    const C = await cenario();
    const rec = await recado(C);
    const anexo = `${C.tenantId}/chat_anexo/${randomUUID()}.jpg`;
    const original = `${C.tenantId}/chat_anexo_original/${randomUUID()}.jpg`;
    const casos: [string, SQL][] = [
      ['chat_mensagens_tem_conteudo', daNutri(C, { texto: null })],
      ['chat_mensagens_texto_tamanho', daNutri(C, { texto: 'a'.repeat(2001) })],
      ['chat_mensagens_texto_tamanho', daNutri(C, { texto: '   ' })],
      ['chat_mensagens_pronto_com_caminho', daNutri(C, { texto: null, anexoStatus: 'pronto', anexoTipo: 'pdf' })],
      ['chat_mensagens_removido_sem_caminho', daNutri(C, { anexoStatus: 'removido', anexoTipo: 'imagem', anexoPath: anexo })],
      ['chat_mensagens_pdf_so_da_nutri', mensagem(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'pdf' })],
      ['chat_mensagens_recado_so_texto', daNutri(C, { recadoId: rec, anexoStatus: 'processando', anexoTipo: 'pdf' })],
      ['chat_mensagens_carimbo', daNutri(C, { autorNome: null })],
      ['chat_mensagens_carimbo', daNutri(C, { autorCrn: null })],
      ['chat_mensagens_carimbo', mensagem(C, { autorNome: CARIMBO.nome, autorCrn: CARIMBO.crn })],
      ['chat_mensagens_autor_valido', mensagem(C, { autor: 'ia' })],
      ['chat_mensagens_anexo_status_valido', daNutri(C, { anexoStatus: 'apagado', anexoTipo: 'imagem' })],
      ['chat_mensagens_anexo_tipo_com_anexo', daNutri(C, { anexoTipo: 'imagem' })],
      ['chat_mensagens_processando_com_original', daNutri(C, { anexoStatus: 'processando', anexoTipo: 'imagem' })],
      ['chat_mensagens_duvida_so_da_nutri', mensagem(C, { duvidaEm: new Date().toISOString() })],
      ['chat_mensagens_risco_valido', daNutri(C, { risco: 'emergencia' })],
      ['chat_mensagens_risco_valido', mensagem(C, { risco: 'modelo' })],
      ['chat_mensagens_anexo_nome', daNutri(C, { anexoStatus: 'processando', anexoTipo: 'pdf', anexoNome: 'x'.repeat(121) })],
      ['chat_mensagens_anexo_nome', mensagem(C, { anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original, anexoNome: 'foto.jpg' })],
      ['chat_mensagens_anexo_path_prefixo', daNutri(C, { anexoStatus: 'pronto', anexoTipo: 'imagem', anexoPath: `${randomUUID()}/chat_anexo/x.jpg` })],
      ['chat_mensagens_anexo_original_prefixo', mensagem(C, { anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: `${C.tenantId}/chat_anexo/x.jpg` })],
    ];
    for (const [nome, q] of casos) await expect(comoDono(q), nome).rejects.toSatisfy(check(nome));
    // risco válido do paciente e dúvida da nutricionista passam
    expect(await comoDono(mensagem(C, { risco: 'sintoma_agudo' }))).toHaveLength(1);
    expect(await comoDono(daNutri(C, { duvidaEm: new Date().toISOString() }))).toHaveLength(1);
  });

  it('CH-D60: sem_anexo não aponta caminho nenhum (dono e sessão do paciente)', async () => {
    const C = await cenario();
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    const anexo = await arquivo(C, C.p1, 'chat_anexo');
    await expect(comoDono(mensagem(C, { anexoOriginalPath: original }))).rejects.toSatisfy(check('chat_mensagens_sem_anexo_sem_caminho'));
    await expect(comoDono(daNutri(C, { anexoPath: anexo }))).rejects.toSatisfy(check('chat_mensagens_sem_anexo_sem_caminho'));
    // na sessão do paciente, a política deixa passar (original dele, status sem_anexo) e o CHECK recusa
    await expect(em(C.P1, mensagem(C, { anexoOriginalPath: original }))).rejects.toSatisfy(check('chat_mensagens_sem_anexo_sem_caminho'));
  });

  it('UNIQUE de anexo_path e de anexo_original_path (23505); FK para stored_files (23503)', async () => {
    const C = await cenario();
    const anexo = await arquivo(C, C.p1, 'chat_anexo');
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    await comoDono(daNutri(C, { anexoStatus: 'pronto', anexoTipo: 'imagem', anexoPath: anexo }));
    await expect(comoDono(daNutri(C, { anexoStatus: 'pronto', anexoTipo: 'imagem', anexoPath: anexo }))).rejects.toSatisfy(
      restricao('23505', 'chat_mensagens_anexo_path_unique'),
    );
    await comoDono(mensagem(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original }));
    await expect(comoDono(mensagem(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original }))).rejects.toSatisfy(
      restricao('23505', 'chat_mensagens_anexo_original_path_unique'),
    );
    const inexistente = `${C.tenantId}/chat_anexo/${randomUUID()}.jpg`;
    await expect(comoDono(daNutri(C, { anexoStatus: 'pronto', anexoTipo: 'imagem', anexoPath: inexistente }))).rejects.toSatisfy((e: unknown) => erro(e).code === '23503');
  });

  it('chat_conversas: forma do TCLE, liberação sem quem liberou, pausa sem liberação; nome e CRN junto da liberação e da pausa (CH-D74)', async () => {
    const C = await cenario();
    // colunas: liberada_em, liberada_por, tcle_forma, liberada_nome, liberada_crn, pausada_em, pausada_por, pausada_nome, pausada_crn
    const conversa = async (cols: SQL) => {
      const p = (await novoPaciente(app.db, C.ctx)).id;
      return sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma, liberada_nome, liberada_crn,
                                             pausada_em, pausada_por, pausada_nome, pausada_crn) values (${C.tenantId}, ${p}, ${cols})`;
    };
    const u = C.nutriId;
    const [n, c] = [CARIMBO_4.nome, CARIMBO_4.crn];
    const casos: [string, SQL][] = [
      ['chat_conversas_tcle_forma_valida', await conversa(sql`now(), ${u}, 'verbal', ${n}, ${c}, null, null, null, null`)],
      ['chat_conversas_liberacao', await conversa(sql`now(), null, 'aceite_escrito', ${n}, ${c}, null, null, null, null`)],
      ['chat_conversas_liberacao', await conversa(sql`now(), ${u}, null, ${n}, ${c}, null, null, null, null`)],
      ['chat_conversas_liberacao', await conversa(sql`null, null, 'termo_assinado', null, null, null, null, null, null`)],
      // CH-D74: liberação sem o nome ou sem o CRN; nome ou CRN sem liberação
      ['chat_conversas_liberacao', await conversa(sql`now(), ${u}, 'aceite_escrito', null, ${c}, null, null, null, null`)],
      ['chat_conversas_liberacao', await conversa(sql`now(), ${u}, 'aceite_escrito', ${n}, null, null, null, null, null`)],
      ['chat_conversas_liberacao', await conversa(sql`null, null, null, ${n}, null, null, null, null, null`)],
      ['chat_conversas_liberacao', await conversa(sql`null, null, null, null, ${c}, null, null, null, null`)],
      ['chat_conversas_pausa', await conversa(sql`now(), ${u}, 'aceite_escrito', ${n}, ${c}, now(), null, ${n}, ${c}`)],
      ['chat_conversas_pausa', await conversa(sql`now(), ${u}, 'aceite_escrito', ${n}, ${c}, now(), ${u}, null, ${c}`)],
      ['chat_conversas_pausa', await conversa(sql`now(), ${u}, 'aceite_escrito', ${n}, ${c}, now(), ${u}, ${n}, null`)],
      ['chat_conversas_pausa', await conversa(sql`now(), ${u}, 'aceite_escrito', ${n}, ${c}, null, null, ${n}, ${c}`)],
      ['chat_conversas_pausa_so_liberada', await conversa(sql`null, null, null, null, null, now(), ${u}, ${n}, ${c}`)],
    ];
    for (const [nome, q] of casos) await expect(comoDono(q), nome).rejects.toSatisfy(check(nome));
    expect(await comoDono(await conversa(sql`now(), ${u}, 'termo_assinado', ${n}, ${c}, now(), ${u}, ${n}, ${c}`))).toEqual([]);
  });

  it('chat_horarios: sobreposição no mesmo dia (EXCLUDE, 23P01), fora de 15 min, fim <= início, dia fora de 0–6', async () => {
    const C = await cenario();
    const faixa = (dia: number, inicio: number, fim: number) =>
      em(C.ctx, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, ${dia}, ${inicio}, ${fim})`);
    await faixa(1, 480, 720);
    await expect(faixa(1, 600, 780)).rejects.toSatisfy(restricao('23P01', 'chat_horarios_sem_sobreposicao'));
    await faixa(1, 720, 780); // encostar não é sobrepor
    await faixa(2, 600, 780); // outro dia
    await expect(faixa(3, 490, 720)).rejects.toSatisfy(check('chat_horarios_faixa_valida'));
    await expect(faixa(3, 720, 720)).rejects.toSatisfy(check('chat_horarios_faixa_valida'));
    await expect(faixa(3, 780, 720)).rejects.toSatisfy(check('chat_horarios_faixa_valida'));
    await expect(faixa(3, 1440, 1455)).rejects.toSatisfy(check('chat_horarios_faixa_valida'));
    await expect(faixa(7, 480, 720)).rejects.toSatisfy(check('chat_horarios_dia_valido'));
    // outro consultório pode usar a mesma faixa
    const D = await cenario();
    await em(D.ctx, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${D.tenantId}, 1, 480, 720)`);
  });

  it('recados: texto, filtro, rótulo e destinatários', async () => {
    const C = await cenario();
    const rec = (texto: string, filtro: string, rotulo: string | null, n: number) =>
      comoDono(sql`insert into recados (tenant_id, texto, filtro, filtro_rotulo, destinatarios, autor_nome, autor_crn, criado_por)
                   values (${C.tenantId}, ${texto}, ${filtro}::jsonb, ${rotulo}, ${n}, ${CARIMBO.nome}, ${CARIMBO.crn}, ${C.nutriId})`);
    await expect(rec('  ', '{"tipo":"todos"}', null, 1)).rejects.toSatisfy(check('recados_texto_tamanho'));
    await expect(rec('a'.repeat(1001), '{"tipo":"todos"}', null, 1)).rejects.toSatisfy(check('recados_texto_tamanho'));
    await expect(rec('Oi', '{"tipo":"pacientes"}', null, 1)).rejects.toSatisfy(check('recados_filtro_valido'));
    // sem "tipo": o coalesce do recados_filtro_valido recusa (sem ele, o IN daria NULL e passaria)
    await expect(rec('Oi', '{}', null, 1)).rejects.toSatisfy(check('recados_filtro_valido'));
    await expect(rec('Oi', '{"tipo":"todos"}', 'x'.repeat(301), 1)).rejects.toSatisfy(check('recados_filtro_rotulo_tamanho'));
    await expect(rec('Oi', '{"tipo":"todos"}', null, 0)).rejects.toSatisfy(check('recados_destinatarios_positivo'));
    await expect(rec('a'.repeat(1000), '{"tipo":"etiquetas","ids":[]}', 'Etiquetas: Gestante', 3)).resolves.toEqual([]);
  });

  it('CHECKs ampliados: tipos novos em notifications e stored_files; resolucao respondida em ia_nutri_mensagens', async () => {
    const C = await cenario();
    for (const tipo of ['chat_mensagem', 'recado']) {
      await comoDono(sql`insert into notifications (tenant_id, patient_id, canal, tipo, agendada_para) values (${C.tenantId}, ${C.p1}, 'push', ${tipo}, now())`);
    }
    await expect(comoDono(sql`insert into notifications (tenant_id, patient_id, canal, tipo, agendada_para) values (${C.tenantId}, ${C.p1}, 'push', 'chat', now())`)).rejects.toSatisfy(
      check('notifications_tipo_valido'),
    );
    for (const tipo of ['chat_anexo', 'chat_anexo_original']) expect(await arquivo(C, C.p1, tipo)).toContain(`/${tipo}/`);
    await expect(arquivo(C, C.p1, 'chat_foto')).rejects.toSatisfy(check('stored_files_tipo_valido'));
    const [ia] = await comoDono(
      sql`insert into ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, expira_em, encaminhada_em, resolvida_em, resolucao)
          values (${C.tenantId}, ${C.p1}, now(), 'paciente', 'Posso trocar o arroz?', 'respondida', now() + interval '180 days', now(), now(), 'respondida') returning resolucao`,
    );
    expect(ia.resolucao).toBe('respondida');
    await expect(
      comoDono(sql`insert into ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, expira_em, encaminhada_em, resolvida_em, resolucao)
                   values (${C.tenantId}, ${C.p1}, now(), 'paciente', 'x', 'respondida', now() + interval '180 days', now(), now(), 'apagada')`),
    ).rejects.toSatisfy(check('ia_nutri_mensagens_resolucao'));
  });

  it('criada_em e criado_em com o relógio do banco por padrão (CH-D67)', async () => {
    const C = await cenario();
    const [m] = await em(C.ctx, sql`${daNutri(C)}, criada_em`);
    const [r] = await em(
      C.ctx,
      sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por) values (${C.tenantId}, 'x', '{"tipo":"todos"}', 1, ${CARIMBO.nome}, ${CARIMBO.crn}, ${C.nutriId}) returning criado_em`,
    );
    for (const t of [m.criada_em, r.criado_em]) expect(Math.abs(new Date(t as string).getTime() - Date.now())).toBeLessThan(60_000);
    const { rows } = await owner.pool.query<{ c: string; d: string }>(
      `select table_name || '.' || column_name as c, column_default as d from information_schema.columns
        where table_schema = 'public' and (table_name, column_name) in (('chat_mensagens', 'criada_em'), ('recados', 'criado_em')) order by 1`,
    );
    expect(rows).toEqual([
      { c: 'chat_mensagens.criada_em', d: 'clock_timestamp()' },
      { c: 'recados.criado_em', d: 'clock_timestamp()' },
    ]);
  });
});

describe('Plano 25 — permissões (REVOKE/GRANT, spec §9.1–§9.5)', () => {
  it('UPDATE de chat_mensagens só nas quatro colunas do anexo; UPDATE de recados negado', async () => {
    const C = await cenario();
    const [m] = await em(C.ctx, daNutri(C));
    await expect(em(C.ctx, sql`update chat_mensagens set texto = 'outro' where id = ${m.id}`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.P1, sql`update chat_mensagens set texto = 'outro'`)).rejects.toSatisfy(permissaoNegada);
    await recado(C);
    await expect(em(C.ctx, sql`update recados set texto = 'outro'`)).rejects.toSatisfy(permissaoNegada);
    const { rows } = await owner.pool.query<{ c: string }>(
      `select column_name as c from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'chat_mensagens' and grantee = 'nutri_app_role' and privilege_type = 'UPDATE' order by 1`,
    );
    expect(rows.map((r) => r.c)).toEqual(['anexo_original_path', 'anexo_path', 'anexo_status', 'updated_at']);
  });

  it('DELETE negado em chat_conversas, chat_leituras, chat_mensagens e recados; TRUNCATE negado nas seis; a equipe apaga faixa de horário', async () => {
    const C = await cenario();
    await em(C.ctx, daNutri(C));
    await em(C.ctx, leitura(C, C.p1, 'consultorio'));
    await recado(C);
    for (const t of ['chat_conversas', 'chat_leituras', 'chat_mensagens', 'recados']) {
      await expect(em(C.ctx, sql`delete from ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
      await expect(em(worker(C.tenantId), sql`delete from ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
    }
    for (const t of TODAS) await expect(em(C.ctx, sql`truncate ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
    // o horário e a configuração são da equipe: editar o horário apaga e grava faixas
    await em(C.ctx, sql`insert into chat_horarios (tenant_id, dia_semana, inicio_min, fim_min) values (${C.tenantId}, 1, 480, 720)`);
    const r = await withTenant(C.ctx, (tx) => tx.execute(sql`delete from chat_horarios`), app.db);
    expect(r.rowCount).toBe(1);
  });

  it('o DELETE da paciente em chat_conversas e chat_leituras → 42501 de permissão (SEM_DELETE_DO_PACIENTE, CH-D58)', async () => {
    const C = await cenario();
    await em(C.P2, leitura(C, C.p2, 'paciente'));
    for (const t of ['chat_conversas', 'chat_leituras']) {
      await expect(em(C.P2, sql`delete from ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
    }
  });
});

describe('Plano 25 — auditoria (spec §9.3, regra 8)', () => {
  it('INSERT em chat_mensagens vira audit_log (entidade chat); INSERT/UPDATE em chat_conversas, chat_conversa; chat_leituras sem gatilho', async () => {
    const T = await novoTenant(app.db);
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', [CARIMBO.nome, CARIMBO.crn, T.tenantId]);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const [c] = await liberar(T, p);
    const trilha = async (entidade: string, id: unknown) =>
      (
        await owner.pool.query(
          'select acao, actor_user_id, patient_id from audit_log where tenant_id = $1 and entidade = $2 and entidade_id = $3 order by criado_em',
          [T.tenantId, entidade, id],
        )
      ).rows;
    expect(await trilha('chat_conversa', c.id)).toEqual([{ acao: 'criar', actor_user_id: T.nutriId, patient_id: p }]);
    const [m] = await em(
      T.ctx,
      sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto)
          values (${T.tenantId}, ${p}, 'nutri', ${T.nutriId}, ${CARIMBO.nome}, ${CARIMBO.crn}, 'Texto sigiloso da conversa') returning id`,
    );
    expect(await trilha('chat', m.id)).toEqual([{ acao: 'criar', actor_user_id: T.nutriId, patient_id: p }]);
    // a pausa (UPDATE) depois da mensagem: com a conversa pausada, o gatilho (T1b) recusa a mensagem individual
    await em(T.ctx, sql`update chat_conversas set pausada_em = now(), pausada_por = ${T.nutriId} where id = ${c.id}`);
    expect((await trilha('chat_conversa', c.id)).map((r) => r.acao)).toEqual(['criar', 'alterar']);
    // o audit_log não tem coluna de conteúdo: nenhuma linha do tenant carrega o texto
    const { rows } = await owner.pool.query('select to_jsonb(a)::text as j from audit_log a where tenant_id = $1', [T.tenantId]);
    for (const r of rows) expect(r.j).not.toContain('sigiloso');

    const antes = (await owner.pool.query('select count(*)::int as n from audit_log where tenant_id = $1', [T.tenantId])).rows[0].n;
    await em(T.ctx, sql`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values (${T.tenantId}, ${p}, 'consultorio', now())`);
    expect((await owner.pool.query('select count(*)::int as n from audit_log where tenant_id = $1', [T.tenantId])).rows[0].n).toBe(antes);
    const gatilhos = await owner.pool.query(
      `select tgrelid::regclass::text as t from pg_trigger where tgname = 'audit_row_change' and tgrelid::regclass::text = any($1) order by 1`,
      [[...TODAS]],
    );
    expect(gatilhos.rows.map((r) => r.t)).toEqual(['chat_conversas', 'chat_mensagens']);
  });
});

describe('Plano 25 — gatilhos (T1b, spec §9.1–§9.5 v0.3, CH-D38, CH-D57, CH-D60)', () => {
  const agora = () => Date.now();
  const recente = (v: unknown) => Math.abs(new Date(v as string).getTime() - agora()) < 60_000;
  const atualizar = (ctx: TenantContext, id: unknown, set: SQL, soltando = false) =>
    withTenant(
      ctx,
      async (tx) => {
        if (soltando) await tx.execute(sql`select set_config('app.chat_soltando', 'on', true)`);
        return (await tx.execute(sql`update chat_mensagens set ${set} where id = ${id} returning *`)).rows as Row[];
      },
      app.db,
    );
  /** Transação crua do app com um papel qualquer (o withTenant só aceita os quatro papéis conhecidos). */
  const comPapel = (papel: string, tenantId: string, q: SQL, userId: string = randomUUID()) =>
    app.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.role', ${papel}, true),
                                  set_config('app.patient_id', '', true), set_config('app.user_id', ${userId}, true)`);
      return tx.execute(q);
    });
  const ler = async (id: unknown) => (await owner.pool.query('select * from chat_mensagens where id = $1', [id])).rows[0] as Row;
  const semCarimbo = async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    // sem papel (dono): a liberação sem carimbo só para montar o cenário
    await comoDono(
      sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma, liberada_nome, liberada_crn)
          values (${T.tenantId}, ${p}, now(), ${T.nutriId}, 'aceite_escrito', ${CARIMBO.nome}, ${CARIMBO.crn})`,
    );
    return { T, p };
  };

  it('chat_mensagens INSERT: criada_em do relógio do banco, carimbo de tenants; ator de outra, autor paciente pela nutri e o worker → 42501', async () => {
    const C = await cenario();
    const [m] = await em(
      C.ctx,
      sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto, criada_em)
          values (${C.tenantId}, ${C.p1}, 'nutri', ${C.nutriId}, 'Outra Pessoa', 'CRN-9 1', 'Olá', '2001-01-01') returning *`,
    );
    expect(recente(m.criada_em)).toBe(true);
    expect(m).toMatchObject({ autor_nome: CARIMBO.nome, autor_crn: CARIMBO.crn, autor_user_id: C.nutriId });
    const [d] = await em(
      C.P1,
      sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, criada_em) values (${C.tenantId}, ${C.p1}, 'paciente', ${C.u1}, 'Oi', '2001-01-01') returning criada_em`,
    );
    expect(recente(d.criada_em)).toBe(true);
    await expect(em(C.ctx, daNutri(C, { autorUserId: randomUUID() }))).rejects.toSatisfy(doGatilho('em nome de quem envia'));
    await expect(em(C.ctx, mensagem(C, { autorUserId: C.nutriId }))).rejects.toSatisfy(doGatilho('só grava mensagem da nutricionista'));
    await expect(em(worker(C.tenantId), daNutri(C))).rejects.toSatisfy(doGatilho('o worker não grava mensagem'));
    await expect(em(worker(C.tenantId), mensagem(C))).rejects.toSatisfy(doGatilho('o worker não grava mensagem'));
  });

  it('sem carimbo no consultório (RN-475): mensagem, recado e liberação → 42501', async () => {
    const { T, p } = await semCarimbo();
    await expect(
      em(T.ctx, sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto) values (${T.tenantId}, ${p}, 'nutri', ${T.nutriId}, 'Nome Forjado', 'CRN', 'Olá')`),
    ).rejects.toSatisfy(doGatilho('nome profissional e CRN'));
    await expect(
      em(T.ctx, sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por) values (${T.tenantId}, 'x', '{"tipo":"todos"}', 1, 'Nome Forjado', 'CRN', ${T.nutriId})`),
    ).rejects.toSatisfy(doGatilho('nome profissional e CRN'));
    const p2 = (await novoPaciente(app.db, T.ctx)).id;
    await expect(liberar(T, p2)).rejects.toSatisfy(doGatilho('nome profissional e CRN'));
    // só o nome, ou só o CRN, também não basta
    await owner.pool.query("update tenants set nome_profissional = 'Débora Nutricionista' where id = $1", [T.tenantId]);
    await expect(liberar(T, p2)).rejects.toSatisfy(doGatilho('nome profissional e CRN'));
  });

  it('mensagem individual exige a conversa liberada e não pausada e o titular ativo; a cópia de recado, só o titular ativo', async () => {
    const C = await cenario();
    const rec = await recado(C);
    const p3 = (await novoPaciente(app.db, C.ctx)).id;
    await em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${p3})`);
    await expect(em(C.ctx, daNutri(C, { patientId: p3 }))).rejects.toSatisfy(doGatilho('não está liberada ou está pausada'));
    // RN-462: o recado chega também a quem ainda não teve a conversa liberada — mas só com o texto do próprio recado (M2 da
    // revisão: sem a amarra, a cópia furaria a conversa não liberada com qualquer texto)
    expect(await em(C.ctx, daNutri(C, { patientId: p3, recadoId: rec, texto: 'Feriado' }))).toHaveLength(1);
    await expect(em(C.ctx, daNutri(C, { patientId: p3, recadoId: rec, texto: 'Outro texto' }))).rejects.toSatisfy(doGatilho('repete o texto do recado'));
    await expect(em(C.ctx, daNutri(C, { patientId: C.p1, recadoId: rec, texto: 'Outro texto' }))).rejects.toSatisfy(doGatilho('repete o texto do recado'));
    await em(C.ctx, sql`update chat_conversas set pausada_em = now(), pausada_por = ${C.nutriId} where patient_id = ${C.p2}`);
    await expect(em(C.ctx, daNutri(C, { patientId: C.p2 }))).rejects.toSatisfy(doGatilho('não está liberada ou está pausada'));
    for (const set of [`status = 'arquivado'`, `status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01'`, `anonimizado_em = now()`]) {
      const D = await cenario();
      const r = await recado(D);
      await owner.pool.query(`update patients set ${set} where id = $1`, [D.p1]);
      await expect(em(D.ctx, daNutri(D)), set).rejects.toSatisfy(doGatilho('titular ativo'));
      await expect(em(D.ctx, daNutri(D, { recadoId: r, texto: 'Feriado' })), set).rejects.toSatisfy(doGatilho('titular ativo'));
    }
  });

  it('recados INSERT: criado_por, criado_em e carimbo da sessão; o worker → 42501', async () => {
    const C = await cenario();
    const [r] = await em(
      C.ctx,
      sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por, criado_em)
          values (${C.tenantId}, 'Feriado', '{"tipo":"todos"}', 3, 'Outra Pessoa', 'CRN-9 1', ${randomUUID()}, '2001-01-01') returning *`,
    );
    expect(r).toMatchObject({ criado_por: C.nutriId, autor_nome: CARIMBO.nome, autor_crn: CARIMBO.crn });
    expect(recente(r.criado_em)).toBe(true);
    await expect(
      em(worker(C.tenantId), sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por) values (${C.tenantId}, 'x', '{"tipo":"todos"}', 1, ${CARIMBO.nome}, ${CARIMBO.crn}, ${randomUUID()})`),
    ).rejects.toSatisfy(doGatilho('só a sessão da nutricionista grava recado'));
  });

  it('chat_conversas: liberar só na nutri, em nome de quem libera, com titular ativo; liberação fixa depois de gravada', async () => {
    const C = await cenario();
    const novo = async () => (await novoPaciente(app.db, C.ctx)).id;
    const lib = (p: string, por: string) =>
      em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma) values (${C.tenantId}, ${p}, '2001-01-01', ${por}, 'termo_assinado') returning *`);
    await expect(lib(await novo(), randomUUID())).rejects.toSatisfy(doGatilho('em nome de quem libera'));
    const arquivado = await novo();
    await owner.pool.query(`update patients set status = 'arquivado' where id = $1`, [arquivado]);
    await expect(lib(arquivado, C.nutriId)).rejects.toSatisfy(doGatilho('titular ativo'));
    const anonimizado = await novo();
    await owner.pool.query(`update patients set anonimizado_em = now() where id = $1`, [anonimizado]);
    await expect(lib(anonimizado, C.nutriId)).rejects.toSatisfy(doGatilho('titular ativo'));
    const [c] = await lib(await novo(), C.nutriId);
    expect(recente(c.liberada_em)).toBe(true); // relógio do banco

    // liberar depois (UPDATE de nulo a valor): as mesmas regras
    const p = await novo();
    const [v] = await em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${p}) returning id`);
    const upd = (set: SQL, ctx: TenantContext = C.ctx) => em(ctx, sql`update chat_conversas set ${set} where id = ${v.id} returning *`);
    await expect(upd(sql`liberada_em = now(), liberada_por = ${randomUUID()}, tcle_forma = 'aceite_escrito'`)).rejects.toSatisfy(doGatilho('em nome de quem libera'));
    await expect(upd(sql`liberada_em = now(), liberada_por = ${C.nutriId}, tcle_forma = 'aceite_escrito'`, worker(C.tenantId))).rejects.toSatisfy(doGatilho('só a sessão da nutricionista libera'));
    const [lib2] = await upd(sql`liberada_em = '2001-01-01', liberada_por = ${C.nutriId}, tcle_forma = 'aceite_escrito'`);
    expect(recente(lib2.liberada_em)).toBe(true);
    for (const [set, trecho] of [
      [sql`liberada_em = now() - interval '1 day'`, 'não muda depois de gravada'],
      [sql`liberada_em = null, liberada_por = null, tcle_forma = null`, 'não muda depois de gravada'],
      [sql`tcle_forma = 'termo_assinado'`, 'não muda depois de gravada'],
      [sql`liberada_por = ${randomUUID()}`, 'não muda depois de gravada'],
      [sql`patient_id = ${C.p1}`, 'coluna fixa da conversa'],
      [sql`created_at = now() - interval '1 day'`, 'coluna fixa da conversa'],
    ] as const) {
      await expect(upd(set)).rejects.toSatisfy(doGatilho(trecho));
    }
    expect(await upd(sql`tenant_id = tenant_id, updated_at = now()`)).toHaveLength(1);
    // o worker não cria conversa
    await expect(em(worker(C.tenantId), sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${await novo()})`)).rejects.toSatisfy(doGatilho('só é criada pela sessão da nutricionista'));
  });

  it('chat_conversas: pausar e retomar só na nutri, em nome de quem pausa', async () => {
    const C = await cenario();
    const upd = (set: SQL, ctx: TenantContext = C.ctx) => em(ctx, sql`update chat_conversas set ${set} where patient_id = ${C.p1} returning *`);
    await expect(upd(sql`pausada_em = now(), pausada_por = ${randomUUID()}`)).rejects.toSatisfy(doGatilho('em nome de quem pausa'));
    await expect(upd(sql`pausada_em = now(), pausada_por = ${C.nutriId}`, worker(C.tenantId))).rejects.toSatisfy(doGatilho('pausa e retoma'));
    const [pausada] = await upd(sql`pausada_em = '2001-01-01', pausada_por = ${C.nutriId}`);
    expect(recente(pausada.pausada_em)).toBe(true);
    const outra = randomUUID();
    await expect(upd(sql`pausada_em = now(), pausada_por = ${outra}`, { ...C.ctx, actorUserId: outra })).rejects.toSatisfy(doGatilho('já está pausada'));
    await expect(upd(sql`pausada_em = null, pausada_por = null`, worker(C.tenantId))).rejects.toSatisfy(doGatilho('pausa e retoma'));
    const [retomada] = await upd(sql`pausada_em = null, pausada_por = null`);
    expect(retomada.pausada_em).toBeNull();
  });

  it('CH-D74: a liberação grava o nome e o CRN do consultório (o que vier no comando é sobrescrito) e eles nunca mudam', async () => {
    const C = await cenario();
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', [CARIMBO_4.nome, CARIMBO_4.crn, C.tenantId]);
    const p = (await novoPaciente(app.db, C.ctx)).id;
    const [c] = await em(
      C.ctx,
      sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma, liberada_nome, liberada_crn)
          values (${C.tenantId}, ${p}, now(), ${C.nutriId}, 'aceite_escrito', 'Outra Pessoa', 'CRN-9 99999') returning *`,
    );
    expect(c).toMatchObject({ liberada_nome: CARIMBO_4.nome, liberada_crn: CARIMBO_4.crn, pausada_nome: null, pausada_crn: null });
    // liberar depois (UPDATE de nulo a valor, conversa nascida de recado): o mesmo
    const q = (await novoPaciente(app.db, C.ctx)).id;
    await expect(
      em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id, liberada_nome, liberada_crn) values (${C.tenantId}, ${q}, ${CARIMBO_4.nome}, ${CARIMBO_4.crn})`),
    ).rejects.toSatisfy(doGatilho('só são gravados na liberação'));
    const [v] = await em(C.ctx, sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${q}) returning id`);
    await expect(em(C.ctx, sql`update chat_conversas set liberada_nome = ${CARIMBO_4.nome}, liberada_crn = ${CARIMBO_4.crn} where id = ${v.id}`)).rejects.toSatisfy(
      doGatilho('só são gravados na liberação'),
    );
    const [lib] = await em(
      C.ctx,
      sql`update chat_conversas set liberada_em = now(), liberada_por = ${C.nutriId}, tcle_forma = 'termo_assinado', liberada_nome = 'Outra', liberada_crn = 'CRN-9 1'
          where id = ${v.id} returning *`,
    );
    expect(lib).toMatchObject({ liberada_nome: CARIMBO_4.nome, liberada_crn: CARIMBO_4.crn });
    // o perfil muda depois: a linha guarda como era no momento
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', ['Débora R. Silva', 'CRN-4 54321', C.tenantId]);
    const [depois] = await em(C.ctx, sql`select liberada_nome, liberada_crn from chat_conversas where id = ${c.id}`);
    expect(depois).toEqual({ liberada_nome: CARIMBO_4.nome, liberada_crn: CARIMBO_4.crn });
    for (const set of [sql`liberada_nome = 'Débora R. Silva'`, sql`liberada_crn = 'CRN-4 54321'`, sql`liberada_nome = null, liberada_crn = null`]) {
      await expect(em(C.ctx, sql`update chat_conversas set ${set} where id = ${c.id}`)).rejects.toSatisfy(doGatilho('não muda depois de gravada'));
    }
  });

  it('CH-D74: a pausa grava o nome e o CRN do momento; a retomada os limpa; fora disso não mudam', async () => {
    const C = await cenario();
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', [CARIMBO_4.nome, CARIMBO_4.crn, C.tenantId]);
    const upd = (set: SQL) => em(C.ctx, sql`update chat_conversas set ${set} where patient_id = ${C.p1} returning *`);
    await expect(upd(sql`pausada_nome = ${CARIMBO_4.nome}, pausada_crn = ${CARIMBO_4.crn}`)).rejects.toSatisfy(doGatilho('só mudam na pausa e na retomada'));
    const [pausada] = await upd(sql`pausada_em = now(), pausada_por = ${C.nutriId}, pausada_nome = 'Outra', pausada_crn = 'CRN-9 1'`);
    expect(pausada).toMatchObject({ pausada_nome: CARIMBO_4.nome, pausada_crn: CARIMBO_4.crn });
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', ['Débora R. Silva', 'CRN-4 54321', C.tenantId]);
    for (const set of [sql`pausada_nome = 'Débora R. Silva'`, sql`pausada_crn = 'CRN-4 54321'`, sql`pausada_nome = null, pausada_crn = null`]) {
      await expect(upd(set)).rejects.toSatisfy(doGatilho('só mudam na pausa e na retomada'));
    }
    expect((await upd(sql`updated_at = now()`))[0]).toMatchObject({ pausada_nome: CARIMBO_4.nome, pausada_crn: CARIMBO_4.crn });
    // a retomada limpa, mesmo que o comando mande outro valor
    const [retomada] = await upd(sql`pausada_em = null, pausada_por = null, pausada_nome = 'x', pausada_crn = 'y'`);
    expect(retomada).toMatchObject({ pausada_em: null, pausada_por: null, pausada_nome: null, pausada_crn: null });
    // pausar de novo grava o carimbo atual
    const [deNovo] = await upd(sql`pausada_em = now(), pausada_por = ${C.nutriId}`);
    expect(deNovo).toMatchObject({ pausada_nome: 'Débora R. Silva', pausada_crn: 'CRN-4 54321' });
    // sem carimbo no consultório, a pausa é recusada
    await upd(sql`pausada_em = null, pausada_por = null`);
    await owner.pool.query('update tenants set crn = null where id = $1', [C.tenantId]);
    await expect(upd(sql`pausada_em = now(), pausada_por = ${C.nutriId}`)).rejects.toSatisfy(doGatilho('nome profissional e CRN'));
  });

  it('anexo no INSERT da nutricionista: só sem anexo, em processamento ou PDF pronto (code review do PR 1)', async () => {
    const C = await cenario();
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    const pdf = await arquivo(C, C.p1, 'chat_anexo');
    const msg = 'a mensagem nasce sem anexo, em processamento ou com o PDF pronto';
    await expect(em(C.ctx, daNutri(C, { texto: 'x', anexoStatus: 'removido', anexoTipo: 'imagem' }))).rejects.toSatisfy(doGatilho(msg));
    await expect(em(C.ctx, daNutri(C, { texto: 'x', anexoStatus: 'falhou', anexoTipo: 'imagem' }))).rejects.toSatisfy(doGatilho(msg));
    await expect(em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'pronto', anexoTipo: 'imagem', anexoPath: pdf }))).rejects.toSatisfy(doGatilho(msg));
    expect(await em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original }))).toHaveLength(1);
    expect(await em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'pronto', anexoTipo: 'pdf', anexoPath: pdf }))).toHaveLength(1);
  });

  it('anexo: o worker conclui processando → pronto | falhou com o chat_anexo do mesmo paciente; o resto das transições → 42501', async () => {
    const C = await cenario();
    const W = worker(C.tenantId);
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    const [m] = await em(C.P1, mensagem(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original }));
    const meu = await arquivo(C, C.p1, 'chat_anexo');
    const deP2 = await arquivo(C, C.p2, 'chat_anexo');
    const outroTipo = await arquivo(C, C.p1, 'diario_foto', 'chat_anexo');
    await expect(atualizar(C.ctx, m.id, sql`anexo_status = 'pronto', anexo_path = ${meu}`)).rejects.toSatisfy(doGatilho('só o worker conclui o anexo'));
    await expect(atualizar(W, m.id, sql`anexo_status = 'pronto', anexo_path = ${deP2}`)).rejects.toSatisfy(doGatilho('não é um chat_anexo deste paciente'));
    await expect(atualizar(W, m.id, sql`anexo_status = 'pronto', anexo_path = ${outroTipo}`)).rejects.toSatisfy(doGatilho('não é um chat_anexo deste paciente'));
    await expect(atualizar(W, m.id, sql`anexo_path = ${meu}`)).rejects.toSatisfy(doGatilho('só entra na conclusão'));
    expect(await atualizar(W, m.id, sql`anexo_status = 'pronto', anexo_path = ${meu}, updated_at = now()`)).toHaveLength(1);
    const outro = await arquivo(C, C.p1, 'chat_anexo');
    await expect(atualizar(W, m.id, sql`anexo_path = ${outro}`)).rejects.toSatisfy(doGatilho('não troca por outro')); // pronto → pronto
    await expect(atualizar(W, m.id, sql`anexo_status = 'processando'`)).rejects.toSatisfy(doGatilho('transição do anexo inválida'));
    await expect(atualizar(W, m.id, sql`anexo_status = 'falhou'`)).rejects.toSatisfy(doGatilho('transição do anexo inválida'));
    await expect(atualizar(W, m.id, sql`anexo_original_path = null`)).rejects.toSatisfy(doGatilho('o original só sai por app_chat_soltar_anexo')); // sem o marcador
    await expect(atualizar(W, m.id, sql`anexo_status = 'removido', anexo_path = null, anexo_original_path = null`)).rejects.toSatisfy(
      doGatilho('o anexo só é removido por app_chat_soltar_anexo'),
    );
    // o marcador local só vale no worker (é o contexto de app_chat_soltar_anexo, T1c)
    await expect(atualizar(C.ctx, m.id, sql`anexo_original_path = null`, true)).rejects.toSatisfy(doGatilho('o original só sai por app_chat_soltar_anexo'));
    expect(await atualizar(W, m.id, sql`anexo_original_path = null`, true)).toHaveLength(1);
    // M3 da revisão: com o marcador, o anexo convertido só sai com o titular na anonimização
    await expect(atualizar(W, m.id, sql`anexo_path = null`, true)).rejects.toSatisfy(doGatilho('titular na anonimização'));
    await expect(atualizar(W, m.id, sql`anexo_status = 'removido', anexo_path = null`, true)).rejects.toSatisfy(doGatilho('titular na anonimização'));
    // code review do PR 1 (RN-466): bloqueado ainda no prazo de guarda não basta
    await owner.pool.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = $1`, [C.p1]);
    await expect(atualizar(W, m.id, sql`anexo_status = 'removido', anexo_path = null`, true)).rejects.toSatisfy(doGatilho('titular na anonimização'));
    await owner.pool.query(`update patients set anonimizar_apos = '2000-01-01' where id = $1`, [C.p1]);
    expect(await atualizar(W, m.id, sql`anexo_status = 'removido', anexo_path = null`, true)).toHaveLength(1);
    await expect(atualizar(W, m.id, sql`anexo_status = 'pronto'`, true)).rejects.toSatisfy(doGatilho('transição do anexo inválida')); // removido é final
    expect(await ler(m.id)).toMatchObject({ anexo_status: 'removido', anexo_path: null, anexo_original_path: null });

    // processando → falhou, pelo worker; gravar anexo_path nessa transição → 42501 (M4)
    const D = await cenario();
    const WD = worker(D.tenantId);
    const original2 = await arquivo(D, D.p1, 'chat_anexo_original');
    const [f] = await em(D.P1, mensagem(D, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: original2 }));
    const convertido = await arquivo(D, D.p1, 'chat_anexo');
    await expect(atualizar(D.ctx, f.id, sql`anexo_status = 'falhou'`)).rejects.toSatisfy(doGatilho('só o worker conclui o anexo'));
    await expect(atualizar(WD, f.id, sql`anexo_status = 'falhou', anexo_path = ${convertido}`)).rejects.toSatisfy(doGatilho('só entra na conclusão'));
    expect(await atualizar(WD, f.id, sql`anexo_status = 'falhou'`)).toHaveLength(1);
    // falhou → removido com o marcador e o titular na anonimização (M4); o original sai antes (CHECK removido ⇒ sem caminhos)
    expect(await atualizar(WD, f.id, sql`anexo_original_path = null`, true)).toHaveLength(1);
    await expect(atualizar(WD, f.id, sql`anexo_status = 'removido'`)).rejects.toSatisfy(doGatilho('o anexo só é removido por app_chat_soltar_anexo'));
    await owner.pool.query(`update patients set anonimizado_em = now() where id = $1`, [D.p1]);
    expect(await atualizar(WD, f.id, sql`anexo_status = 'removido'`, true)).toHaveLength(1);
    expect(await ler(f.id)).toMatchObject({ anexo_status: 'removido', anexo_path: null, anexo_original_path: null });
  });

  it('anexo: o original nunca entra num UPDATE; os caminhos do INSERT da nutri são do mesmo paciente e do tipo certo (CH-D60)', async () => {
    const C = await cenario();
    const W = worker(C.tenantId);
    const [pdf] = await em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'pdf', anexoNome: 'plano.pdf' }));
    const original = await arquivo(C, C.p1, 'chat_anexo_original');
    await expect(atualizar(W, pdf.id, sql`anexo_original_path = ${original}`)).rejects.toSatisfy(doGatilho('o original não entra nem troca'));
    const meu = await arquivo(C, C.p1, 'chat_anexo');
    const deP2 = await arquivo(C, C.p2, 'chat_anexo');
    const outroTipo = await arquivo(C, C.p1, 'exame', 'chat_anexo');
    const origP2 = await arquivo(C, C.p2, 'chat_anexo_original');
    await expect(em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'pronto', anexoTipo: 'pdf', anexoPath: deP2 }))).rejects.toSatisfy(doGatilho('não é um chat_anexo deste paciente'));
    await expect(em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'pronto', anexoTipo: 'pdf', anexoPath: outroTipo }))).rejects.toSatisfy(
      doGatilho('não é um chat_anexo deste paciente'),
    );
    await expect(em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'processando', anexoTipo: 'imagem', anexoOriginalPath: origP2 }))).rejects.toSatisfy(
      doGatilho('não é um chat_anexo_original deste paciente'),
    );
    expect(await em(C.ctx, daNutri(C, { texto: null, anexoStatus: 'pronto', anexoTipo: 'pdf', anexoPath: meu }))).toHaveLength(1);
    // a nutri só mexe em updated_at
    await expect(atualizar(C.ctx, pdf.id, sql`anexo_status = 'falhou'`)).rejects.toSatisfy(doGatilho('só o worker conclui o anexo'));
    expect(await atualizar(C.ctx, pdf.id, sql`updated_at = now()`)).toHaveLength(1);
  });

  it('chat_leituras: lado × papel ao gravar; lida_ate só avança e nunca passa do relógio; o UPDATE sem mudança da nutri passa', async () => {
    const C = await cenario();
    await expect(em(C.ctx, leitura(C, C.p1, 'paciente'))).rejects.toSatisfy(doGatilho('cada lado só grava o próprio marcador'));
    await expect(em(worker(C.tenantId), leitura(C, C.p1, 'paciente'))).rejects.toSatisfy(doGatilho('cada lado só grava o próprio marcador'));
    await expect(em(worker(C.tenantId), leitura(C, C.p1, 'consultorio'))).rejects.toSatisfy(doGatilho('cada lado só grava o próprio marcador'));
    // M1 da revisão: lida_ate nulo chega ao NOT NULL (23502), no INSERT e no UPDATE — o gatilho não o troca pelo relógio
    await expect(em(C.ctx, sql`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values (${C.tenantId}, ${C.p1}, 'consultorio', null)`)).rejects.toSatisfy(
      (e: unknown) => erro(e).code === '23502',
    );
    await em(C.ctx, sql`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values (${C.tenantId}, ${C.p1}, 'consultorio', now() + interval '1 day')`);
    await em(C.P1, sql`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values (${C.tenantId}, ${C.p1}, 'paciente', now() + interval '1 day')`);
    const lida = async (lado: string) =>
      new Date((await owner.pool.query('select lida_ate from chat_leituras where patient_id = $1 and lado = $2', [C.p1, lado])).rows[0].lida_ate).getTime();
    for (const lado of ['consultorio', 'paciente']) expect(await lida(lado), lado).toBeLessThanOrEqual(agora() + 1_000);
    const antes = await lida('consultorio');
    await em(C.ctx, sql`update chat_leituras set lida_ate = lida_ate - interval '1 day' where lado = 'consultorio'`);
    expect(await lida('consultorio')).toBe(antes); // não volta
    await em(C.P1, sql`update chat_leituras set lida_ate = now() + interval '1 day'`);
    expect(await lida('paciente')).toBeLessThanOrEqual(agora() + 1_000); // nem passa do relógio
    // CH-D58: o `set tenant_id = tenant_id` da equipe numa linha do paciente não é escrita do lado do paciente
    const r = await withTenant(C.ctx, (tx) => tx.execute(sql`update chat_leituras set tenant_id = tenant_id where lado = 'paciente'`), app.db);
    expect(r.rowCount).toBe(1);
    await expect(em(C.ctx, sql`update chat_leituras set lida_ate = now() where lado = 'paciente'`)).rejects.toSatisfy(doGatilho('cada lado só grava o próprio marcador'));
    await expect(em(C.ctx, sql`update chat_leituras set lida_ate = null where lado = 'consultorio'`)).rejects.toSatisfy((e: unknown) => erro(e).code === '23502');
    await expect(em(C.P1, sql`update chat_leituras set lida_ate = null`)).rejects.toSatisfy((e: unknown) => erro(e).code === '23502');
    await expect(em(worker(C.tenantId), sql`update chat_leituras set lida_ate = now() where lado = 'consultorio'`)).rejects.toSatisfy(doGatilho('cada lado só grava o próprio marcador'));
    await expect(em(C.ctx, sql`update chat_leituras set patient_id = ${C.p2} where lado = 'consultorio'`)).rejects.toSatisfy(doGatilho('coluna fixa do marcador de leitura'));
  });

  it('devolvem NEW no que a RLS já recusa: outro tenant, a P2 no P1, a P2 na própria conversa e em recados, publico e conta', async () => {
    const A = await cenario();
    const B = await cenario();
    const pA = (await novoPaciente(app.db, A.ctx)).id;
    const conversa = (p: string) => sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma) values (${A.tenantId}, ${p}, now(), ${randomUUID()}, 'aceite_escrito')`;
    const rec = sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por) values (${A.tenantId}, 'x', '{"tipo":"todos"}', 1, ${CARIMBO.nome}, ${CARIMBO.crn}, ${randomUUID()})`;
    const casos: [string, TenantContext | 'conta', SQL][] = [
      ['chat_conversas', B.ctx, conversa(pA)],
      ['chat_mensagens', B.ctx, daNutri(A, { autorUserId: B.nutriId })],
      ['chat_leituras', B.ctx, leitura(A, A.p1, 'consultorio')],
      ['recados', B.ctx, rec],
      ['chat_conversas', A.P2, conversa(pA)],
      ['chat_mensagens', A.P2, mensagem(A, { patientId: A.p1, autorUserId: A.u2 })],
      ['chat_leituras', A.P2, leitura(A, A.p1, 'paciente')],
      // CH-D57: a P2 na própria conversa (paciente_sem_insert) e num recado (staff_only)
      ['chat_conversas', ctxPaciente(A.tenantId, pA, A.u2), conversa(pA)],
      ['recados', A.P2, rec],
      ['chat_conversas', publico(A.tenantId), conversa(pA)],
      ['chat_mensagens', publico(A.tenantId), daNutri(A)],
      ['chat_leituras', publico(A.tenantId), leitura(A, A.p1, 'consultorio')],
      ['recados', publico(A.tenantId), rec],
      ['chat_conversas', 'conta', conversa(pA)],
      ['chat_mensagens', 'conta', daNutri(A)],
      ['chat_leituras', 'conta', leitura(A, A.p1, 'consultorio')],
      ['recados', 'conta', rec],
    ];
    for (const [t, ctx, q] of casos) {
      const r = ctx === 'conta' ? withConta(randomUUID(), (tx) => tx.execute(q), app.db) : em(ctx, q);
      await expect(r, `${t} ${ctx === 'conta' ? 'conta' : ctx.role}`).rejects.toSatisfy(rlsDe(t));
    }
    // os UPDATEs que movem linha para outro tenant ou titular também chegam à RLS
    await em(A.P2, leitura(A, A.p2, 'paciente'));
    await expect(em(A.P2, sql`update chat_leituras set patient_id = ${A.p1}`)).rejects.toSatisfy(rlsDe('chat_leituras'));
    await expect(em(B.ctx, sql`update chat_conversas set tenant_id = ${A.tenantId}`)).rejects.toSatisfy(rlsDe('chat_conversas'));
  });

  it('papel desconhecido (e a recepcao, sem o Plano 26 na main) recebe o 42501 do gatilho nas quatro tabelas (falha fechada)', async () => {
    const C = await cenario();
    const pX = (await novoPaciente(app.db, C.ctx)).id;
    const escritas: [string, SQL][] = [
      ['chat_conversas', sql`insert into chat_conversas (tenant_id, patient_id) values (${C.tenantId}, ${pX})`],
      ['chat_mensagens', daNutri(C)],
      ['chat_leituras', leitura(C, C.p1, 'consultorio')],
      ['recados', sql`insert into recados (tenant_id, texto, filtro, destinatarios, autor_nome, autor_crn, criado_por) values (${C.tenantId}, 'x', '{"tipo":"todos"}', 1, ${CARIMBO.nome}, ${CARIMBO.crn}, ${randomUUID()})`],
    ];
    for (const papel of ['desconhecido', 'recepcao']) {
      for (const [t, q] of escritas) await expect(comPapel(papel, C.tenantId, q, C.nutriId), `${papel} ${t}`).rejects.toSatisfy(doGatilho(`${t}: papel desconhecido`));
    }
    // e no UPDATE
    await em(C.ctx, daNutri(C));
    await em(C.ctx, leitura(C, C.p1, 'consultorio'));
    for (const t of ['chat_conversas', 'chat_mensagens', 'chat_leituras']) {
      await expect(comPapel('desconhecido', C.tenantId, sql`update ${sql.identifier(t)} set updated_at = now()`), t).rejects.toSatisfy(doGatilho(`${t}: papel desconhecido`));
    }
  });
});
