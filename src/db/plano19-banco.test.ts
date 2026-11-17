import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../test/pacientes';
import { liberarReceitasDoPlano } from '@/modules/conteudo/audiencia';
import { withTenant, type TenantContext } from './tenant';

// Plano 19, Tarefa 1 (P19-01): fundação do banco — fontes de `foods`, dias da semana, biblioteca do consultório
// (staff_only), ligações ao plano (paciente_sem_rascunho, auditadas) e a RN-12 ampliada (RN-253).
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const violaCheck = (nome: string) => (e: unknown) => causa(e).code === '23514' && causa(e).constraint === nome;
const violaFk = (nome: string) => (e: unknown) => causa(e).code === '23503' && causa(e).constraint === nome;
const negado = (e: unknown) => causa(e).code === '42501';
const violaRls = (e: unknown) => negado(e) && /row-level security/.test(String(causa(e).message));
const semConta = (tenantId: string, patientId: string): TenantContext => ({ tenantId, role: 'paciente', patientId, semConta: true });
const TACO_ARROZ = '00000000-0000-4000-8000-000000000003';

const BIBLIOTECA = [
  'referencias_nutrientes',
  'refeicoes_modelo',
  'refeicoes_modelo_itens',
  'listas_substituicao',
  'listas_substituicao_grupos',
  'listas_substituicao_itens',
] as const;

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const q = (s: SQL, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, p, q };
}

const novoPlano = async (q: (s: SQL) => Promise<{ rows: Record<string, unknown>[] }>, T: TenantDeTeste, patientId: string, status: string) =>
  (await q(sql`insert into meal_plans (tenant_id, patient_id, titulo, status) values (${T.tenantId}, ${patientId}, 'P19', ${status}) returning id`))
    .rows[0].id as string;

const ligarLista = (T: TenantDeTeste, patientId: string, planId: string, conteudo: unknown = { grupos: [] }) =>
  sql`insert into plano_listas_substituicao (tenant_id, patient_id, plan_id, nome, conteudo, ordem)
      values (${T.tenantId}, ${patientId}, ${planId}, 'Trocas', ${JSON.stringify(conteudo)}::jsonb, 0) returning id`;
const ligarConteudo = (T: TenantDeTeste, patientId: string, planId: string, contentId: string | null) =>
  sql`insert into plano_conteudos (tenant_id, patient_id, plan_id, content_id, titulo, ordem)
      values (${T.tenantId}, ${patientId}, ${planId}, ${contentId}, 'Material', 0) returning id`;

/** Uma linha em cada tabela da biblioteca, como a nutricionista. */
async function bibliotecaCheia(q: (s: SQL) => Promise<unknown>, T: TenantDeTeste) {
  const t = T.tenantId;
  await q(sql`insert into referencias_nutrientes (tenant_id, nome, fonte, valores)
              values (${t}, ${`Perfil ${randomUUID().slice(0, 6)}`}, 'DRI 2019', '{"calcioMg":{"meta":1000,"maximo":2500}}')`);
  await q(sql`with r as (insert into refeicoes_modelo (tenant_id, nome, tipo) values (${t}, 'Almoço leve', 'Almoço') returning id)
              insert into refeicoes_modelo_itens (tenant_id, refeicao_id, food_id, quantidade_g, ordem) select ${t}, r.id, ${TACO_ARROZ}, 100, 0 from r`);
  await q(sql`with l as (insert into listas_substituicao (tenant_id, nome) values (${t}, ${`Lista ${randomUUID().slice(0, 6)}`}) returning id),
                   g as (insert into listas_substituicao_grupos (tenant_id, lista_id, nome, ordem) select ${t}, l.id, 'Cereais', 0 from l returning lista_id, id)
              insert into listas_substituicao_itens (tenant_id, lista_id, grupo_id, food_id, quantidade_g, ordem) select ${t}, g.lista_id, g.id, ${TACO_ARROZ}, 100, 0 from g`);
}

