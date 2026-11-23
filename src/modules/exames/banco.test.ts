import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 22 (spec §9, T1): as quatro tabelas do PR 1 no banco — RLS (staff_only), os gatilhos de autoria
 * exam_interpretacoes_regras e exam_versoes_regras, os CHECKs, os REVOKEs (só de inclusão), a cascata da exclusão do exame,
 * a política RESTRICTIVE paciente_exame_liberado em `exams` e os CHECKs de tipo de documento. Tudo por SQL cru, sem módulo:
 * é o que o banco garante sozinho. A prova da cascata como em produção (migrator sem superusuário) está em
 * src/db/migrate-owner.test.ts.
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
const naConta = (q: SQL) => withConta(randomUUID(), (tx) => tx.execute(q), app.db);

/**
 * Contexto montado à mão (sem withTenant): o paciente sem sessão de login (app.user_id vazio) e o contexto vazio (sem
 * app.role). O SQL é texto com parâmetros posicionais.
 */
async function comConfig(cfg: { tenantId: string; role?: string; patientId?: string }, texto: string, params: unknown[] = []): Promise<Row[]> {
  const c = await app.pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.patient_id', $3, true), set_config('app.user_id', '', true)`,
      [cfg.tenantId, cfg.role ?? '', cfg.patientId ?? ''],
    );
    return (await c.query(texto, params)).rows as Row[];
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; message?: string; constraint?: string }; message?: string; constraint?: string };
  return { code: x.code ?? x.cause?.code, message: x.cause?.message ?? x.message ?? '', constraint: x.constraint ?? x.cause?.constraint };
};
/** Recusa da RLS da própria tabela (WITH CHECK), nunca de outro motivo. */
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
/** 42501 do gatilho (mensagem própria), não da RLS nem da permissão. */
const doGatilho = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /nota\/versão do exame|nenhuma nota\/versão nova/.test(message) && !/row-level security|permission denied/.test(message);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
const comCodigo = (codigo: string) => (e: unknown) => erro(e).code === codigo;
const restricao = (nome: string) => (e: unknown) => erro(e).constraint === nome;

type Cenario = TenantDeTeste & { p: string };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  return { ...T, p: (await novoPaciente(app.db, T.ctx)).id };
}
const exame = async (C: Cenario, o: { paciente?: string; liberado?: boolean } = {}) =>
  (
    await em(
      C.ctx,
      sql`insert into exams (tenant_id, patient_id, data, titulo, valores, mostrar_no_app_em)
          values (${C.tenantId}, ${o.paciente ?? C.p}, '2026-11-01', 'Hemograma', '[{"nome":"Glicose","valor":90,"unidade":"mg/dL","referencia":"70 a 99"}]',
                  ${o.liberado ? sql`now()` : sql`null`})
          returning id, updated_at`,
    )
  )[0] as { id: string; updated_at: string };

type Nota = { exame: string; paciente?: string; versao?: number; texto?: string | null };
const inserirNota = (C: Cenario, n: Nota) =>
  sql`insert into exam_interpretacoes (tenant_id, patient_id, exam_id, versao, texto, criado_por, criado_em)
      values (${C.tenantId}, ${n.paciente ?? C.p}, ${n.exame}, ${n.versao ?? 1}, ${n.texto === undefined ? 'Glicose dentro da faixa do laudo.' : n.texto},
              ${randomUUID()}, '2001-01-01T00:00:00Z')
      returning *`;
type Versao = { exame: string; paciente?: string; versao?: number; justificativa?: string | null; titulo?: string; valores?: string };
const inserirVersao = (C: Cenario, v: Versao) =>
  sql`insert into exam_versoes (tenant_id, patient_id, exam_id, versao, titulo, data, valores, justificativa, alterado_por, alterado_em)
      values (${C.tenantId}, ${v.paciente ?? C.p}, ${v.exame}, ${v.versao ?? 1}, ${v.titulo ?? 'Hemograma'}, '2026-11-01', ${v.valores ?? '[]'}::jsonb,
              ${v.justificativa === undefined ? 'Valor digitado errado' : v.justificativa}, ${randomUUID()}, '2001-01-01T00:00:00Z')
      returning *`;

