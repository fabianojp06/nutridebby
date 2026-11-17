import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { findPublicoViolations } from '@/db/rls-guard';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 23 (spec §9), T1a: o que o banco garante sozinho nas tabelas e colunas novas da Agenda 2 — RLS (staff_only dos
 * locais, aguardando_fora_do_publico, paciente_aniversario_proprio), REVOKE, CHECKs, FKs compostas com o tipo do local e
 * índices únicos. SQL cru, sem módulo. T1b: os gatilhos `appointments_regras_pedido` (RN-421, RN-422), `tenants_agenda_da_equipe`
 * (RN-420) e `aniversario_autorizacoes_regras` (RN-433). As peças SECURITY DEFINER (T1c, migrate-owner.test.ts, com dono
 * NOBYPASSRLS) têm testes próprios.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const publico = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'publico' });
const linkSemConta = (T: TenantDeTeste, patientId: string): TenantContext => ({ tenantId: T.tenantId, role: 'paciente', patientId, semConta: true });
const naConta = (q: SQL) => withConta(randomUUID(), (tx) => tx.execute(q), app.db);

const erro = (e: unknown) => {
  const x = e as { code?: string; constraint?: string; message?: string; cause?: { code?: string; constraint?: string; message?: string } };
  return { code: x.cause?.code ?? x.code, constraint: x.cause?.constraint ?? x.constraint, message: x.cause?.message ?? x.message ?? '' };
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
/** A restrição certa (CHECK 23514, UNIQUE 23505, FK 23503), pelo nome. */
const restricao = (codigo: string, nome: string) => (e: unknown) => {
  const x = erro(e);
  return x.code === codigo && x.constraint === nome;
};

/**
 * Só as restrições, sem os gatilhos (dono superusuário com `session_replication_role = replica`, desfeito no fim): os CHECKs
 * de `appointments` ficam provados mesmo com o `appointments_regras_pedido` (T1b) decidindo o nascimento por sessão, e o de
 * origem de `aniversario_autorizacoes` mesmo com o `aniversario_autorizacoes_regras` recusando a origem fora de `nutri`.
 */
async function semGatilhos(texto: string, params: unknown[]): Promise<void> {
  const c = await owner.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(texto, params);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

type Local = { nome?: string; tipo?: 'presencial' | 'online'; endereco?: string | null; link?: string | null; agendamento?: boolean; principal?: boolean; arquivado?: boolean };
const inserirLocal = (T: TenantDeTeste, l: Local = {}) => {
  const tipo = l.tipo ?? 'presencial';
  return sql`insert into locais_atendimento (tenant_id, nome, tipo, endereco, link_sala, agendamento_online, principal, arquivado_em)
    values (${T.tenantId}, ${l.nome ?? `Local ${randomUUID().slice(0, 8)}`}, ${tipo}, ${l.endereco === undefined ? (tipo === 'presencial' ? 'Rua das Flores, 10' : null) : l.endereco},
            ${l.link === undefined ? (tipo === 'online' ? 'https://sala.example.test/debby' : null) : l.link}, ${l.agendamento ?? false}, ${l.principal ?? false},
            ${l.arquivado ? sql`now()` : null})
    returning id`;
};
const criarLocal = async (T: TenantDeTeste, l: Local = {}) => (await em(T.ctx, inserirLocal(T, l)))[0].id as string;

let seqHora = 0;
/** Cada consulta num horário próprio (EXCLUDE appointments_sem_sobreposicao). */
const hora = () => sql`'2031-01-01T12:00:00Z'::timestamptz + ${++seqHora} * interval '2 hours'`;
const inserirConsulta = (T: TenantDeTeste, patientId: string, modalidade: 'presencial' | 'online', localId: string | null) => {
  const h = hora();
  const link = modalidade === 'online' ? 'https://sala.example.test/debby' : null;
  return sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, link_online, origem, local_id)
    values (${T.tenantId}, ${patientId}, ${h}, ${h} + interval '1 hour', ${modalidade}, ${link}, 'nutri', ${localId}) returning id`;
};

type Pedido = { email?: string; verificado?: boolean; aguardando?: boolean; localId?: string | null; fim?: boolean; resolvido?: boolean; resolucao?: string | null };
const inserirPedido = (T: TenantDeTeste, p: Pedido = {}) => {
  const comFim = p.fim ?? p.aguardando ?? false;
  return sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, fim, modalidade, termo_versao, expira_em,
                                                 verificado_em, local_id, aguardando_desde, resolvido_em, resolucao)
    values (gen_random_uuid(), ${T.tenantId}, ${randomUUID()}, 'x', ${p.email ?? `pedido-${randomUUID().slice(0, 8)}@teste.dev`}, 'Rita Lima',
            '2031-02-01T12:00:00Z', ${comFim ? sql`'2031-02-01T13:00:00Z'::timestamptz` : null}, 'presencial', 't', now() + interval '10 minutes',
            ${p.verificado ?? p.aguardando ? sql`now()` : null}, ${p.localId ?? null}, ${p.aguardando ? sql`now()` : null},
            ${p.resolvido ? sql`now()` : null}, ${p.resolucao ?? null})
    returning id`;
};

type Autorizacao = { patientId: string; evento?: 'autorizou' | 'retirou'; origem?: string; forma?: string | null; registradoPor?: string | null };
const inserirAutorizacao = (T: TenantDeTeste, a: Autorizacao) =>
  sql`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, forma, registrado_por)
      values (${T.tenantId}, ${a.patientId}, ${a.evento ?? 'autorizou'}, ${a.origem ?? 'nutri'}, ${a.forma === undefined ? 'escrito' : a.forma},
              ${a.registradoPor === undefined ? T.nutriId : a.registradoPor}) returning id`;

describe('Plano 23 — Agenda 2 no banco (T1a: RLS, CHECKs e FKs)', () => {
  it('locais: nutri cria e lê; paciente, publico e conta não leem nenhuma linha nem gravam (staff_only, publico_negado)', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    await criarLocal(T, { principal: true, agendamento: true });
    expect(await em(T.ctx, sql`select id from locais_atendimento`)).toHaveLength(1);
    expect(await em(ctxPaciente(T.tenantId, p), sql`select 1 from locais_atendimento`)).toEqual([]);
    expect(await em(linkSemConta(T, p), sql`select 1 from locais_atendimento`)).toEqual([]);
    expect(await em(publico(T), sql`select 1 from locais_atendimento`)).toEqual([]);
    expect((await naConta(sql`select 1 from locais_atendimento`)).rows).toEqual([]);
    await expect(em(ctxPaciente(T.tenantId, p), inserirLocal(T))).rejects.toSatisfy(rlsDe('locais_atendimento'));
    await expect(em(publico(T), inserirLocal(T))).rejects.toSatisfy(rlsDe('locais_atendimento'));
    await expect(naConta(inserirLocal(T))).rejects.toSatisfy(rlsDe('locais_atendimento'));
    // o outro consultório também não vê
    const U = await novoTenant(app.db);
    expect(await em(U.ctx, sql`select 1 from locais_atendimento`)).toEqual([]);
  });

  it('locais: um principal ativo por consultório; principal arquivado → CHECK; nome repetido (sem diferença de maiúsculas) entre os não arquivados → 23505', async () => {
    const T = await novoTenant(app.db);
    const primeiro = await criarLocal(T, { principal: true });
    await expect(em(T.ctx, inserirLocal(T, { principal: true }))).rejects.toSatisfy(restricao('23505', 'locais_atendimento_principal_unique'));
    await expect(em(T.ctx, inserirLocal(T, { principal: true, arquivado: true }))).rejects.toSatisfy(restricao('23514', 'locais_atendimento_principal_ativo'));
    await expect(em(T.ctx, sql`update locais_atendimento set arquivado_em = now() where id = ${primeiro}`)).rejects.toSatisfy(
      restricao('23514', 'locais_atendimento_principal_ativo'),
    );
    await em(T.ctx, sql`update locais_atendimento set principal = false, arquivado_em = now() where id = ${primeiro}`);
    await criarLocal(T, { principal: true }); // o arquivado não conta

    await criarLocal(T, { nome: 'Sala Centro' });
    await expect(em(T.ctx, inserirLocal(T, { nome: 'sala CENTRO' }))).rejects.toSatisfy(restricao('23505', 'locais_atendimento_nome_unique'));
    await em(T.ctx, sql`update locais_atendimento set arquivado_em = now() where nome = 'Sala Centro'`);
    await criarLocal(T, { nome: 'SALA CENTRO' }); // arquivado não conta
    const U = await novoTenant(app.db);
    await criarLocal(U, { nome: 'Sala Centro', principal: true }); // outro consultório: nome e principal próprios
  });

  it('locais: CHECKs de nome, tipo, endereço, cidade, sala e agendamento', async () => {
    const T = await novoTenant(app.db);
    const check = (nome: string) => restricao('23514', nome);
    await expect(em(T.ctx, inserirLocal(T, { nome: 'A' }))).rejects.toSatisfy(check('locais_atendimento_nome_tamanho'));
    await expect(em(T.ctx, inserirLocal(T, { nome: 'x'.repeat(61) }))).rejects.toSatisfy(check('locais_atendimento_nome_tamanho'));
    await expect(em(T.ctx, sql`insert into locais_atendimento (tenant_id, nome, tipo) values (${T.tenantId}, 'Casa', 'domicilio')`)).rejects.toSatisfy(
      check('locais_atendimento_tipo_valido'),
    );
    await expect(em(T.ctx, inserirLocal(T, { tipo: 'online', endereco: 'Rua das Flores, 10' }))).rejects.toSatisfy(check('locais_atendimento_endereco'));
    await expect(em(T.ctx, inserirLocal(T, { endereco: 'x'.repeat(301) }))).rejects.toSatisfy(check('locais_atendimento_endereco'));
    await expect(em(T.ctx, sql`insert into locais_atendimento (tenant_id, nome, tipo, cidade) values (${T.tenantId}, 'Bairro', 'presencial', ${'x'.repeat(81)})`)).rejects.toSatisfy(
      check('locais_atendimento_cidade_tamanho'),
    );
    await expect(em(T.ctx, inserirLocal(T, { link: 'https://sala.example.test/x' }))).rejects.toSatisfy(check('locais_atendimento_link_sala')); // presencial
    for (const link of ['http://sala.example.test/x', 'https://sala example', `https://${'x'.repeat(500)}`, 'https://']) {
      await expect(em(T.ctx, inserirLocal(T, { tipo: 'online', link })), link).rejects.toSatisfy(check('locais_atendimento_link_sala'));
    }
    await expect(em(T.ctx, inserirLocal(T, { tipo: 'online', link: null, agendamento: true }))).rejects.toSatisfy(check('locais_atendimento_agendamento'));
    await expect(em(T.ctx, inserirLocal(T, { agendamento: true, arquivado: true }))).rejects.toSatisfy(check('locais_atendimento_agendamento'));
    // os válidos: online sem sala (sem agendamento), online com sala e agendamento, presencial com agendamento
    await criarLocal(T, { tipo: 'online', link: null });
    await criarLocal(T, { tipo: 'online', agendamento: true });
    await criarLocal(T, { agendamento: true });
    const [l] = await em(T.ctx, sql`select mostrar_endereco, agendamento_online, principal, arquivado_em, created_at, updated_at from locais_atendimento limit 1`);
    expect(l).toMatchObject({ mostrar_endereco: false, arquivado_em: null });
    expect(l.created_at).toBeTruthy();
  });

  it('FK composta (tenant, local, modalidade) → (tenant, id, tipo): consulta, regra e pedido no local do tipo certo; local usado não muda de tipo nem é excluído', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const presencial = await criarLocal(T, { principal: true, agendamento: true });
    const online = await criarLocal(T, { tipo: 'online', agendamento: true });
    const fk = (nome: string) => restricao('23503', nome);

    await expect(em(T.ctx, inserirConsulta(T, p, 'presencial', online))).rejects.toSatisfy(fk('appointments_local_fk'));
    await em(T.ctx, inserirConsulta(T, p, 'presencial', presencial));
    await em(T.ctx, inserirConsulta(T, p, 'online', online));
    await em(T.ctx, inserirConsulta(T, p, 'online', null)); // MATCH SIMPLE: sem local, não confere

    await expect(em(T.ctx, sql`update locais_atendimento set tipo = 'online', endereco = null, agendamento_online = false where id = ${presencial}`)).rejects.toSatisfy(fk('appointments_local_fk'));
    await expect(em(T.ctx, sql`delete from locais_atendimento where id = ${presencial}`)).rejects.toSatisfy(fk('appointments_local_fk'));

    const regra = (modalidade: string, localId: string | null) =>
      sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade, local_id) values (${T.tenantId}, 1, '08:00', '12:00', 60, ${modalidade}, ${localId})`;
    await expect(em(T.ctx, regra('online', presencial))).rejects.toSatisfy(fk('availability_rules_local_fk'));
    await expect(em(T.ctx, regra('ambas', presencial))).rejects.toSatisfy(restricao('23514', 'availability_rules_local_sem_ambas'));
    await em(T.ctx, regra('presencial', presencial));
    await em(T.ctx, regra('ambas', null)); // a imagem anterior ao PR 2 ainda grava sem local
    await expect(em(T.ctx, sql`delete from locais_atendimento where id = ${online}`)).rejects.toSatisfy(fk('appointments_local_fk'));

    await expect(em(T.ctx, inserirPedido(T, { localId: online }))).rejects.toSatisfy(fk('public_booking_requests_local_fk')); // pedido presencial
    await em(T.ctx, inserirPedido(T, { localId: presencial }));

    // o local de outro consultório não serve (tenant_id faz parte da FK)
    const U = await novoTenant(app.db);
    const q = (await novoPaciente(app.db, U.ctx)).id;
    await expect(em(U.ctx, inserirConsulta(U, q, 'presencial', presencial))).rejects.toSatisfy(fk('appointments_local_fk'));

    // local sem uso: muda de tipo e é excluído
    const solto = await criarLocal(T);
    await em(T.ctx, sql`update locais_atendimento set tipo = 'online', endereco = null where id = ${solto}`);
    expect(await em(T.ctx, sql`delete from locais_atendimento where id = ${solto} returning id`)).toHaveLength(1);
  });

  it('pedido (CHECK): solicitada só com origem paciente; os três cancelado_por de pedido; nada fora das listas', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const consulta = (status: string, origem: string, canceladoPor: string | null) =>
      semGatilhos(
        `insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status, cancelado_por, cancelada_em)
         values ($1, $2, '2031-03-01T12:00:00Z', '2031-03-01T13:00:00Z', 'presencial', $3, $4, $5::text, case when $5::text is null then null else now() end)`,
        [T.tenantId, p, origem, status, canceladoPor],
      );
    await expect(consulta('solicitada', 'nutri', null)).rejects.toSatisfy(restricao('23514', 'appointments_solicitada_do_paciente'));
    await consulta('solicitada', 'paciente', null);
    for (const motivo of ['pedido_desistido', 'pedido_recusado', 'pedido_vencido']) await consulta('cancelada', 'paciente', motivo);
    await expect(consulta('cancelada', 'paciente', 'pedido_esquecido')).rejects.toSatisfy(restricao('23514', 'appointments_cancelado_por_valido'));
    await expect(consulta('pendente', 'paciente', null)).rejects.toSatisfy(restricao('23514', 'appointments_status_valido'));
  });

  it('aguardando_fora_do_publico: o publico não vê o pedido aguardando (SELECT e FOR UPDATE) nem grava o aguardando direto (AG-D64)', async () => {
    const T = await novoTenant(app.db);
    const local = await criarLocal(T, { principal: true, agendamento: true });
    const [comum] = await em(T.ctx, inserirPedido(T, { verificado: true }));
    const [aguardando] = await em(T.ctx, inserirPedido(T, { aguardando: true, localId: local }));

    const vistos = (await em(publico(T), sql`select id from public_booking_requests`)).map((r) => r.id);
    expect(vistos).toEqual([comum.id]);
    expect(await em(publico(T), sql`select id from public_booking_requests where id = ${aguardando.id} for update`)).toEqual([]);
    expect(await em(T.ctx, sql`select id from public_booking_requests order by created_at`)).toHaveLength(2); // a equipe vê os dois

    await expect(
      em(publico(T), sql`update public_booking_requests set aguardando_desde = now(), fim = inicio + interval '1 hour', local_id = ${local} where id = ${comum.id}`),
    ).rejects.toSatisfy(rlsDe('public_booking_requests'));
    // o UPDATE de sempre (tentativas do código) continua liberado ao publico
    expect(await em(publico(T), sql`update public_booking_requests set tentativas = tentativas + 1 where id = ${comum.id} returning id`)).toHaveLength(1);
    // o publico também não mexe no aguardando (não o vê)
    expect(await em(publico(T), sql`update public_booking_requests set tentativas = tentativas + 1 where id = ${aguardando.id} returning id`)).toEqual([]);
    expect(await findPublicoViolations(owner.pool)).toEqual([]);
  });

  it('aguardando_fora_do_publico (FOR ALL): o publico não insere um pedido já aguardando, nem sem RETURNING, nem vira o aguardando num UPDATE sem WHERE', async () => {
    const T = await novoTenant(app.db);
    const local = await criarLocal(T, { principal: true, agendamento: true });
    const [comum] = await em(T.ctx, inserirPedido(T, { verificado: true }));
    // INSERT sem RETURNING: só as políticas de INSERT contam — o WITH CHECK da RESTRICTIVE FOR ALL recusa.
    const inserirSemRetorno = (aguardando: boolean, localId: string | null) =>
      sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, fim, modalidade, termo_versao, expira_em,
                                               verificado_em, local_id, aguardando_desde)
          values (gen_random_uuid(), ${T.tenantId}, ${randomUUID()}, 'x', ${`pedido-${randomUUID().slice(0, 8)}@teste.dev`}, 'Rita Lima',
                  '2031-02-01T12:00:00Z', ${aguardando ? sql`'2031-02-01T13:00:00Z'::timestamptz` : null}, 'presencial', 't', now() + interval '10 minutes',
                  ${aguardando ? sql`now()` : null}, ${localId}, ${aguardando ? sql`now()` : null})`;
    await expect(em(publico(T), inserirSemRetorno(true, local))).rejects.toSatisfy(rlsDe('public_booking_requests'));
    await expect(em(publico(T), inserirPedido(T, { aguardando: true, localId: local }))).rejects.toSatisfy(rlsDe('public_booking_requests')); // com RETURNING
    // o INSERT de sempre do publico continua liberado, também com o local escolhido na página (o pedido guarda local_id)
    await em(publico(T), inserirSemRetorno(false, null));
    await em(publico(T), inserirSemRetorno(false, local));
    // UPDATE sem WHERE não exige SELECT: só o WITH CHECK confere a linha nova
    await expect(
      em(publico(T), sql`update public_booking_requests set aguardando_desde = now(), fim = inicio + interval '1 hour', local_id = ${local}, verificado_em = now()`),
    ).rejects.toSatisfy(rlsDe('public_booking_requests'));
    const naEquipe = await em(T.ctx, sql`select id from public_booking_requests where aguardando_desde is not null`);
    expect(naEquipe).toEqual([]);
    expect((await em(T.ctx, sql`select id from public_booking_requests`)).map((r) => r.id)).toContain(comum.id);
    expect(await findPublicoViolations(owner.pool)).toEqual([]);
  });

  it('public_booking_requests: CHECKs do aguardando e da resolução (AG-D63); um aguardando por e-mail (RN-425)', async () => {
    const T = await novoTenant(app.db);
    const local = await criarLocal(T, { principal: true, agendamento: true });
    const check = (nome: string) => restricao('23514', nome);
    await expect(em(T.ctx, inserirPedido(T, { aguardando: true, localId: null }))).rejects.toSatisfy(check('public_booking_requests_aguardando_completo'));
    await expect(
      em(T.ctx, sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, fim, modalidade, termo_versao, expira_em, local_id, aguardando_desde)
        values (gen_random_uuid(), ${T.tenantId}, ${randomUUID()}, 'x', 'a@teste.dev', 'Rita Lima', '2031-02-01T12:00:00Z', '2031-02-01T13:00:00Z', 'presencial', 't', now(), ${local}, now())`),
    ).rejects.toSatisfy(check('public_booking_requests_aguardando_completo')); // sem verificado_em
    await expect(em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, fim: false }))).rejects.toSatisfy(check('public_booking_requests_aguardando_completo'));
    await expect(em(T.ctx, inserirPedido(T, { verificado: true, resolvido: true, resolucao: 'vencido' }))).rejects.toSatisfy(
      check('public_booking_requests_resolvido_so_aguardando'),
    );
    await expect(em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, resolucao: 'aceito' }))).rejects.toSatisfy(check('public_booking_requests_resolucao'));
    await expect(em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, resolvido: true }))).rejects.toSatisfy(check('public_booking_requests_resolucao'));
    await expect(em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, resolvido: true, resolucao: 'perdido' }))).rejects.toSatisfy(
      check('public_booking_requests_resolucao_valida'),
    );
    for (const resolucao of ['aceito', 'recusado', 'vencido', 'desistido']) await em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, resolvido: true, resolucao }));

    const [primeiro] = await em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, email: 'Rita@Teste.dev' }));
    await expect(em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, email: 'rita@teste.dev' }))).rejects.toSatisfy(
      restricao('23505', 'public_booking_requests_aguardando_email_unique'),
    );
    await em(T.ctx, sql`update public_booking_requests set resolvido_em = now(), resolucao = 'desistido' where id = ${primeiro.id}`);
    await em(T.ctx, inserirPedido(T, { aguardando: true, localId: local, email: 'rita@teste.dev' })); // o resolvido não conta
  });

  it('tenants nasce com agenda_confirmar_pedidos desligada; consultations.retorno_previsto_em entre a data e +730 dias', async () => {
    const T = await novoTenant(app.db);
    expect(await em(T.ctx, sql`select agenda_confirmar_pedidos from tenants where id = ${T.tenantId}`)).toEqual([{ agenda_confirmar_pedidos: false }]);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const atendimento = (retorno: string | null) =>
      sql`insert into consultations (tenant_id, patient_id, data, retorno_previsto_em) values (${T.tenantId}, ${p}, '2026-01-01', ${retorno}) returning id`;
    const check = restricao('23514', 'consultations_retorno_previsto_faixa');
    await expect(em(T.ctx, atendimento('2025-12-31'))).rejects.toSatisfy(check);
    await expect(em(T.ctx, atendimento('2028-01-02'))).rejects.toSatisfy(check); // 731 dias
    await em(T.ctx, atendimento(null));
    await em(T.ctx, atendimento('2026-01-01'));
    const [c] = await em(T.ctx, atendimento('2028-01-01')); // 730 dias
    await expect(em(T.ctx, sql`update consultations set data = '2028-02-01' where id = ${c.id}`)).rejects.toSatisfy(check);
  });

  it('notifications: aniversario (sem consulta) e pedido_nao_confirmado; um aniversário por paciente e ano (UTC), inclusive ignorado (RN-432)', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const outro = (await novoPaciente(app.db, T.ctx)).id;
    const aniversario = (patientId: string, para: string, ignorada = false) =>
      sql`insert into notifications (tenant_id, patient_id, canal, tipo, agendada_para, status, motivo_ignorada)
          values (${T.tenantId}, ${patientId}, 'email', 'aniversario', ${para}::timestamptz, ${ignorada ? 'ignorada' : 'pendente'}, ${ignorada ? 'sem_autorizacao' : null})`;
    await em(T.ctx, aniversario(p, '2026-03-10T12:00:00Z', true));
    // 31/12 às 20h em São Paulo = 23h UTC do mesmo ano: ocupa o ano já ocupado pela ignorada
    await expect(em(T.ctx, aniversario(p, '2026-12-31T20:00:00-03:00'))).rejects.toSatisfy(restricao('23505', 'notifications_aniversario_unique'));
    await em(T.ctx, aniversario(p, '2026-12-31T22:00:00-03:00')); // 01:00 UTC de 2027
    await em(T.ctx, aniversario(outro, '2026-03-10T12:00:00Z'));

    const [c] = await em(T.ctx, inserirConsulta(T, p, 'presencial', null));
    const [{ inicio }] = await em(T.ctx, sql`select inicio from appointments where id = ${c.id}`);
    for (const canal of ['email', 'push']) {
      await em(
        T.ctx,
        sql`insert into notifications (tenant_id, patient_id, appointment_id, inicio_consulta, canal, tipo, agendada_para)
            values (${T.tenantId}, ${p}, ${c.id}, ${inicio}, ${canal}, 'pedido_nao_confirmado', now())`,
      );
    }
    await expect(
      em(T.ctx, sql`insert into notifications (tenant_id, patient_id, canal, tipo, agendada_para) values (${T.tenantId}, ${p}, 'email', 'aniversario_atrasado', now())`),
    ).rejects.toSatisfy(restricao('23514', 'notifications_tipo_valido'));
  });

  it('aniversario_autorizacoes: a nutricionista autoriza com a forma e retira sem ela; autorizar sem forma → CHECK (AG-D61)', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const check = (nome: string) => restricao('23514', nome);
    for (const forma of ['escrito', 'mensagem', 'verbal']) await em(T.ctx, inserirAutorizacao(T, { patientId: p, forma }));
    await em(T.ctx, inserirAutorizacao(T, { patientId: p, evento: 'retirou', forma: null }));
    await em(T.ctx, inserirAutorizacao(T, { patientId: p, evento: 'retirou', forma: 'verbal' })); // opcional na retirada
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, forma: null }))).rejects.toSatisfy(check('aniversario_autorizacoes_forma'));
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, forma: 'oral' }))).rejects.toSatisfy(check('aniversario_autorizacoes_forma_valida'));
    await expect(em(T.ctx, sql`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, forma, registrado_por)
      values (${T.tenantId}, ${p}, 'pediu', 'nutri', 'escrito', ${T.nutriId})`)).rejects.toSatisfy(check('aniversario_autorizacoes_evento_valido'));
    // origem fora da lista: sem os gatilhos (na sessão nutri o aniversario_autorizacoes_regras recusa antes do CHECK)
    await expect(
      semGatilhos(`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, forma, registrado_por) values ($1, $2, 'autorizou', 'email', null, $3)`, [
        T.tenantId,
        p,
        T.nutriId,
      ]),
    ).rejects.toSatisfy(check('aniversario_autorizacoes_origem_valida'));
    const linhas = await em(T.ctx, sql`select evento, origem, forma, registrado_por, registrado_em from aniversario_autorizacoes where patient_id = ${p}`);
    expect(linhas).toHaveLength(5);
    for (const l of linhas) expect(l).toMatchObject({ origem: 'nutri', registrado_por: T.nutriId });
  });

  it('aniversario_autorizacoes: o paciente grava só a própria, pela própria conta (app) ou só a retirada sem conta (link); o resto é recusado pela RLS', async () => {
    const T = await novoTenant(app.db);
    const p1 = (await novoPaciente(app.db, T.ctx)).id;
    const p2 = (await novoPaciente(app.db, T.ctx)).id;
    const [u1, u2] = [randomUUID(), randomUUID()];
    const rls = rlsDe('aniversario_autorizacoes');
    const comoP1 = ctxPaciente(T.tenantId, p1, u1);

    await em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'app', forma: null, registradoPor: u1 }));
    await em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'app', evento: 'retirou', forma: null, registradoPor: u1 }));
    await expect(em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'app', forma: null, registradoPor: u2 }))).rejects.toSatisfy(rls);
    await expect(em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'app', forma: null, registradoPor: null }))).rejects.toSatisfy(rls);
    await expect(em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'link', evento: 'retirou', forma: null, registradoPor: null }))).rejects.toSatisfy(rls);
    await expect(em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'nutri', registradoPor: u1 }))).rejects.toSatisfy(rls);
    // forma só na origem nutri: a política deixa passar e o CHECK recusa
    await expect(em(comoP1, inserirAutorizacao(T, { patientId: p1, origem: 'app', forma: 'escrito', registradoPor: u1 }))).rejects.toSatisfy(
      restricao('23514', 'aniversario_autorizacoes_forma'),
    );
    // P2 com a própria conta não grava pelo titular P1
    await expect(em(ctxPaciente(T.tenantId, p2, u2), inserirAutorizacao(T, { patientId: p1, origem: 'app', forma: null, registradoPor: u2 }))).rejects.toSatisfy(rls);

    // link (sem conta): só a retirada, sem autor
    await em(linkSemConta(T, p1), inserirAutorizacao(T, { patientId: p1, origem: 'link', evento: 'retirou', forma: null, registradoPor: null }));
    await expect(em(linkSemConta(T, p1), inserirAutorizacao(T, { patientId: p1, origem: 'link', forma: null, registradoPor: null }))).rejects.toSatisfy(rls);
    await expect(em(linkSemConta(T, p1), inserirAutorizacao(T, { patientId: p1, origem: 'link', evento: 'retirou', forma: null, registradoPor: u1 }))).rejects.toSatisfy(rls);
    await expect(em(linkSemConta(T, p1), inserirAutorizacao(T, { patientId: p1, origem: 'app', evento: 'retirou', forma: null, registradoPor: null }))).rejects.toSatisfy(rls);
    await expect(em(linkSemConta(T, p2), inserirAutorizacao(T, { patientId: p1, origem: 'link', evento: 'retirou', forma: null, registradoPor: null }))).rejects.toSatisfy(rls);

    await expect(em(publico(T), inserirAutorizacao(T, { patientId: p1 }))).rejects.toSatisfy(rls);
    await expect(naConta(inserirAutorizacao(T, { patientId: p1 }))).rejects.toSatisfy(rls);

    // o paciente lê só as próprias; a equipe, todas do consultório; o publico, nenhuma
    expect(await em(comoP1, sql`select origem from aniversario_autorizacoes order by registrado_em`)).toHaveLength(3);
    expect(await em(ctxPaciente(T.tenantId, p2, u2), sql`select 1 from aniversario_autorizacoes`)).toEqual([]);
    expect(await em(T.ctx, sql`select 1 from aniversario_autorizacoes`)).toHaveLength(3);
    expect(await em(publico(T), sql`select 1 from aniversario_autorizacoes`)).toEqual([]);
  });

  it('aniversario_autorizacoes: só inclusão — UPDATE, DELETE e TRUNCATE negados por permissão; sem gatilho de auditoria (AUDIT_EXCEPTIONS)', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const [a] = await em(T.ctx, inserirAutorizacao(T, { patientId: p }));
    await expect(em(T.ctx, sql`update aniversario_autorizacoes set forma = 'verbal' where id = ${a.id}`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(T.ctx, sql`delete from aniversario_autorizacoes where id = ${a.id}`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(T.ctx, sql`truncate aniversario_autorizacoes`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(ctxPaciente(T.tenantId, p), sql`update aniversario_autorizacoes set evento = 'retirou'`)).rejects.toSatisfy(permissaoNegada);
    const { rows } = await owner.pool.query(`select 1 from pg_trigger where tgrelid = 'aniversario_autorizacoes'::regclass and tgname = 'audit_row_change'`);
    expect(rows).toEqual([]);
    expect(await em(T.ctx, sql`select 1 from audit_log where entidade_id = ${a.id}::text`)).toEqual([]);
  });

  it('escrita vira audit_log: o aceite do pedido (solicitada → agendada) é auditado na entidade agenda', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    await em(T.ctx, sql`update tenants set agenda_confirmar_pedidos = true where id = ${T.tenantId}`);
    const h = hora();
    const [c] = await em(
      ctxPaciente(T.tenantId, p),
      sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status)
          values (${T.tenantId}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'paciente', 'solicitada') returning id, status`,
    );
    expect(c.status).toBe('solicitada');
    await em(T.ctx, sql`update appointments set status = 'agendada' where id = ${c.id}`);
    const log = await em(T.ctx, sql`select acao, actor_user_id, patient_id from audit_log where entidade = 'agenda' and entidade_id = ${c.id}::text order by criado_em`);
    expect(log).toEqual([
      { acao: 'criar', actor_user_id: expect.any(String), patient_id: p },
      { acao: 'alterar', actor_user_id: T.nutriId, patient_id: p },
    ]);
  });
});

