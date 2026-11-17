import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 20 (spec §9): as três tabelas do Financeiro no banco — RLS (staff_only), gatilhos fin_lancamentos_regras e
 * fin_categorias_fixas, a função app_anonimizar_financeiro, os CHECKs, os REVOKEs e a auditoria. Tudo por SQL cru, sem o
 * módulo (T2 em diante): é o que o banco garante sozinho.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });
const publico = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'publico' });

const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  return { code: x.code ?? x.cause?.code, message: x.cause?.message ?? x.message ?? '' };
};
/** Recusa da RLS da própria tabela (WITH CHECK), nunca de outro motivo. */
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
/** 42501 do gatilho (mensagem própria), não da RLS nem da permissão. */
const doGatilho = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && !/row-level security|permission denied/.test(message);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
const comCodigo = (codigo: string) => (e: unknown) => erro(e).code === codigo;

type Cenario = TenantDeTeste & { p: string; entrada: string; saida: string };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  const p = (await novoPaciente(app.db, T.ctx)).id;
  const [e] = await em(T.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome) values (${T.tenantId}, 'entrada', 'Outras entradas') returning id`);
  const [s] = await em(T.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome) values (${T.tenantId}, 'saida', 'Aluguel e condomínio') returning id`);
  return { ...T, p, entrada: e.id as string, saida: s.id as string };
}

type Lancamento = {
  tipo?: 'entrada' | 'saida';
  categoria?: string;
  valor?: number;
  vencimento?: string;
  paciente?: string | null;
  consulta?: string | null;
  pagoEm?: string | null;
  forma?: string | null;
  descricao?: string | null;
  criadoPor?: string;
};
const inserir = (C: Cenario, l: Lancamento = {}) => {
  const tipo = l.tipo ?? 'entrada';
  const paciente = l.paciente === undefined ? (tipo === 'entrada' ? C.p : null) : l.paciente;
  return sql`insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, appointment_id, pago_em, forma_pagamento, descricao, criado_por)
    values (${C.tenantId}, ${tipo}, ${l.categoria ?? (tipo === 'entrada' ? C.entrada : C.saida)}, ${l.valor ?? 25000}, ${l.vencimento ?? '2026-11-10'},
            ${paciente}, ${l.consulta ?? null}, ${l.pagoEm ?? null}, ${l.forma ?? null}, ${l.descricao === undefined ? 'Retorno' : l.descricao}, ${l.criadoPor ?? randomUUID()})
    returning *`;
};
const lancar = async (C: Cenario, l: Lancamento = {}) => (await em(C.ctx, inserir(C, l)))[0];
const atualizar = (C: Cenario, id: unknown, set: SQL, ctx: TenantContext = C.ctx) => em(ctx, sql`update fin_lancamentos set ${set} where id = ${id} returning *`);
const ler = async (id: unknown) => (await owner.pool.query('select * from fin_lancamentos where id = $1', [id])).rows[0] as Row;

let seqConsulta = 0;
const consulta = async (C: Cenario, paciente = C.p) =>
  (
    await em(
      C.ctx,
      sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, status, origem)
          values (${C.tenantId}, ${paciente}, '2026-11-02T12:00:00Z'::timestamptz + ${++seqConsulta} * interval '2 hours',
                  '2026-11-02T13:00:00Z'::timestamptz + ${seqConsulta} * interval '2 hours', 'presencial', 'realizada', 'nutri') returning id`,
    )
  )[0].id as string;

const bloquear = (C: Cenario, paciente: string, anonimizarApos: SQL = sql`'2046-01-01'`) =>
  em(worker(C), sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = ${anonimizarApos} where id = ${paciente}`);

