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
 * índices únicos. SQL cru, sem módulo. Os gatilhos (T1b) e as peças SECURITY DEFINER (T1c, migrate-owner.test.ts, com dono
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
 * de `appointments` ficam provados mesmo com o `appointments_regras_pedido` (T1b) decidindo o nascimento por sessão.
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
    await expect(em(T.ctx, inserirAutorizacao(T, { patientId: p, origem: 'email', forma: null }))).rejects.toSatisfy(check('aniversario_autorizacoes_origem_valida'));
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