// T1b: os gatilhos. A recusa de cada um é 42501 com a própria mensagem (nunca a da RLS nem a de permissão).
const negadoPor = (trecho: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && message.includes(trecho);
};
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });
const ligarPedidos = (T: TenantDeTeste) => em(T.ctx, sql`update tenants set agenda_confirmar_pedidos = true where id = ${T.tenantId}`);
/** Várias instruções na mesma transação (o marcador `app.agenda_remarcavel` é local a ela). */
const naTransacao = <R>(ctx: TenantContext, fn: (q: (s: SQL) => Promise<Row[]>) => Promise<R>) =>
  withTenant(ctx, (tx) => fn(async (s) => (await tx.execute(s)).rows as Row[]), app.db);

type Nova = { origem?: 'nutri' | 'paciente'; status?: string; remarcadaDe?: string | null; inicio?: SQL };
/** Consulta presencial; o `status` é o que o código mandaria (o gatilho decide na sessão do paciente e na pública). */
const novaConsulta = (T: TenantDeTeste, patientId: string, n: Nova = {}) => {
  const h = n.inicio ?? hora();
  return sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status, remarcada_de)
    values (${T.tenantId}, ${patientId}, ${h}, ${h} + interval '1 hour', 'presencial', ${n.origem ?? 'paciente'}, ${n.status ?? 'agendada'}, ${n.remarcadaDe ?? null})
    returning id, status`;
};
const cancelar = (id: string, por: string) =>
  sql`update appointments set status = 'cancelada', cancelado_por = ${por}, cancelada_em = now() where id = ${id} returning id`;
const statusDa = async (T: TenantDeTeste, id: string) => (await em(T.ctx, sql`select status from appointments where id = ${id}`))[0].status;

describe('Plano 23 — Agenda 2 no banco (T1b: gatilhos)', () => {
  it('pedido (RN-421): a chave decide o nascimento na sessão do paciente e na pública; a equipe e o worker nunca criam pedido', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const comoP = ctxPaciente(T.tenantId, p);
    const nasce = async (ctx: TenantContext, n: Nova = {}) => (await em(ctx, novaConsulta(T, p, n)))[0].status;

    // chave desligada: agendada, mesmo se o código mandar solicitada
    expect(await nasce(comoP)).toBe('agendada');
    expect(await nasce(comoP, { status: 'solicitada' })).toBe('agendada');
    expect(await nasce(publico(T))).toBe('agendada');

    await ligarPedidos(T);
    expect(await nasce(comoP)).toBe('solicitada');
    expect(await nasce(comoP, { status: 'confirmada' })).toBe('solicitada');
    expect(await nasce(publico(T))).toBe('solicitada');
    // solicitada só com origem paciente (o gatilho decide o status; o CHECK recusa a origem)
    await expect(em(comoP, novaConsulta(T, p, { origem: 'nutri' }))).rejects.toSatisfy(restricao('23514', 'appointments_solicitada_do_paciente'));

    // a equipe e o worker: o que o código mandou, nunca solicitada (o aceite da pessoa nova grava origem paciente na sessão nutri)
    for (const ctx of [T.ctx, worker(T)]) {
      expect(await nasce(ctx, { origem: 'nutri' })).toBe('agendada');
      expect(await nasce(ctx)).toBe('agendada');
      await expect(em(ctx, novaConsulta(T, p, { status: 'solicitada' }))).rejects.toSatisfy(negadoPor('só nasce pedido na sessão do paciente'));
    }
    // os motivos de pedido só existem saindo de solicitada: nunca no INSERT
    await expect(
      em(T.ctx, sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status, cancelado_por, cancelada_em)
        values (${T.tenantId}, ${p}, ${hora()}, ${hora()}, 'presencial', 'paciente', 'cancelada', 'pedido_recusado', now())`),
    ).rejects.toSatisfy(negadoPor('saindo de um pedido'));
  });

  it('remarcação (RN-421): o cancelamento pelo paciente libera UMA consulta agendada com remarcada_de, também em SAVEPOINT; desistir do pedido nunca libera', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const outro = (await novoPaciente(app.db, T.ctx)).id;
    const comoP = ctxPaciente(T.tenantId, p);
    await ligarPedidos(T);
    const marcada = async (patientId = p) => (await em(T.ctx, novaConsulta(T, patientId, { origem: 'nutri' })))[0].id as string;

    // cancela a agendada e remarca: agendada; o segundo INSERT com o mesmo marcador volta a ser pedido
    const a = await marcada();
    expect(
      await naTransacao(comoP, async (q) => {
        await q(cancelar(a, 'paciente'));
        const [n1] = await q(novaConsulta(T, p, { remarcadaDe: a }));
        const [n2] = await q(novaConsulta(T, p, { remarcadaDe: a }));
        return [n1.status, n2.status];
      }),
    ).toEqual(['agendada', 'solicitada']);

    // confirmada também; dentro de SAVEPOINT (liberado) vale; desfeito o SAVEPOINT, o marcador vai junto
    const b = await marcada();
    await em(T.ctx, sql`update appointments set status = 'confirmada', confirmada_via = 'link' where id = ${b}`);
    expect(
      await naTransacao(comoP, async (q) => {
        await q(sql`savepoint remarcar`);
        await q(cancelar(b, 'paciente'));
        const [n] = await q(novaConsulta(T, p, { remarcadaDe: b }));
        await q(sql`release savepoint remarcar`);
        return n.status;
      }),
    ).toBe('agendada');
    const c = await marcada();
    expect(
      await naTransacao(comoP, async (q) => {
        await q(sql`savepoint remarcar`);
        await q(cancelar(c, 'paciente'));
        await q(sql`rollback to savepoint remarcar`);
        const [n] = await q(novaConsulta(T, p, { remarcadaDe: c }));
        return n.status;
      }),
    ).toBe('solicitada');
    expect(await statusDa(T, c)).toBe('agendada');

    // desistir de um pedido (pedido_desistido) não abre a exceção
    const [s] = await em(comoP, novaConsulta(T, p));
    expect(s.status).toBe('solicitada');
    expect(
      await naTransacao(comoP, async (q) => {
        await q(cancelar(s.id as string, 'pedido_desistido'));
        const [n] = await q(novaConsulta(T, p, { remarcadaDe: s.id as string }));
        return n.status;
      }),
    ).toBe('solicitada');

    // remarcada_de que não é a consulta cancelada (a de outro paciente) → pedido
    const d = await marcada();
    const deOutro = await marcada(outro);
    expect(
      await naTransacao(comoP, async (q) => {
        await q(cancelar(d, 'paciente'));
        const [n] = await q(novaConsulta(T, p, { remarcadaDe: deOutro }));
        return n.status;
      }),
    ).toBe('solicitada');
    // a origem tem de ser do mesmo paciente, mesmo com o marcador apontando para ela (aqui forjado na sessão pública,
    // que enxerga as consultas do consultório; no app só o gatilho grava o marcador)
    const e = await marcada();
    expect(
      await naTransacao(publico(T), async (q) => {
        await q(sql`select set_config('app.agenda_remarcavel', ${e}, true)`);
        const [doMesmo] = await q(novaConsulta(T, p, { remarcadaDe: e }));
        await q(sql`select set_config('app.agenda_remarcavel', ${deOutro}, true)`);
        const [doOutro] = await q(novaConsulta(T, p, { remarcadaDe: deOutro }));
        return [doMesmo.status, doOutro.status];
      }),
    ).toEqual(['agendada', 'solicitada']);

    // a nutricionista cancelando não libera nada (o marcador é do cancelamento pelo paciente, na sessão do paciente); na
    // sessão do paciente, o cancelamento com cancelado_por = 'nutri' nem passa (rodada 1 da T1b)
    const f = await marcada();
    await expect(em(comoP, cancelar(f, 'nutri'))).rejects.toSatisfy(negadoPor('o paciente só confirma ou cancela a consulta'));
    await em(T.ctx, cancelar(f, 'nutri'));
    expect((await em(comoP, novaConsulta(T, p, { remarcadaDe: f })))[0].status).toBe('solicitada');
  });

  it('transições do pedido (RN-422): aceite só da nutricionista; cada cancelamento com o seu papel e motivo; nada volta a pedido; o pedido não muda de horário, local, modalidade nem paciente', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const outro = (await novoPaciente(app.db, T.ctx)).id;
    const comoP = ctxPaciente(T.tenantId, p);
    const local = await criarLocal(T, { principal: true });
    await ligarPedidos(T);
    const pedido = async (inicio?: SQL) => {
      const [c] = await em(comoP, novaConsulta(T, p, { inicio }));
      expect(c.status).toBe('solicitada');
      return c.id as string;
    };
    const aceitar = (id: string) => sql`update appointments set status = 'agendada' where id = ${id} returning id`;

    // aceite: só a nutricionista
    const a = await pedido();
    for (const ctx of [comoP, worker(T)]) await expect(em(ctx, aceitar(a))).rejects.toSatisfy(negadoPor('só a nutricionista aceita o pedido'));
    await em(T.ctx, aceitar(a));
    expect(await statusDa(T, a)).toBe('agendada');

    // os três cancelamentos válidos
    const b = await pedido();
    await em(comoP, cancelar(b, 'pedido_desistido'));
    const c = await pedido();
    await em(T.ctx, cancelar(c, 'pedido_recusado'));
    const perto = await pedido(sql`date_trunc('minute', now()) + interval '1 hour'`); // dentro da antecedência (12 h): venceu
    await em(worker(T), cancelar(perto, 'pedido_vencido'));
    for (const id of [b, c, perto]) expect(await statusDa(T, id)).toBe('cancelada');

    // papel × motivo trocados
    const d = await pedido();
    const trocados: [TenantContext, string][] = [
      [comoP, 'pedido_recusado'],
      [comoP, 'pedido_vencido'],
      [comoP, 'paciente'],
      [T.ctx, 'pedido_desistido'],
      [T.ctx, 'pedido_vencido'],
      [T.ctx, 'nutri'],
      [worker(T), 'pedido_desistido'],
      [worker(T), 'pedido_recusado'],
      [worker(T), 'sistema'],
    ];
    for (const [ctx, por] of trocados) await expect(em(ctx, cancelar(d, por)), `${ctx.role} + ${por}`).rejects.toSatisfy(negadoPor('quem cancela o pedido'));
    // o worker não vence pedido no prazo (o processo web também usa o papel worker)
    await expect(em(worker(T), cancelar(d, 'pedido_vencido'))).rejects.toSatisfy(negadoPor('ainda está no prazo'));
    // só aceito ou cancelado
    for (const status of ['confirmada', 'realizada', 'faltou'])
      await expect(em(T.ctx, sql`update appointments set status = ${status} where id = ${d}`), status).rejects.toSatisfy(negadoPor('o pedido só é aceito ou cancelado'));

    // em solicitada, horário, local, modalidade e paciente não mudam; o resto muda
    const fixos: SQL[] = [
      sql`inicio = inicio + interval '30 minutes'`,
      sql`fim = fim + interval '30 minutes'`,
      sql`local_id = ${local}`,
      sql`modalidade = 'online', link_online = 'https://sala.example.test/debby'`,
      sql`patient_id = ${outro}`,
    ];
    for (const set of fixos) await expect(em(T.ctx, sql`update appointments set ${set} where id = ${d}`)).rejects.toSatisfy(negadoPor('não mudam'));
    expect(await em(T.ctx, sql`update appointments set updated_at = now() where id = ${d} returning id`)).toHaveLength(1);

    // nenhum UPDATE leva a solicitada; os motivos de pedido só saindo de solicitada
    const [ag] = await em(T.ctx, novaConsulta(T, p, { origem: 'nutri' }));
    for (const ctx of [T.ctx, comoP, worker(T)])
      await expect(em(ctx, sql`update appointments set status = 'solicitada', origem = 'paciente' where id = ${ag.id}`)).rejects.toSatisfy(
        negadoPor('nenhuma alteração leva a consulta a pedido'),
      );
    const deAgendada: [TenantContext, string][] = [
      [comoP, 'pedido_desistido'],
      [T.ctx, 'pedido_recusado'],
      [worker(T), 'pedido_vencido'],
    ];
    for (const [ctx, por] of deAgendada) await expect(em(ctx, cancelar(ag.id as string, por)), por).rejects.toSatisfy(negadoPor('saindo de um pedido'));
    expect(await statusDa(T, ag.id as string)).toBe('agendada');

    // sistema (exclusão LGPD) só com o titular já bloqueado
    await expect(em(T.ctx, cancelar(d, 'sistema'))).rejects.toSatisfy(negadoPor('quem cancela o pedido'));
    await em(T.ctx, sql`update patients set status = 'bloqueado', bloqueado_em = now() where id = ${p}`);
    await em(T.ctx, cancelar(d, 'sistema'));
    expect(await statusDa(T, d)).toBe('cancelada');
  });

  it('sessão do paciente (RN-422, rodada 1 da T1b): só confirma, pede remarcação ou cancela; não reabre consulta encerrada nem muda horário, local, modalidade, link ou origem', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const outro = (await novoPaciente(app.db, T.ctx)).id;
    const comoP = ctxPaciente(T.tenantId, p);
    const local = await criarLocal(T, { principal: true });
    await ligarPedidos(T);
    const marcada = async (inicio?: SQL) => (await em(T.ctx, novaConsulta(T, p, { origem: 'nutri', inicio })))[0].id as string;
    const linha = async (id: string) =>
      (await em(T.ctx, sql`select status, cancelado_por, confirmada_via, pedido_remarcacao_em is not null as pedido, inicio from appointments where id = ${id}`))[0];
    const naSessao = (id: string, set: SQL) => em(comoP, sql`update appointments set ${set} where id = ${id} returning id`);
    const encerrada = negadoPor('consulta encerrada não muda na sessão do paciente');
    const fixo = negadoPor('o paciente não muda o horário');
    const soConfirmaOuCancela = negadoPor('o paciente só confirma ou cancela a consulta');

    // controles positivos: as escritas do módulo (cancelamento.ts), coluna a coluna
    const a = await marcada();
    expect(await naSessao(a, sql`pedido_remarcacao_em = now(), updated_at = now()`)).toHaveLength(1); // pedirRemarcacao
    expect(await naSessao(a, sql`status = 'confirmada', confirmada_via = 'link', pedido_remarcacao_em = null, updated_at = now()`)).toHaveLength(1); // confirmarPresenca
    expect(await naSessao(a, sql`pedido_remarcacao_em = now(), updated_at = now()`)).toHaveLength(1);
    expect(await naSessao(a, sql`pedido_remarcacao_em = null, updated_at = now()`)).toHaveLength(1); // confirmarPresenca na já confirmada
    expect(
      await naSessao(a, sql`status = 'cancelada', cancelado_por = 'paciente', cancelada_em = now(), motivo_cancelamento = 'Imprevisto', pedido_remarcacao_em = null, updated_at = now()`),
    ).toHaveLength(1); // cancelarConsulta
    expect(await linha(a)).toMatchObject({ status: 'cancelada', cancelado_por: 'paciente', confirmada_via: 'link', pedido: false });
    // remarcarComoPaciente: cancela a agendada e cria a nova com remarcada_de (agendada, com a chave ligada)
    const b = await marcada();
    expect(
      await naTransacao(comoP, async (q) => {
        await q(sql`update appointments set status = 'cancelada', cancelado_por = 'paciente', cancelada_em = now(), motivo_cancelamento = 'Remarcada pelo paciente',
          pedido_remarcacao_em = null, updated_at = now() where id = ${b}`);
        const [n] = await q(novaConsulta(T, p, { remarcadaDe: b }));
        return n.status;
      }),
    ).toBe('agendada');
    // o UPDATE sem mudança (o do teste de isolamento) passa também na encerrada
    expect(await naSessao(a, sql`patient_id = patient_id`)).toHaveLength(1);
    expect(await naSessao(a, sql`updated_at = now()`)).toHaveLength(1);

    // encerrada não reabre: cancelada pelo paciente, pedido desistido, pedido recusado, realizada, faltou
    const reabrir = sql`status = 'agendada', cancelado_por = null, cancelada_em = null`;
    await expect(naSessao(a, reabrir)).rejects.toSatisfy(encerrada);
    const [desistido] = await em(comoP, novaConsulta(T, p));
    expect(desistido.status).toBe('solicitada');
    await em(comoP, cancelar(desistido.id as string, 'pedido_desistido'));
    await expect(naSessao(desistido.id as string, reabrir)).rejects.toSatisfy(encerrada);
    const [recusado] = await em(comoP, novaConsulta(T, p));
    await em(T.ctx, cancelar(recusado.id as string, 'pedido_recusado'));
    await expect(naSessao(recusado.id as string, reabrir)).rejects.toSatisfy(encerrada);
    const realizada = await marcada();
    const faltou = await marcada();
    await em(T.ctx, sql`update appointments set status = 'realizada', presenca_em = now() where id = ${realizada}`);
    await em(T.ctx, sql`update appointments set status = 'faltou', presenca_em = now() where id = ${faltou}`);
    await expect(naSessao(realizada, sql`status = 'agendada'`)).rejects.toSatisfy(encerrada);
    await expect(naSessao(faltou, sql`status = 'confirmada', confirmada_via = 'link'`)).rejects.toSatisfy(encerrada);
    await expect(naSessao(realizada, sql`status = 'agendada', inicio = inicio + interval '1 day', fim = fim + interval '1 day'`)).rejects.toSatisfy(fixo);
    // nem o motivo, quem cancelou ou a presença da encerrada
    await expect(naSessao(a, sql`motivo_cancelamento = 'Outro motivo'`)).rejects.toSatisfy(encerrada);
    await expect(naSessao(recusado.id as string, sql`cancelado_por = 'paciente'`)).rejects.toSatisfy(encerrada);
    await expect(naSessao(faltou, sql`pedido_remarcacao_em = now()`)).rejects.toSatisfy(encerrada);
    expect((await linha(a)).status).toBe('cancelada');
    expect((await linha(desistido.id as string)).status).toBe('cancelada');
    expect((await linha(recusado.id as string)).status).toBe('cancelada');
    expect((await linha(realizada)).status).toBe('realizada');

    // agendada e confirmada: horário, local, modalidade, link, origem, remarcada_de e presença fixos
    const c = await marcada();
    const fixos: SQL[] = [
      sql`inicio = inicio + interval '30 minutes', fim = fim + interval '30 minutes'`,
      sql`inicio = inicio - interval '30 minutes'`,
      sql`fim = fim + interval '30 minutes'`,
      sql`local_id = ${local}`,
      sql`modalidade = 'online', link_online = 'https://sala.example.test/outra'`,
      sql`origem = 'paciente'`,
      sql`remarcada_de = ${b}`,
      sql`presenca_em = now()`,
    ];
    for (const set of fixos) await expect(naSessao(c, set)).rejects.toSatisfy(fixo);
    // o paciente da consulta fica com a RLS (patient_isolation), como prova o teste de isolamento
    await expect(naSessao(c, sql`patient_id = ${outro}`)).rejects.toSatisfy(rlsDe('appointments'));
    await em(T.ctx, sql`update appointments set status = 'confirmada', confirmada_via = 'whatsapp' where id = ${c}`);
    await expect(naSessao(c, sql`inicio = inicio + interval '1 day', fim = fim + interval '1 day'`)).rejects.toSatisfy(fixo);
    // só as transições do paciente: agendada → confirmada, agendada|confirmada → cancelada (paciente), solicitada → cancelada (pedido_desistido)
    await expect(naSessao(c, sql`status = 'agendada'`)).rejects.toSatisfy(soConfirmaOuCancela);
    const d = await marcada();
    for (const set of [sql`status = 'realizada'`, sql`status = 'faltou'`])
      await expect(naSessao(d, set)).rejects.toSatisfy(soConfirmaOuCancela);
    for (const por of ['nutri', 'sistema']) await expect(naSessao(d, sql`status = 'cancelada', cancelado_por = ${por}, cancelada_em = now()`), por).rejects.toSatisfy(soConfirmaOuCancela);
    // a via da confirmação só na confirmação; o motivo só no cancelamento
    await expect(naSessao(c, sql`confirmada_via = 'link'`)).rejects.toSatisfy(negadoPor('a via da confirmação só muda'));
    await expect(naSessao(d, sql`motivo_cancelamento = 'Sem cancelar'`)).rejects.toSatisfy(negadoPor('o motivo só muda no cancelamento'));
    expect(await linha(c)).toMatchObject({ status: 'confirmada', confirmada_via: 'whatsapp' });
    expect((await linha(d)).status).toBe('agendada');

    // a equipe continua mudando o horário e reabrindo (moverConsulta): a regra é só da sessão do paciente
    expect(await em(T.ctx, sql`update appointments set inicio = inicio + interval '30 minutes', fim = fim + interval '30 minutes', status = 'agendada', confirmada_via = null where id = ${c} returning id`)).toHaveLength(1);

    // marcador: só o cancelamento de consulta que ainda não começou libera a remarcação
    const passada = await marcada(sql`date_trunc('minute', now()) - interval '3 hours'`);
    expect(
      await naTransacao(comoP, async (q) => {
        await q(cancelar(passada, 'paciente'));
        const [n] = await q(novaConsulta(T, p, { remarcadaDe: passada }));
        return n.status;
      }),
    ).toBe('solicitada');
  });

  it('tenants_agenda_da_equipe (RN-420): paciente, publico, conta e worker não mudam a chave dos pedidos; só a nutricionista muda; outra coluna não é barrada por este gatilho', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    const comoP = ctxPaciente(T.tenantId, p);
    const mudar = (v: boolean) => sql`update tenants set agenda_confirmar_pedidos = ${v} where id = ${T.tenantId} returning id`;
    const negado = negadoPor('só a nutricionista muda a confirmação dos pedidos');
    // o worker também não (revisão da T1b): o processo web usa o papel worker (página pública, limpeza)
    for (const ctx of [comoP, linkSemConta(T, p), publico(T), worker(T)]) await expect(em(ctx, mudar(true)), ctx.role).rejects.toSatisfy(negado);
    await expect(naConta(mudar(true))).rejects.toSatisfy(negado);
    expect(await em(T.ctx, mudar(true))).toHaveLength(1);
    expect(await em(T.ctx, mudar(false))).toHaveLength(1);
    expect(await em(T.ctx, mudar(true))).toHaveLength(1);
    // o mesmo valor, ou outra coluna, passa por este gatilho
    expect(await em(comoP, mudar(true))).toHaveLength(1);
    expect(await em(worker(T), mudar(true))).toHaveLength(1);
    expect(await em(comoP, sql`update tenants set updated_at = now() where id = ${T.tenantId} returning id`)).toHaveLength(1);
    expect(await em(worker(T), sql`update tenants set updated_at = now() where id = ${T.tenantId} returning id`)).toHaveLength(1);
    expect(await em(T.ctx, sql`select agenda_confirmar_pedidos from tenants where id = ${T.tenantId}`)).toEqual([{ agenda_confirmar_pedidos: true }]);
  });

  it('aniversario_autorizacoes_regras (RN-433): registrado_em pelo relógio do banco; a equipe só pela origem nutri em nome da própria usuária; o worker não registra; autorizou só de titular ativo e visível', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;

    // registrado_em = clock_timestamp(), mesmo se o módulo mandar outro
    const [r] = await naTransacao(T.ctx, async (q) => {
      await q(sql`select pg_sleep(0.01)`);
      return q(sql`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, forma, registrado_por, registrado_em)
        values (${T.tenantId}, ${p}, 'autorizou', 'nutri', 'escrito', ${T.nutriId}, '2000-01-01T00:00:00Z')
        returning registrado_em > now() as depois_do_inicio, registrado_em <= clock_timestamp() as ate_agora`);
    });
    expect(r).toEqual({ depois_do_inicio: true, ate_agora: true });

    // a equipe: só origem nutri, em nome da própria usuária
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, registradoPor: randomUUID() }))).rejects.toSatisfy(negadoPor('em nome da própria usuária'));
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, registradoPor: null }))).rejects.toSatisfy(negadoPor('em nome da própria usuária'));
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, origem: 'app', forma: null }))).rejects.toSatisfy(negadoPor('a equipe registra só pela origem nutri'));
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, origem: 'link', evento: 'retirou', forma: null, registradoPor: null }))).rejects.toSatisfy(
      negadoPor('a equipe registra só pela origem nutri'),
    );
    await em(T.ctx, inserirAutorizacao(T, { patientId: p, evento: 'retirou', forma: null }));
    // o worker não registra
    for (const a of [{ evento: 'retirou' as const, forma: null, registradoPor: null }, { registradoPor: randomUUID() }])
      await expect(em(worker(T), inserirAutorizacao(T, { patientId: p, ...a }))).rejects.toSatisfy(negadoPor('o worker não registra'));
    // o publico: quem recusa é a RLS (publico_negado), não o gatilho
    await expect(em(publico(T), inserirAutorizacao(T, { patientId: p, registradoPor: null, origem: 'link', evento: 'retirou', forma: null }))).rejects.toSatisfy(
      rlsDe('aniversario_autorizacoes'),
    );

    // titular arquivado, bloqueado ou anonimizado: autorizou → gatilho (em qualquer papel que o enxergue); retirou passa
    const arquivado = (await novoPaciente(app.db, T.ctx)).id;
    const bloqueado = (await novoPaciente(app.db, T.ctx)).id;
    const anonimizado = (await novoPaciente(app.db, T.ctx)).id;
    await em(T.ctx, sql`update patients set status = 'arquivado' where id = ${arquivado}`);
    await em(T.ctx, sql`update patients set status = 'bloqueado', bloqueado_em = now() where id = ${bloqueado}`);
    await em(worker(T), sql`update patients set anonimizado_em = now() where id = ${anonimizado}`); // ainda 'ativo': só o anonimizado_em
    const titular = negadoPor('só o titular ativo autoriza');
    for (const id of [arquivado, bloqueado, anonimizado]) {
      await expect(em(T.ctx, inserirAutorizacao(T, { patientId: id }))).rejects.toSatisfy(titular);
      await em(T.ctx, inserirAutorizacao(T, { patientId: id, evento: 'retirou', forma: null }));
    }
    const u = randomUUID();
    await expect(em(ctxPaciente(T.tenantId, bloqueado, u), inserirAutorizacao(T, { patientId: bloqueado, origem: 'app', forma: null, registradoPor: u }))).rejects.toSatisfy(titular);
    await em(ctxPaciente(T.tenantId, bloqueado, u), inserirAutorizacao(T, { patientId: bloqueado, origem: 'app', evento: 'retirou', forma: null, registradoPor: u }));
    await em(linkSemConta(T, arquivado), inserirAutorizacao(T, { patientId: arquivado, origem: 'link', evento: 'retirou', forma: null, registradoPor: null }));

    // o titular invisível passa pelo gatilho e a RLS recusa: outro paciente, outro consultório
    const u2 = randomUUID();
    await expect(em(ctxPaciente(T.tenantId, p, u2), inserirAutorizacao(T, { patientId: bloqueado, origem: 'app', forma: null, registradoPor: u2 }))).rejects.toSatisfy(
      rlsDe('aniversario_autorizacoes'),
    );
    const U = await novoTenant(app.db);
    await expect(em(U.ctx, inserirAutorizacao(T, { patientId: bloqueado, registradoPor: U.nutriId }))).rejects.toSatisfy(rlsDe('aniversario_autorizacoes'));
    await expect(em(U.ctx, inserirAutorizacao(T, { patientId: p, registradoPor: U.nutriId }))).rejects.toSatisfy(rlsDe('aniversario_autorizacoes'));
  });
});