describe('Plano 20 — Financeiro no banco (spec §9)', () => {
  it('nutri cria e lê; paciente, publico e conta não leem nenhuma linha (staff_only, publico_negado)', async () => {
    const C = await cenario();
    await em(C.ctx, sql`insert into fin_configuracoes (tenant_id, saldo_inicial_centavos, saldo_inicial_em, valor_consulta_centavos) values (${C.tenantId}, 100000, '2026-11-01', 25000)`);
    await lancar(C);
    const tabelas = ['fin_configuracoes', 'fin_categorias', 'fin_lancamentos'];
    for (const t of tabelas) expect((await em(C.ctx, sql`select 1 from ${sql.identifier(t)}`)).length, t).toBeGreaterThan(0);
    for (const t of tabelas) {
      expect(await em(ctxPaciente(C.tenantId, C.p), sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
      expect(await em(publico(C), sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
      expect((await withConta(randomUUID(), (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)}`), app.db)).rows, t).toEqual([]);
    }
  });

  it('INSERT em fin_lancamentos com categoria já existente: paciente, publico e conta → RLS da própria tabela; worker → 42501 do gatilho (COM_MAE não esconde a política)', async () => {
    const C = await cenario();
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    await expect(em(ctxPaciente(C.tenantId, C.p), inserir(C))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    await expect(em(publico(C), inserir(C))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    await expect(withConta(randomUUID(), (tx) => tx.execute(inserir(C)), app.db)).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    await expect(em(worker(C), inserir(C))).rejects.toSatisfy(doGatilho);
    // paciente invisível ao contexto: o gatilho deixa passar (não lê patients fora da sessão nutri) e a recusa é da RLS
    await expect(em(ctxPaciente(C.tenantId, outro), inserir(C, { paciente: C.p }))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    await expect(em(publico(C), inserir(C, { paciente: outro }))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    await expect(withConta(randomUUID(), (tx) => tx.execute(inserir(C, { paciente: outro })), app.db)).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    expect((await owner.pool.query('select count(*)::int as n from fin_lancamentos where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(0);
  });

  it('criado_por é o da sessão; o INSERT não nasce cancelado nem anonimizado', async () => {
    const C = await cenario();
    const l = await lancar(C, { criadoPor: randomUUID() });
    expect(l.criado_por).toBe(C.nutriId);
    const [forjado] = await em(
      C.ctx,
      sql`insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, criado_por, cancelado_em, cancelado_por, motivo_cancelamento, anonimizado_em)
          values (${C.tenantId}, 'saida', ${C.saida}, 100, '2026-11-10', ${randomUUID()}, now(), ${randomUUID()}, 'x', now()) returning *`,
    );
    expect(forjado).toMatchObject({ criado_por: C.nutriId, cancelado_em: null, cancelado_por: null, motivo_cancelamento: null, anonimizado_em: null });
  });

  it('colunas fixas: tipo, patient_id, appointment_id, criado_por e created_at → 42501; UPDATE sem mudança passa', async () => {
    const C = await cenario();
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    const a = await consulta(C);
    const l = await lancar(C);
    // tipo sozinho: entrada sem paciente → saída com categoria de saída. FK composta e CHECKs aceitariam; só o gatilho recusa.
    const semPaciente = await lancar(C, { paciente: null });
    await expect(atualizar(C, semPaciente.id, sql`tipo = 'saida', categoria_id = ${C.saida}`)).rejects.toSatisfy(doGatilho);
    for (const set of [
      sql`patient_id = null`,
      sql`patient_id = ${outro}`,
      sql`appointment_id = ${a}`,
      sql`criado_por = ${randomUUID()}`,
      sql`created_at = now() - interval '1 day'`,
    ]) {
      await expect(atualizar(C, l.id, set)).rejects.toSatisfy(doGatilho);
    }
    expect(await atualizar(C, l.id, sql`valor_centavos = valor_centavos, tenant_id = tenant_id, patient_id = patient_id`)).toHaveLength(1);
  });

  it('cancelamento: sem motivo → CHECK; com motivo, cancelado_por e cancelado_em do banco; cancelado não muda mais', async () => {
    const C = await cenario();
    const l = await lancar(C, { pagoEm: '2026-11-05', forma: 'pix' });
    await expect(atualizar(C, l.id, sql`cancelado_em = now()`)).rejects.toSatisfy(comCodigo('23514'));
    const antes = Date.now();
    const [c] = await atualizar(C, l.id, sql`cancelado_em = '2001-01-01', cancelado_por = ${randomUUID()}, motivo_cancelamento = 'Devolução'`);
    expect(c.cancelado_por).toBe(C.nutriId);
    expect(new Date(c.cancelado_em as string).getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    expect(c.motivo_cancelamento).toBe('Devolução');
    await expect(atualizar(C, l.id, sql`valor_centavos = 100`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C, l.id, sql`cancelado_em = null, cancelado_por = null, motivo_cancelamento = null`)).rejects.toSatisfy(doGatilho);
  });

  it('coerência: saída com paciente, consulta sem paciente, pago sem forma e valor 0 → CHECK; categoria de outro tipo → FK', async () => {
    const C = await cenario();
    const a = await consulta(C);
    await expect(lancar(C, { tipo: 'saida', paciente: C.p })).rejects.toSatisfy(comCodigo('23514'));
    await expect(lancar(C, { paciente: null, consulta: a })).rejects.toSatisfy(comCodigo('23514'));
    await expect(lancar(C, { pagoEm: '2026-11-05', forma: null })).rejects.toSatisfy(comCodigo('23514'));
    await expect(lancar(C, { valor: 0 })).rejects.toSatisfy(comCodigo('23514'));
    await expect(lancar(C, { forma: 'cheque', pagoEm: '2026-11-05' })).rejects.toSatisfy(comCodigo('23514'));
    await expect(lancar(C, { tipo: 'entrada', categoria: C.saida })).rejects.toSatisfy(comCodigo('23503'));
    // consulta de outro paciente do mesmo consultório: a FK composta (tenant, paciente, consulta) recusa
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    await expect(lancar(C, { paciente: outro, consulta: a })).rejects.toSatisfy(comCodigo('23503'));
  });

  it('paciente bloqueado (RN-315): nenhum lançamento novo; só receber, desfazer, reduzir o valor e cancelar', async () => {
    const C = await cenario();
    const outra = (await em(C.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome) values (${C.tenantId}, 'entrada', 'Pacotes') returning id`))[0].id;
    const l = await lancar(C, { valor: 10000 });
    await bloquear(C, C.p);
    await expect(lancar(C)).rejects.toSatisfy(doGatilho);
    expect(await atualizar(C, l.id, sql`pago_em = '2026-11-05', forma_pagamento = 'pix', updated_at = now()`)).toHaveLength(1);
    expect(await atualizar(C, l.id, sql`pago_em = null, forma_pagamento = null`)).toHaveLength(1);
    expect(await atualizar(C, l.id, sql`valor_centavos = 8000`)).toHaveLength(1);
    expect(await atualizar(C, l.id, sql`valor_centavos = 8000`)).toHaveLength(1);
    await expect(atualizar(C, l.id, sql`valor_centavos = 8001`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C, l.id, sql`vencimento = '2026-12-01'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C, l.id, sql`categoria_id = ${outra}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C, l.id, sql`descricao = 'Outra'`)).rejects.toSatisfy(doGatilho);
    const [c] = await atualizar(C, l.id, sql`cancelado_em = now(), motivo_cancelamento = 'Desistência'`);
    expect(c.cancelado_por).toBe(C.nutriId);
  });

  it('bloqueio concorrente: o INSERT espera o FOR UPDATE do bloqueio e, depois do commit, recebe 42501', async () => {
    const C = await cenario();
    const a = await app.pool.connect();
    const b = await app.pool.connect();
    const ctx = (c: typeof a) =>
      c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.user_id', $2, true)`, [C.tenantId, C.nutriId]);
    try {
      await a.query('begin');
      await ctx(a);
      await a.query('select 1 from patients where id = $1 for update', [C.p]);
      await a.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = $1`, [C.p]);
      await b.query('begin');
      await ctx(b);
      const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      const insercao = b
        .query(
          `insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, criado_por) values ($1, 'entrada', $2, 100, '2026-11-10', $3, $4)`,
          [C.tenantId, C.entrada, C.p, C.nutriId],
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
      // B fica parado na trava do paciente (FOR KEY SHARE do gatilho × FOR UPDATE de A)
      for (let i = 0; ; i++) {
        const { rows } = await owner.pool.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pidB]);
        if (rows[0]?.wait_event_type === 'Lock') break;
        if (i > 200) throw new Error('B não esperou a trava do paciente');
        await new Promise((r) => setTimeout(r, 25));
      }
      await a.query('commit');
      expect(await insercao).toSatisfy(doGatilho);
    } finally {
      await a.query('rollback').catch(() => undefined);
      await b.query('rollback').catch(() => undefined);
      a.release();
      b.release();
    }
  });

  it('anonimização (RN-316): só no worker, com o paciente bloqueado e o prazo vencido; textos saem, em aberto vira cancelado, e nada muda depois', async () => {
    const C = await cenario();
    const aberto = await ler((await lancar(C, { valor: 10000, vencimento: '2026-10-10', descricao: 'Ana — retorno' })).id);
    const pago = await ler((await lancar(C, { valor: 20000, pagoEm: '2026-10-11', forma: 'pix', descricao: 'Pacote' })).id);
    const cancelado = await lancar(C, { valor: 30000, descricao: null });
    await atualizar(C, cancelado.id, sql`cancelado_em = now(), motivo_cancelamento = 'Lançado em dobro'`);
    const canceladoAntes = await ler(cancelado.id);
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    const doOutro = await lancar(C, { paciente: outro });
    const anonimizar = (ctx: TenantContext, paciente = C.p) =>
      withTenant(ctx, async (tx) => {
        await tx.execute(sql`select app_anonimizar_financeiro(${paciente})`);
        return (await tx.execute(sql`select coalesce(current_setting('app.fin_anonimizando', true), '') as m`)).rows[0].m;
      }, app.db);

    await expect(anonimizar(C.ctx)).rejects.toSatisfy(doGatilho);
    await expect(anonimizar(worker(C))).rejects.toSatisfy(doGatilho); // ativo
    const hoje = sql`(now() at time zone 'America/Sao_Paulo')::date`;
    await bloquear(C, C.p, sql`${hoje} + 1`);
    await expect(anonimizar(worker(C))).rejects.toSatisfy(doGatilho); // prazo no futuro
    await em(worker(C), sql`update patients set anonimizar_apos = ${hoje} where id = ${C.p}`);
    await expect(anonimizar(worker(C))).rejects.toSatisfy(doGatilho); // vence hoje: só depois de hoje
    await em(worker(C), sql`update patients set anonimizar_apos = ${hoje} - 1 where id = ${C.p}`);
    await expect(anonimizar(publico(C))).rejects.toSatisfy(doGatilho);
    expect(await anonimizar(worker(C))).toBe(''); // o marcador desliga dentro da própria função

    const [a, p, c] = [await ler(aberto.id), await ler(pago.id), await ler(cancelado.id)];
    for (const x of [a, p, c]) {
      expect(x.descricao).toBeNull();
      expect(x.motivo_cancelamento).toBeNull();
      expect(x.anonimizado_em).not.toBeNull();
      expect(x.patient_id).toBe(C.p);
    }
    expect(a).toMatchObject({ cancelado_por: null, valor_centavos: 10000, vencimento: aberto.vencimento, pago_em: null, categoria_id: C.entrada });
    expect(a.cancelado_em).not.toBeNull();
    expect(p).toMatchObject({ cancelado_em: null, cancelado_por: null, valor_centavos: 20000, pago_em: pago.pago_em, forma_pagamento: 'pix' });
    expect(c).toMatchObject({ cancelado_por: C.nutriId, valor_centavos: 30000 });
    expect(c.cancelado_em).toEqual(canceladoAntes.cancelado_em); // o cancelamento anterior fica como estava
    expect((await ler(doOutro.id)).anonimizado_em).toBeNull(); // só o paciente pedido

    // depois de anonimizado, nada muda: nem a nutricionista, nem o worker, nem a função de novo
    await expect(atualizar(C, pago.id, sql`pago_em = null, forma_pagamento = null`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C, pago.id, sql`valor_centavos = 1`, worker(C))).rejects.toSatisfy(doGatilho);
    // a função de novo (paciente ainda bloqueado, antes do UPDATE de patients) não toca no que já foi anonimizado
    expect(await anonimizar(worker(C))).toBe('');
    expect((await ler(pago.id)).anonimizado_em).toEqual(p.anonimizado_em);
    // o marcador ligado à mão pela sessão nutri não abre o ramo da anonimização
    await expect(
      withTenant(C.ctx, async (tx) => {
        await tx.execute(sql`select set_config('app.fin_anonimizando', '1', true)`);
        await tx.execute(sql`update fin_lancamentos set anonimizado_em = now(), descricao = null where id = ${doOutro.id}`);
      }, app.db),
    ).rejects.toSatisfy(doGatilho);
  });

  it('o worker não altera lançamento fora da anonimização, nem com o marcador e o paciente ativo', async () => {
    const C = await cenario();
    const l = await lancar(C);
    await expect(atualizar(C, l.id, sql`pago_em = '2026-11-05', forma_pagamento = 'pix'`, worker(C))).rejects.toSatisfy(doGatilho);
    await expect(
      withTenant(worker(C), async (tx) => {
        await tx.execute(sql`select set_config('app.fin_anonimizando', '1', true)`);
        await tx.execute(sql`update fin_lancamentos set anonimizado_em = now(), descricao = null where id = ${l.id}`);
      }, app.db),
    ).rejects.toSatisfy(doGatilho);
  });

  it('uma cobrança ativa por consulta: a segunda viola o índice; depois de cancelar a primeira, a segunda entra', async () => {
    const C = await cenario();
    const a = await consulta(C);
    const primeira = await lancar(C, { consulta: a });
    await expect(lancar(C, { consulta: a })).rejects.toSatisfy((e) => comCodigo('23505')(e) && (e as { constraint?: string }).constraint === 'fin_lancamentos_consulta_ativa_unique');
    await atualizar(C, primeira.id, sql`cancelado_em = now(), motivo_cancelamento = 'Valor errado'`);
    expect((await lancar(C, { consulta: a })).appointment_id).toBe(a);
    // o ON CONFLICT … WHERE com o predicado em literais acha o índice (cobrança automática, RN-310 c)
    const conflito = await em(
      C.ctx,
      sql`insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, appointment_id, criado_por)
          values (${C.tenantId}, 'entrada', ${C.entrada}, 100, '2026-11-10', ${C.p}, ${a}, ${C.nutriId})
          on conflict (tenant_id, appointment_id) where appointment_id is not null and cancelado_em is null do nothing returning id`,
    );
    expect(conflito).toEqual([]);
  });

  it('"Consultas" (RN-303): arquivar → CHECK; DELETE → 42501; mudar chave ou tipo → 42501; renomear passa', async () => {
    const C = await cenario();
    const [k] = await em(C.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome, chave) values (${C.tenantId}, 'entrada', 'Consultas', 'consultas') returning id`);
    const upd = (set: SQL) => em(C.ctx, sql`update fin_categorias set ${set} where id = ${k.id} returning *`);
    await expect(upd(sql`arquivada_em = now()`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, sql`delete from fin_categorias where id = ${k.id}`)).rejects.toSatisfy(doGatilho);
    await expect(upd(sql`chave = null`)).rejects.toSatisfy(doGatilho);
    await expect(upd(sql`tipo = 'saida', chave = null`)).rejects.toSatisfy(doGatilho);
    expect((await upd(sql`nome = 'Consultas e retornos'`))[0].nome).toBe('Consultas e retornos');
    // tipo fixo também nas categorias comuns; nome único por tipo sem diferença de maiúsculas; categoria com lançamento não se apaga
    await expect(em(C.ctx, sql`update fin_categorias set tipo = 'saida' where id = ${C.entrada}`)).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome) values (${C.tenantId}, 'entrada', 'OUTRAS ENTRADAS')`)).rejects.toSatisfy(comCodigo('23505'));
    await expect(em(C.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome, chave) values (${C.tenantId}, 'saida', 'X', 'consultas')`)).rejects.toSatisfy(comCodigo('23514'));
    await lancar(C);
    await expect(em(C.ctx, sql`delete from fin_categorias where id = ${C.entrada}`)).rejects.toSatisfy(comCodigo('23503'));
    expect(await em(C.ctx, sql`delete from fin_categorias where id = ${C.saida} returning id`)).toHaveLength(1);
  });

  it('DELETE e TRUNCATE revogados em fin_lancamentos e fin_configuracoes', async () => {
    const C = await cenario();
    await em(C.ctx, sql`insert into fin_configuracoes (tenant_id, saldo_inicial_centavos, saldo_inicial_em) values (${C.tenantId}, 0, '2026-11-01')`);
    await lancar(C);
    for (const t of ['fin_lancamentos', 'fin_configuracoes']) {
      await expect(em(C.ctx, sql`delete from ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
      await expect(em(worker(C), sql`delete from ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
      await expect(em(C.ctx, sql`truncate ${sql.identifier(t)}`), t).rejects.toSatisfy(permissaoNegada);
    }
  });

  it('fin_configuracoes: uma linha por consultório e os limites do saldo e do valor da consulta', async () => {
    const C = await cenario();
    const ins = (saldo: number, em_: string, valor: number | null) =>
      em(C.ctx, sql`insert into fin_configuracoes (tenant_id, saldo_inicial_centavos, saldo_inicial_em, valor_consulta_centavos) values (${C.tenantId}, ${saldo}, ${em_}, ${valor})`);
    await expect(ins(1_000_000_001, '2026-11-01', null)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins(0, '1999-12-31', null)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins(0, '2026-11-01', 0)).rejects.toSatisfy(comCodigo('23514'));
    await ins(-1_000_000_000, '2026-11-01', 100_000_000);
    await expect(ins(0, '2026-11-01', null)).rejects.toSatisfy(comCodigo('23505'));
  });

  it('escrita vira audit_log (entidade financeiro): com o paciente, e sem paciente no lançamento sem paciente', async () => {
    const C = await cenario();
    const l = await lancar(C);
    await atualizar(C, l.id, sql`pago_em = '2026-11-05', forma_pagamento = 'dinheiro'`);
    const s = await lancar(C, { tipo: 'saida' });
    const { rows } = await owner.pool.query(
      `select acao, entidade_id, patient_id, actor_user_id from audit_log where tenant_id = $1 and entidade = 'financeiro' order by criado_em`,
      [C.tenantId],
    );
    expect(rows).toEqual([
      { acao: 'criar', entidade_id: l.id, patient_id: C.p, actor_user_id: C.nutriId },
      { acao: 'alterar', entidade_id: l.id, patient_id: C.p, actor_user_id: C.nutriId },
      { acao: 'criar', entidade_id: s.id, patient_id: null, actor_user_id: C.nutriId },
    ]);
  });
});