describe('Plano 19 — foods: fonte, fonte_ref e nome_original (RN-230, I-2)', () => {
  it('foods sem fonte continua válido: o INSERT da imagem antiga grava "propria"', async () => {
    const { T, q } = await cenario();
    const [r] = (await q(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
      values (${T.tenantId}, 'Pão da casa', 'Cereais e derivados', 250, 8, 50, 2, 3) returning fonte, fonte_ref, nome_original`)).rows;
    expect(r).toEqual({ fonte: 'propria', fonte_ref: null, nome_original: null });
  });

  it('CHECK de origem: fonte pública com tenant, "propria" com fonte_ref e taco_id fora da TACO são recusados; kcal até 1000', async () => {
    const { T, q } = await cenario();
    /** "Meu alimento" completo, pela sessão nutri, com as colunas extras `cols` = `vals`. */
    const proprio = (cols: SQL, vals: SQL, kcal = 100) =>
      q(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g, ${cols})
            values (${T.tenantId}, 'Iso', 'Miscelâneas', ${kcal}, 1, 1, 1, 1, ${vals})`);
    await expect(proprio(sql`fonte, fonte_ref`, sql`'usda', '170567'`)).rejects.toSatisfy(violaCheck('foods_origem_valida'));
    await expect(proprio(sql`fonte, fonte_ref`, sql`'propria', 'x'`)).rejects.toSatisfy(violaCheck('foods_origem_valida'));
    await expect(proprio(sql`fonte, taco_id`, sql`'propria', 9998`)).rejects.toSatisfy(violaCheck('foods_origem_valida'));
    await expect(proprio(sql`fonte, nome_original`, sql`'propria', 'Bread'`)).rejects.toSatisfy(violaCheck('foods_nome_original_valido'));
    await proprio(sql`fonte`, sql`'propria'`, 950);
    await expect(proprio(sql`fonte`, sql`'propria'`, 1001)).rejects.toSatisfy(violaCheck('foods_valores_faixa'));
    // fonte fora da lista e fonte_ref fora do tamanho (linha pública, só pelo dono do banco: o app não escreve tenant_id nulo)
    const publica = (fonte: string, ref: string) =>
      owner.pool.query(`insert into foods (nome, grupo, kcal, fonte, fonte_ref) values ('Iso', 'Miscelâneas', 100, $1, $2)`, [fonte, ref]);
    await expect(publica('ibge', '1')).rejects.toSatisfy(violaCheck('foods_fonte_valida'));
    await expect(publica('tbca', 'x'.repeat(41))).rejects.toSatisfy(violaCheck('foods_fonte_ref_tamanho'));
    await expect(publica('tbca', '')).rejects.toSatisfy(violaCheck('foods_fonte_ref_tamanho'));
  });

  it('a migration rotulou a TACO: fonte "taco" e fonte_ref = taco_id em todas as linhas públicas; nenhuma USDA/TBCA', async () => {
    const { rows } = await owner.pool.query(
      `select fonte, count(*)::int as n, count(*) filter (where fonte_ref = taco_id::text)::int as ref_ok
         from foods where tenant_id is null and fonte_ref not like 'teste-%' group by fonte`, // REF_DE_TESTE (test/alimentos-publicos.ts): linhas de outros arquivos
    );
    expect(rows).toEqual([{ fonte: 'taco', n: 597, ref_ok: 597 }]);
  });

  it('nenhuma política de escrita em tenant_id nulo: a nutricionista não cria, não altera e não apaga linha pública', async () => {
    const { q } = await cenario();
    await expect(
      q(sql`insert into foods (tenant_id, nome, grupo, kcal, fonte, fonte_ref, nome_original)
            values (null, 'Falso', 'Miscelâneas', 100, 'usda', '999999', 'Fake')`),
    ).rejects.toSatisfy(violaRls);
    expect((await q(sql`update foods set nome = 'x' where taco_id = 3`)).rowCount).toBe(0);
    expect((await q(sql`delete from foods where taco_id = 3`)).rowCount).toBe(0);
    expect((await q(sql`update foods set fonte = 'usda', fonte_ref = '1' where tenant_id is null`)).rowCount).toBe(0);
    const { rows } = await owner.pool.query(`select policyname from pg_policies where schemaname = 'public' and tablename = 'foods' order by 1`);
    expect(rows.map((r) => r.policyname)).toEqual([
      'paciente_sem_delete',
      'paciente_sem_insert',
      'paciente_sem_update',
      'publico_negado',
      'taco_leitura',
      'tenant_isolation',
    ]);
  });
});

describe('Plano 19 — meals.dias_semana e meal_plans (RN-238, RN-243, RN-246)', () => {
  it('dias_semana: {1,2,3,4,5} passa; vazio, fora de 0–6, fora de ordem, repetido e com nulo são recusados', async () => {
    const { T, p, q } = await cenario();
    const plano = await novoPlano(q, T, p.id, 'rascunho');
    const refeicao = (dias: SQL) =>
      q(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem, dias_semana)
            values (${randomUUID()}, ${T.tenantId}, ${p.id}, ${plano}, 'Almoço', 0, ${dias}) returning dias_semana`);
    expect((await refeicao(sql`'{1,2,3,4,5}'::smallint[]`)).rows[0].dias_semana).toEqual([1, 2, 3, 4, 5]);
    for (const ruim of ['{}', '{7}', '{3,1}', '{1,1}', '{1,NULL}', '{-1}', '{0,1,2,3,4,5,6,6}']) {
      await expect(refeicao(sql`${ruim}::smallint[]`), ruim).rejects.toSatisfy(violaCheck('meals_dias_validos'));
    }
    const [padrao] = (await q(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem)
      values (${randomUUID()}, ${T.tenantId}, ${p.id}, ${plano}, 'Jantar', 1) returning dias_semana, descricao_livre`)).rows;
    expect(padrao).toEqual({ dias_semana: [0, 1, 2, 3, 4, 5, 6], descricao_livre: null });
    await expect(
      q(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem, descricao_livre)
            values (${randomUUID()}, ${T.tenantId}, ${p.id}, ${plano}, 'Ceia', 2, ${'x'.repeat(2001)})`),
    ).rejects.toSatisfy(violaCheck('meals_descricao_livre_tamanho'));
  });

  it('meal_plans: padrões das colunas novas e CHECKs de modo, nutrientes, referência congelada e macros', async () => {
    const { T, p, q } = await cenario();
    const plano = await novoPlano(q, T, p.id, 'rascunho');
    const [r] = (await q(sql`select modo, referencia_id, nutrientes_exibidos, referencia_congelada, macros_prescritos, mostrar_micros_pdf
      from meal_plans where id = ${plano}`)).rows;
    expect(r).toEqual({
      modo: 'calculado',
      referencia_id: null,
      nutrientes_exibidos: [],
      referencia_congelada: null,
      macros_prescritos: null,
      mostrar_micros_pdf: false,
    });
    const muda = (s: SQL) => q(sql`update meal_plans set ${s} where id = ${plano}`);
    await expect(muda(sql`modo = 'misto'`)).rejects.toSatisfy(violaCheck('meal_plans_modo_valido'));
    await expect(muda(sql`nutrientes_exibidos = ${`{${Array.from({ length: 13 }, (_, i) => `n${i}`).join(',')}}`}::text[]`)).rejects.toSatisfy(
      violaCheck('meal_plans_nutrientes_exibidos_limite'),
    );
    await expect(muda(sql`referencia_congelada = '{"nome":"x"}'::jsonb`)).rejects.toSatisfy(violaCheck('meal_plans_referencia_congelada_publicada'));
    await expect(muda(sql`macros_prescritos = '{"proteina":20}'::jsonb`)).rejects.toSatisfy(violaCheck('meal_plans_macros_so_livre'));
    await muda(sql`modo = 'livre', macros_prescritos = '{"proteina":20,"carboidrato":50,"lipidio":30}'::jsonb`);
  });

  it('referencia_id só no rascunho: publicar com perfil é recusado; excluir o perfil anula o rascunho e não toca o publicado', async () => {
    const { T, p, q } = await cenario();
    const p2 = await novoPaciente(app.db, T.ctx);
    const ref = (await q(sql`insert into referencias_nutrientes (tenant_id, nome, fonte, valores)
      values (${T.tenantId}, 'Gestante', 'DRI 2019', '{"ferroMg":{"meta":27}}') returning id`)).rows[0].id as string;
    const rascunho = await novoPlano(q, T, p.id, 'rascunho');
    await q(sql`update meal_plans set referencia_id = ${ref} where id = ${rascunho}`);
    await expect(q(sql`update meal_plans set status = 'publicado' where id = ${rascunho}`)).rejects.toSatisfy(
      violaCheck('meal_plans_referencia_so_rascunho'),
    );
    // o publicado guarda a cópia (com o id do perfil) e nunca o ponteiro
    const publicado = await novoPlano(q, T, p2.id, 'publicado');
    const copia = { id: ref, nome: 'Gestante', fonte: 'DRI 2019', valores: { ferroMg: { meta: 27 } } };
    await q(sql`update meal_plans set referencia_congelada = ${JSON.stringify(copia)}::jsonb where id = ${publicado}`);
    await expect(q(sql`update meal_plans set referencia_id = ${ref} where id = ${publicado}`)).rejects.toSatisfy(
      violaCheck('meal_plans_referencia_so_rascunho'),
    );
    const auditoriaDo = async (planId: string) =>
      Number((await owner.pool.query(`select count(*)::int as n from audit_log where entidade_id = $1`, [planId])).rows[0].n);
    const antes = await auditoriaDo(publicado);
    await q(sql`delete from referencias_nutrientes where id = ${ref}`);
    const { rows } = await owner.pool.query(`select id, referencia_id, referencia_congelada from meal_plans where id = any($1)`, [[rascunho, publicado]]);
    expect(rows.find((r) => r.id === rascunho)?.referencia_id).toBeNull();
    expect(rows.find((r) => r.id === publicado)?.referencia_congelada).toEqual(copia);
    expect(await auditoriaDo(publicado)).toBe(antes);
  });

  it('a FK do perfil é composta: o rascunho não aponta para o perfil de outro consultório', async () => {
    const A = await cenario();
    const B = await cenario();
    const refB = (await B.q(sql`insert into referencias_nutrientes (tenant_id, nome, fonte, valores)
      values (${B.T.tenantId}, 'De B', 'DRI 2019', '{}') returning id`)).rows[0].id as string;
    const plano = await novoPlano(A.q, A.T, A.p.id, 'rascunho');
    await expect(A.q(sql`update meal_plans set referencia_id = ${refB} where id = ${plano}`)).rejects.toSatisfy(violaFk('meal_plans_referencia_fk'));
  });
});

describe('Plano 19 — biblioteca do consultório (staff_only, sem auditoria)', () => {
  it('staff_only da biblioteca: a sessão de paciente (com conta e semConta) lê zero linhas das seis tabelas', async () => {
    const { T, p, q } = await cenario();
    await bibliotecaCheia(q, T);
    for (const t of BIBLIOTECA) {
      expect((await q(sql`select 1 from ${sql.identifier(t)}`)).rows.length, t).toBeGreaterThan(0);
      for (const ctx of [ctxPaciente(T.tenantId, p.id), semConta(T.tenantId, p.id)]) {
        expect((await q(sql`select 1 from ${sql.identifier(t)}`, ctx)).rows, t).toEqual([]);
      }
    }
  });

  it('itens da biblioteca: alimento em uso não é excluído (RESTRICT) e a mãe leva os filhos (cascade)', async () => {
    const { T, q } = await cenario();
    const food = (await q(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
      values (${T.tenantId}, 'Meu pão', 'Cereais e derivados', 250, 8, 50, 2, 3) returning id`)).rows[0].id as string;
    const lista = (await q(sql`insert into listas_substituicao (tenant_id, nome) values (${T.tenantId}, 'Pães') returning id`)).rows[0].id as string;
    const grupo = (await q(sql`insert into listas_substituicao_grupos (tenant_id, lista_id, nome, ordem) values (${T.tenantId}, ${lista}, 'Pães', 0) returning id`))
      .rows[0].id as string;
    await q(sql`insert into listas_substituicao_itens (tenant_id, lista_id, grupo_id, food_id, quantidade_g, ordem) values (${T.tenantId}, ${lista}, ${grupo}, ${food}, 50, 0)`);
    const refeicao = (await q(sql`insert into refeicoes_modelo (tenant_id, nome, tipo) values (${T.tenantId}, 'Lanche', 'Lanche da tarde') returning id`)).rows[0]
      .id as string;
    await q(sql`insert into refeicoes_modelo_itens (tenant_id, refeicao_id, food_id, quantidade_g, ordem) values (${T.tenantId}, ${refeicao}, ${food}, 50, 0)`);
    await expect(q(sql`delete from foods where id = ${food}`)).rejects.toSatisfy((e: unknown) => causa(e).code === '23503');
    await q(sql`delete from listas_substituicao where id = ${lista}`);
    await q(sql`delete from refeicoes_modelo where id = ${refeicao}`);
    expect((await q(sql`select 1 from listas_substituicao_itens union all select 1 from refeicoes_modelo_itens`)).rows).toEqual([]);
    await q(sql`delete from foods where id = ${food}`);
    await expect(q(sql`insert into refeicoes_modelo (tenant_id, nome, tipo) values (${T.tenantId}, 'X', 'Brunch')`)).rejects.toSatisfy(
      violaCheck('refeicoes_modelo_tipo_valido'),
    );
  });

  it('auditoria: as ligações ao plano gravam audit_log (plano_alimentar); a biblioteca, nenhum', async () => {
    const { T, p, q } = await cenario();
    const contar = async () =>
      Number((await owner.pool.query(`select count(*)::int as n from audit_log where tenant_id = $1`, [T.tenantId])).rows[0].n);
    const antes = await contar();
    await bibliotecaCheia(q, T);
    expect(await contar()).toBe(antes);
    const plano = await novoPlano(q, T, p.id, 'rascunho');
    const lista = (await q(ligarLista(T, p.id, plano))).rows[0].id as string;
    const ligacao = (await q(ligarConteudo(T, p.id, plano, null))).rows[0].id as string;
    const { rows } = await owner.pool.query(
      `select entidade, acao, patient_id from audit_log where tenant_id = $1 and entidade_id = any($2) order by entidade_id`,
      [T.tenantId, [lista, ligacao]],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toEqual({ entidade: 'plano_alimentar', acao: 'criar', patient_id: p.id });
    const { rows: gatilhos } = await owner.pool.query(
      `select tgrelid::regclass::text as t from pg_trigger where tgname = 'audit_row_change' and tgrelid::regclass::text = any($1)`,
      [[...BIBLIOTECA]],
    );
    expect(gatilhos).toEqual([]);
  });
});