const bloquear = (C: Cenario, paciente: string) =>
  em(worker(C), sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${paciente}`);

describe('Plano 22 — catálogo, versões e nota do exame no banco (spec §9)', () => {
  it('bibliotecas: nutri cria e lê; paciente (com conta e sem login), publico e conta não leem nenhuma linha', async () => {
    const C = await cenario();
    await em(C.ctx, sql`insert into exames_catalogo (tenant_id, nome, unidade) values (${C.tenantId}, 'Glicose', 'mg/dL')`);
    await em(C.ctx, sql`insert into exames_modelos_solicitacao (tenant_id, nome, exames) values (${C.tenantId}, 'Rotina', '[{"nome":"Glicose"}]')`);
    const e = await exame(C, { liberado: true });
    await em(C.ctx, inserirNota(C, { exame: e.id }));
    await em(C.ctx, inserirVersao(C, { exame: e.id }));
    const tabelas = ['exames_catalogo', 'exames_modelos_solicitacao', 'exam_interpretacoes', 'exam_versoes'];
    for (const t of tabelas) {
      const ler = sql`select 1 from ${sql.identifier(t)}`;
      expect((await em(C.ctx, ler)).length, t).toBe(1);
      expect(await em(ctxPaciente(C.tenantId, C.p), ler), t).toEqual([]);
      expect(await comConfig({ tenantId: C.tenantId, role: 'paciente', patientId: C.p }, `select 1 from ${t}`), t).toEqual([]);
      expect(await em(publico(C), ler), t).toEqual([]);
      expect((await naConta(ler)).rows, t).toEqual([]);
    }
    // controle positivo do contexto montado à mão: o paciente sem login lê o próprio exame liberado
    expect(await comConfig({ tenantId: C.tenantId, role: 'paciente', patientId: C.p }, 'select id from exams')).toEqual([{ id: e.id }]);
  });

  it('CHECKs do catálogo: painel com unidade → 23514; faixas com unidade nula → 23514; sinonimos = {} (objeto) → 23514, nunca 22023; 11 outros nomes → 23514; nome repetido sem diferença de maiúsculas → 23505', async () => {
    const C = await cenario();
    const ins = (nome: string, campos: { unidade?: string | null; sinonimos?: string; componentes?: string; faixas?: string }) =>
      em(
        C.ctx,
        sql`insert into exames_catalogo (tenant_id, nome, unidade, sinonimos, componentes, faixas)
            values (${C.tenantId}, ${nome}, ${campos.unidade ?? null}, ${campos.sinonimos ?? '[]'}::jsonb, ${campos.componentes ?? '[]'}::jsonb, ${campos.faixas ?? '[]'}::jsonb)`,
      );
    const faixa = JSON.stringify([{ sexo: null, idadeMin: null, idadeMax: null, aPartirDe: 70, abaixoDe: 100, categoria: 'Dentro da faixa', fonte: 'SBD 2025', atualizadaEm: '2026-11-01' }]);
    await expect(ins('Lipidograma', { unidade: 'mg/dL', componentes: '["Colesterol total","HDL"]' })).rejects.toSatisfy(restricao('exames_catalogo_painel'));
    await expect(ins('Glicose', { unidade: null, faixas: faixa })).rejects.toSatisfy(restricao('exames_catalogo_faixa_com_unidade'));
    await expect(ins('Ureia', { unidade: 'mg/dL', sinonimos: '{}' })).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Ureia', { unidade: 'mg/dL', componentes: '{}' })).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Ureia', { unidade: 'mg/dL', faixas: '{}' })).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Ureia', { unidade: 'mg/dL', sinonimos: JSON.stringify(Array.from({ length: 11 }, (_, i) => `U${i}`)) })).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('', { unidade: 'mg/dL' })).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Ureia', { unidade: 'x'.repeat(21) })).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Lipidograma', { componentes: JSON.stringify(Array.from({ length: 31 }, (_, i) => `C${i}`)) })).rejects.toSatisfy(comCodigo('23514'));
    // os válidos passam: exame com faixa e unidade, painel sem unidade nem faixa, 10 outros nomes
    await ins('Glicose', { unidade: 'mg/dL', faixas: faixa, sinonimos: JSON.stringify(Array.from({ length: 10 }, (_, i) => `G${i}`)) });
    await ins('Lipidograma', { componentes: '["Colesterol total","HDL"]' });
    await expect(ins('GLICOSE', { unidade: 'mg/dL' })).rejects.toSatisfy((e) => comCodigo('23505')(e) && restricao('exames_catalogo_nome_unico')(e));
    // outro consultório pode ter o mesmo nome
    const D = await cenario();
    await em(D.ctx, sql`insert into exames_catalogo (tenant_id, nome, unidade) values (${D.tenantId}, 'Glicose', 'mg/dL')`);
  });

  it('CHECK do modelo de solicitação: 0 e 41 exames → 23514; nome repetido → 23505', async () => {
    const C = await cenario();
    const ins = (nome: string, exames: string) =>
      em(C.ctx, sql`insert into exames_modelos_solicitacao (tenant_id, nome, exames) values (${C.tenantId}, ${nome}, ${exames}::jsonb)`);
    await expect(ins('Vazio', '[]')).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Muitos', JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ nome: `E${i}` }))))).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Objeto', '{}')).rejects.toSatisfy(comCodigo('23514'));
    await ins('Quarenta', JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ nome: `E${i}` }))));
    await expect(ins('quarenta', '[{"nome":"Glicose"}]')).rejects.toSatisfy(comCodigo('23505'));
    await expect(
      em(C.ctx, sql`insert into exames_modelos_solicitacao (tenant_id, nome, exames, orientacoes) values (${C.tenantId}, 'Longo', '[{"nome":"Glicose"}]', ${'x'.repeat(1001)})`),
    ).rejects.toSatisfy(comCodigo('23514'));
  });

  it('nota: criado_por é a usuária da sessão e criado_em é do banco (o valor enviado é ignorado); texto vazio → 23514; texto nulo passa (apagar)', async () => {
    const C = await cenario();
    const e = await exame(C);
    const antes = Date.now();
    const [n] = await em(C.ctx, inserirNota(C, { exame: e.id }));
    expect(n.criado_por).toBe(C.nutriId);
    expect(new Date(n.criado_em as string).getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    await expect(em(C.ctx, inserirNota(C, { exame: e.id, versao: 2, texto: '' }))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, inserirNota(C, { exame: e.id, versao: 2, texto: 'x'.repeat(2001) }))).rejects.toSatisfy(comCodigo('23514'));
    const [apagada] = await em(C.ctx, inserirNota(C, { exame: e.id, versao: 2, texto: null }));
    expect(apagada).toMatchObject({ texto: null, criado_por: C.nutriId });
    await expect(em(C.ctx, inserirNota(C, { exame: e.id, versao: 0 }))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, inserirNota(C, { exame: e.id, versao: 2 }))).rejects.toSatisfy(comCodigo('23505'));
    // FK composta: o exame de outro paciente do mesmo consultório não serve
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    await expect(em(C.ctx, inserirNota(C, { exame: e.id, paciente: outro, versao: 3 }))).rejects.toSatisfy(comCodigo('23503'));
  });

  it('versão: alterado_por e alterado_em do banco; justificativa de 4 caracteres → 23514; nula passa; versao 0 → 23514; (exam_id, versao) repetido → 23505', async () => {
    const C = await cenario();
    const e = await exame(C);
    const antes = Date.now();
    const [v] = await em(C.ctx, inserirVersao(C, { exame: e.id }));
    expect(v.alterado_por).toBe(C.nutriId);
    expect(new Date(v.alterado_em as string).getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id, versao: 2, justificativa: 'abcd' }))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id, versao: 2, justificativa: 'x'.repeat(501) }))).rejects.toSatisfy(comCodigo('23514'));
    expect((await em(C.ctx, inserirVersao(C, { exame: e.id, versao: 2, justificativa: null })))[0].justificativa).toBeNull();
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id, versao: 0 }))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id, versao: 2 }))).rejects.toSatisfy(comCodigo('23505'));
  });

  it('versão: título de 0 ou 121 caracteres → 23514 (exam_versoes_titulo_tamanho); valores objeto, texto ou número → 23514 (exam_versoes_valores), nunca 22023', async () => {
    const C = await cenario();
    const e = await exame(C);
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id, titulo: '' }))).rejects.toSatisfy((x) => comCodigo('23514')(x) && restricao('exam_versoes_titulo_tamanho')(x));
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id, titulo: 'x'.repeat(121) }))).rejects.toSatisfy((x) => comCodigo('23514')(x) && restricao('exam_versoes_titulo_tamanho')(x));
    for (const valores of ['{}', '"texto"', '1', 'null']) {
      await expect(em(C.ctx, inserirVersao(C, { exame: e.id, valores })), valores).rejects.toSatisfy((x) => comCodigo('23514')(x) && restricao('exam_versoes_valores')(x));
    }
    // os limites passam: título de 1 e de 120 caracteres, valores com linhas
    await em(C.ctx, inserirVersao(C, { exame: e.id, titulo: 'x' }));
    await em(C.ctx, inserirVersao(C, { exame: e.id, versao: 2, titulo: 'x'.repeat(120), valores: '[{"nome":"Glicose","valor":90,"unidade":"mg/dL","referencia":null}]' }));
  });

  it('nota e versão na sessão de paciente, publico e conta: INSERT recusado pela RLS da própria tabela (o exame já existe — fora de COM_MAE)', async () => {
    const C = await cenario();
    const e = await exame(C, { liberado: true });
    const P = ctxPaciente(C.tenantId, C.p);
    await expect(em(P, inserirNota(C, { exame: e.id }))).rejects.toSatisfy(rlsDe('exam_interpretacoes'));
    await expect(em(P, inserirVersao(C, { exame: e.id }))).rejects.toSatisfy(rlsDe('exam_versoes'));
    await expect(em(publico(C), inserirNota(C, { exame: e.id }))).rejects.toSatisfy(rlsDe('exam_interpretacoes'));
    await expect(em(publico(C), inserirVersao(C, { exame: e.id }))).rejects.toSatisfy(rlsDe('exam_versoes'));
    await expect(naConta(inserirNota(C, { exame: e.id }))).rejects.toSatisfy(rlsDe('exam_interpretacoes'));
    await expect(naConta(inserirVersao(C, { exame: e.id }))).rejects.toSatisfy(rlsDe('exam_versoes'));
    // as bibliotecas também
    await expect(em(P, sql`insert into exames_catalogo (tenant_id, nome) values (${C.tenantId}, 'X')`)).rejects.toSatisfy(rlsDe('exames_catalogo'));
    await expect(em(P, sql`insert into exames_modelos_solicitacao (tenant_id, nome, exames) values (${C.tenantId}, 'X', '[{"nome":"X"}]')`)).rejects.toSatisfy(
      rlsDe('exames_modelos_solicitacao'),
    );
    const n = await owner.pool.query('select (select count(*) from exam_interpretacoes where exam_id = $1)::int + (select count(*) from exam_versoes where exam_id = $1)::int as n', [e.id]);
    expect(n.rows[0].n).toBe(0);
  });

  it('worker: INSERT de nota e de versão recusado com 42501 do gatilho, mesmo enviando criado_por/alterado_por', async () => {
    const C = await cenario();
    const e = await exame(C);
    await expect(em(worker(C), inserirNota(C, { exame: e.id }))).rejects.toSatisfy(doGatilho);
    await expect(em(worker(C), inserirVersao(C, { exame: e.id }))).rejects.toSatisfy(doGatilho);
    // controle positivo: o mesmo INSERT pela nutri passa
    expect(await em(C.ctx, inserirNota(C, { exame: e.id }))).toHaveLength(1);
  });

  it('contexto vazio (sem app.role): INSERT de nota e de versão recusado com 42501 do gatilho', async () => {
    const C = await cenario();
    const e = await exame(C);
    const autor = randomUUID();
    await expect(
      comConfig({ tenantId: C.tenantId }, `insert into exam_interpretacoes (tenant_id, patient_id, exam_id, versao, texto, criado_por) values ($1, $2, $3, 1, 'x', $4)`, [
        C.tenantId,
        C.p,
        e.id,
        autor,
      ]),
    ).rejects.toSatisfy(doGatilho);
    await expect(
      comConfig(
        { tenantId: C.tenantId },
        `insert into exam_versoes (tenant_id, patient_id, exam_id, versao, titulo, data, valores, alterado_por) values ($1, $2, $3, 1, 'Hemograma', '2026-11-01', '[]', $4)`,
        [C.tenantId, C.p, e.id, autor],
      ),
    ).rejects.toSatisfy(doGatilho);
  });

  it('nutri com paciente bloqueado ou anonimizado: INSERT direto de nota e de versão → 42501 do gatilho', async () => {
    const C = await cenario();
    const e = await exame(C);
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    const e2 = await exame(C, { paciente: outro });
    await bloquear(C, C.p);
    await expect(em(C.ctx, inserirNota(C, { exame: e.id }))).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, inserirVersao(C, { exame: e.id }))).rejects.toSatisfy(doGatilho);
    await owner.pool.query(`update patients set anonimizado_em = now() where id = $1`, [outro]);
    await expect(em(C.ctx, inserirNota(C, { exame: e2.id, paciente: outro }))).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, inserirVersao(C, { exame: e2.id, paciente: outro }))).rejects.toSatisfy(doGatilho);
  });

  it('só de inclusão: UPDATE, DELETE e TRUNCATE pela nutri em exam_interpretacoes e exam_versoes → 42501', async () => {
    const C = await cenario();
    const e = await exame(C);
    await em(C.ctx, inserirNota(C, { exame: e.id }));
    await em(C.ctx, inserirVersao(C, { exame: e.id }));
    for (const t of ['exam_interpretacoes', 'exam_versoes']) {
      const id = sql.identifier(t);
      await expect(em(C.ctx, sql`update ${id} set versao = versao`), t).rejects.toSatisfy(permissaoNegada);
      await expect(em(C.ctx, sql`delete from ${id}`), t).rejects.toSatisfy(permissaoNegada);
      await expect(em(C.ctx, sql`truncate ${id}`), t).rejects.toSatisfy(permissaoNegada);
      await expect(em(worker(C), sql`delete from ${id}`), t).rejects.toSatisfy(permissaoNegada);
    }
  });

  it('cascata: excluir o exame (DELETE de exams pela nutri) leva as notas e as versões', async () => {
    const C = await cenario();
    const e = await exame(C);
    const fica = await exame(C);
    for (const x of [e, fica]) {
      await em(C.ctx, inserirNota(C, { exame: x.id }));
      await em(C.ctx, inserirVersao(C, { exame: x.id }));
    }
    expect(await em(C.ctx, sql`delete from exams where id = ${e.id} returning id`)).toHaveLength(1);
    const contar = async (exameId: string) =>
      (await owner.pool.query('select (select count(*) from exam_interpretacoes where exam_id = $1)::int as n, (select count(*) from exam_versoes where exam_id = $1)::int as v', [exameId]))
        .rows[0];
    expect(await contar(e.id)).toEqual({ n: 0, v: 0 });
    expect(await contar(fica.id)).toEqual({ n: 1, v: 1 });
  });

  it('paciente_exame_liberado: RESTRICTIVE, FOR SELECT, cita mostrar_no_app_em; P2 com login lê o liberado e não o não liberado; a nutri lê os dois', async () => {
    const { rows } = await owner.pool.query(
      `select permissive, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'exams' and policyname = 'paciente_exame_liberado'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ permissive: 'RESTRICTIVE', cmd: 'SELECT' });
    expect(rows[0].qual).toMatch(/mostrar_no_app_em/);

    const C = await cenario();
    const liberado = await exame(C, { liberado: true });
    const naoLiberado = await exame(C);
    const ids = (r: Row[]) => r.map((x) => x.id).sort();
    expect(ids(await em(ctxPaciente(C.tenantId, C.p), sql`select id from exams`))).toEqual([liberado.id]);
    expect(ids(await em(C.ctx, sql`select id from exams`))).toEqual([liberado.id, naoLiberado.id].sort());
    // retirar do app volta a esconder
    await em(C.ctx, sql`update exams set mostrar_no_app_em = null where id = ${liberado.id}`);
    expect(await em(ctxPaciente(C.tenantId, C.p), sql`select id from exams`)).toEqual([]);
  });

  it('exams.mostrar_no_app_em: UPDATE só dessa coluna não muda updated_at', async () => {
    const C = await cenario();
    const e = await exame(C);
    const ler = async () => (await owner.pool.query('select updated_at, mostrar_no_app_em from exams where id = $1', [e.id])).rows[0];
    const antes = await ler();
    expect(antes.mostrar_no_app_em).toBeNull();
    await em(C.ctx, sql`update exams set mostrar_no_app_em = now() where id = ${e.id}`);
    const depois = await ler();
    expect(depois.mostrar_no_app_em).not.toBeNull();
    expect(depois.updated_at).toEqual(antes.updated_at);
  });

  it('escrita vira audit_log: INSERT de nota → criar/exames_nota com o patient_id; INSERT de versão → criar/exames_versoes', async () => {
    const C = await cenario();
    const e = await exame(C);
    const [n] = await em(C.ctx, inserirNota(C, { exame: e.id }));
    const [v] = await em(C.ctx, inserirVersao(C, { exame: e.id }));
    const rows = await em(
      C.ctx,
      sql`select acao, entidade, entidade_id, patient_id, actor_user_id from audit_log
          where tenant_id = ${C.tenantId} and entidade in ('exames_nota', 'exames_versoes') order by criado_em`,
    );
    expect(rows).toEqual([
      { acao: 'criar', entidade: 'exames_nota', entidade_id: n.id, patient_id: C.p, actor_user_id: C.nutriId },
      { acao: 'criar', entidade: 'exames_versoes', entidade_id: v.id, patient_id: C.p, actor_user_id: C.nutriId },
    ]);
    // a cascata da exclusão do exame grava um "excluir" por linha filha
    await em(C.ctx, sql`delete from exams where id = ${e.id}`);
    const excluidos = await em(
      C.ctx,
      sql`select entidade, entidade_id from audit_log where tenant_id = ${C.tenantId} and acao = 'excluir' and entidade in ('exames_nota', 'exames_versoes') order by entidade`,
    );
    expect(excluidos).toEqual([
      { entidade: 'exames_nota', entidade_id: n.id },
      { entidade: 'exames_versoes', entidade_id: v.id },
    ]);
  });

  it("CHECKs de tipo: signed_documents e document_verifications aceitam 'solicitacao_exames' e recusam 'outro'", async () => {
    const C = await cenario();
    const doc = (tipo: string) => em(C.ctx, sql`insert into signed_documents (tenant_id, patient_id, tipo) values (${C.tenantId}, ${C.p}, ${tipo}) returning tipo`);
    expect((await doc('solicitacao_exames'))[0].tipo).toBe('solicitacao_exames');
    await expect(doc('outro')).rejects.toSatisfy(restricao('signed_documents_tipo_valido'));

    const verificacao = async (tipo: string) => {
      const d = await documentoNoBanco(app.db, C.ctx, C.p, { status: 'assinado' });
      return app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
        values (${d.codigo}, ${C.tenantId}, ${d.id}, ${tipo}, now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    };
    await verificacao('solicitacao_exames');
    await expect(verificacao('outro')).rejects.toSatisfy(restricao('document_verifications_tipo_valido'));
  });
});