describe('Plano 19 — ligações ao plano (paciente_sem_rascunho, RN-252, RN-253)', () => {
  it('ligado ao rascunho não vaza: o paciente lê 0 do rascunho e 1 do publicado', async () => {
    const { T, p, q } = await cenario();
    const plano = await novoPlano(q, T, p.id, 'rascunho');
    await q(ligarLista(T, p.id, plano));
    await q(ligarConteudo(T, p.id, plano, null));
    const vistas = async () => {
      const ctx = ctxPaciente(T.tenantId, p.id);
      return [
        (await q(sql`select 1 from plano_listas_substituicao`, ctx)).rows.length,
        (await q(sql`select 1 from plano_conteudos`, ctx)).rows.length,
      ];
    };
    expect(await vistas()).toEqual([0, 0]);
    await q(sql`update meal_plans set status = 'publicado' where id = ${plano}`);
    expect(await vistas()).toEqual([1, 1]);
  });

  it('ligação só no próprio plano: outro consultório e outro paciente são recusados', async () => {
    const A = await cenario();
    const B = await cenario();
    const planoA = await novoPlano(A.q, A.T, A.p.id, 'rascunho');
    // B com o tenant de A: a RLS recusa
    await expect(B.q(ligarLista(A.T, A.p.id, planoA))).rejects.toSatisfy(violaRls);
    await expect(B.q(ligarConteudo(A.T, A.p.id, planoA, null))).rejects.toSatisfy(violaRls);
    // B com o próprio tenant e o plano de A: a FK composta (tenant_id, plan_id) recusa
    await expect(B.q(ligarLista(B.T, A.p.id, planoA))).rejects.toSatisfy((e: unknown) => causa(e).code === '23503');
    await expect(B.q(ligarConteudo(B.T, A.p.id, planoA, null))).rejects.toSatisfy((e: unknown) => causa(e).code === '23503');
    // mesmo tenant, outro paciente: a FK (tenant_id, plan_id, patient_id) recusa
    const outro = await novoPaciente(app.db, A.T.ctx);
    await expect(A.q(ligarLista(A.T, outro.id, planoA))).rejects.toSatisfy(violaFk('plano_listas_substituicao_plano_paciente_fk'));
    await expect(A.q(ligarConteudo(A.T, outro.id, planoA, null))).rejects.toSatisfy(violaFk('plano_conteudos_plano_paciente_fk'));
    // conteúdo de outro consultório: a FK composta (tenant_id, content_id) recusa
    const deB = (await B.q(sql`insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${B.T.tenantId}, 'orientacao', 'De B', 'publicado', now()) returning id`))
      .rows[0].id as string;
    await expect(A.q(ligarConteudo(A.T, A.p.id, planoA, deB))).rejects.toSatisfy(violaFk('plano_conteudos_conteudo_fk'));
  });

  it('lista cheia cabe: 20 grupos × 30 itens com nomes de 120 caracteres acentuados gravam; acima de 512 KB, não', async () => {
    const { T, p, q } = await cenario();
    const plano = await novoPlano(q, T, p.id, 'rascunho');
    const nome = 'Pão de açúcar, maçã, feijão e côco ralado — preparação caseira'.padEnd(120, 'ç').slice(0, 120);
    const item = () => ({
      id: randomUUID(),
      foodId: randomUUID(),
      nome,
      gramas: 4999.99,
      medida: { nome: 'colheres de sopa cheias (picado à mão)'.padEnd(60, 'á'), plural: 'colheres de sopa cheias (picado à mão)'.padEnd(60, 'á'), gramas: 4999.99, qtd: 999.5 },
      medidaTexto: '999 ½ colheres de sopa cheias (picado à mão)'.padEnd(80, 'é'),
      fonte: 'propria',
      fonteOrigem: 'usda',
      kcal: 999.99,
      proteinaG: 99.99,
      carboidratoG: 99.99,
      lipidioG: 99.99,
      fibraG: 99.99,
    });
    const cheia = {
      grupos: Array.from({ length: 20 }, () => ({ id: randomUUID(), nome: 'Grupo de substituição'.padEnd(60, 'ã'), itens: Array.from({ length: 30 }, item) })),
    };
    const bytes = Buffer.byteLength(JSON.stringify(cheia));
    expect(bytes).toBeGreaterThan(300_000); // o pior caso de verdade, não uma lista pequena
    await q(ligarLista(T, p.id, plano, cheia));
    const grande = { grupos: [{ nome: 'x', itens: [{ nome: 'é'.repeat(300_000) }] }] };
    await expect(q(ligarLista(T, p.id, plano, grande))).rejects.toSatisfy(violaCheck('plano_listas_substituicao_conteudo_valido'));
    await expect(q(ligarLista(T, p.id, plano, [1, 2]))).rejects.toSatisfy(violaCheck('plano_listas_substituicao_conteudo_valido'));
  });

  it('excluir o conteúdo solta a ligação (content_id nulo) e mantém o título copiado', async () => {
    const { T, p, q } = await cenario();
    const plano = await novoPlano(q, T, p.id, 'rascunho');
    const c = (await q(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'orientacao', 'Rótulos') returning id`)).rows[0].id as string;
    const lig = (await q(ligarConteudo(T, p.id, plano, c))).rows[0].id as string;
    await q(sql`delete from contents where id = ${c}`);
    const [r] = (await q(sql`select content_id, titulo from plano_conteudos where id = ${lig}`)).rows;
    expect(r).toEqual({ content_id: null, titulo: 'Material' });
  });
});

describe('Plano 19 — RN-12 ampliada (RN-253): conteúdo ligado ao plano publicado do próprio paciente', () => {
  it('só com a liberação, só publicado ligado a plano publicado, só do próprio paciente; nunca conta visualização', async () => {
    const { T, p, q } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const conteudo = async (status: 'publicado' | 'rascunho', titulo: string) =>
      (await q(sql`insert into contents (tenant_id, tipo, titulo, visibilidade, status, publicado_em)
        values (${T.tenantId}, 'orientacao', ${titulo}, 'pacientes', ${status}, ${status === 'publicado' ? sql`now()` : null}) returning id`)).rows[0]
        .id as string;
    const doPublicado = await conteudo('publicado', 'Ligado ao publicado');
    const doRascunho = await conteudo('publicado', 'Ligado só ao rascunho');
    const naoPublicado = await conteudo('rascunho', 'Conteúdo em rascunho');
    const doArquivado = await conteudo('publicado', 'Ligado só ao arquivado');
    const publicado = await novoPlano(q, T, p.id, 'publicado');
    const rascunho = await novoPlano(q, T, p.id, 'rascunho');
    const arquivado = await novoPlano(q, T, p.id, 'arquivado');
    await q(ligarConteudo(T, p.id, publicado, doPublicado));
    await q(ligarConteudo(T, p.id, publicado, naoPublicado));
    await q(ligarConteudo(T, p.id, rascunho, doRascunho));
    await q(ligarConteudo(T, p.id, arquivado, doArquivado));

    const vistos = (patientId: string, liberar: boolean) =>
      withTenant(
        ctxPaciente(T.tenantId, patientId),
        async (tx) => {
          if (liberar) await liberarReceitasDoPlano(tx);
          return (await tx.execute(sql`select id from contents`)).rows.map((r) => r.id as string);
        },
        app.db,
      );
    expect(await vistos(p.id, false)).toEqual([]);
    expect(await vistos(p.id, true)).toEqual([doPublicado]);
    expect(await vistos(outro.id, true)).toEqual([]);

    // paciente_conteudo_visto: abrir pelo plano nunca registra visualização (D14 do Plano 07)
    await expect(
      withTenant(
        ctxPaciente(T.tenantId, p.id),
        async (tx) => {
          await liberarReceitasDoPlano(tx);
          await tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${doPublicado}, ${p.id})`);
        },
        app.db,
      ),
    ).rejects.toSatisfy(violaRls);
  });
});
