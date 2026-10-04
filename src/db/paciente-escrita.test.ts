import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};
/** 42501 da RLS ou do gatilho paciente_colunas (0085), que recusa antes do WITH CHECK. */
const negado = (e: unknown) => (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code === '42501';

describe('P-16 (a) / D1: a sessão de paciente não grava fora de PACIENTE_ESCREVE', () => {
  it('não cria "Meu alimento", medida nem modelo de anamnese do tenant', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const comoPaciente = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(q), app.db);
    await expect(
      comoPaciente(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${T.tenantId}, 'Bolo da paciente', 'Miscelâneas', 100, 1, 1, 1, 1)`),
    ).rejects.toSatisfy(violaRls);
    await expect(comoPaciente(sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${T.tenantId}, 'X', '{"perguntas":[]}')`)).rejects.toSatisfy(violaRls);
  });

  it('não altera nem apaga alimento, medida e modelo que a nutricionista criou (0 linhas)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const foodId = randomUUID();
    await withTenant(
      T.ctx,
      async (tx) => {
        await tx.execute(sql`insert into foods (id, tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${foodId}, ${T.tenantId}, 'Granola da casa', 'Miscelâneas', 400, 10, 60, 12, 6)`);
        await tx.execute(sql`insert into food_measures (tenant_id, food_id, nome, plural, gramas) values (${T.tenantId}, ${foodId}, 'pote', 'potes', 40)`);
        await tx.execute(sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${T.tenantId}, 'Modelo', '{"perguntas":[]}')`);
      },
      app.db,
    );
    await withTenant(
      ctxPaciente(T.tenantId, p.id),
      async (tx) => {
        for (const t of ['foods', 'food_measures', 'anamnesis_templates']) {
          expect((await tx.execute(sql`update ${sql.identifier(t)} set tenant_id = tenant_id where tenant_id = ${T.tenantId}`)).rowCount, t).toBe(0);
          expect((await tx.execute(sql`delete from ${sql.identifier(t)} where tenant_id = ${T.tenantId}`)).rowCount, t).toBe(0);
        }
        // ainda lê (o editor de plano do paciente não existe, mas o plano publicado junta foods)
        expect((await tx.execute(sql`select 1 from foods where id = ${foodId}`)).rows).toHaveLength(1);
      },
      app.db,
    );
  });

  it('não grava no próprio prontuário (antropometria, exames, atendimentos)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${T.tenantId}, ${p.id}, '2026-09-01', 70, 170)`), app.db);
    const comoPaciente = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(q), app.db);
    await expect(comoPaciente(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${T.tenantId}, ${p.id}, '2026-09-02', 60, 170)`)).rejects.toSatisfy(violaRls);
    await expect(comoPaciente(sql`insert into exams (tenant_id, patient_id, data, titulo) values (${T.tenantId}, ${p.id}, '2026-09-02', 'X')`)).rejects.toSatisfy(violaRls);
    expect((await comoPaciente(sql`update anthropometry set peso_kg = 50`)).rowCount).toBe(0);
    expect((await comoPaciente(sql`delete from anthropometry`)).rowCount).toBe(0);
    expect((await comoPaciente(sql`select peso_kg from anthropometry`)).rows).toEqual([{ peso_kg: '70.00' }]); // e continua lendo
  });

  it('o que PACIENTE_ESCREVE libera continua funcionando (a trava FOR UPDATE do próprio cadastro)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`select id from patients where id = ${p.id} for update`), app.db);
    expect(r.rows).toHaveLength(1);
  });
});

describe('0080: o banco confere o que a sessão de paciente grava (defesa em profundidade da D1)', () => {
  const arquivo = (t: string, p: string, tipo: string, ext = 'png') =>
    sql`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values (${t}, ${p}, ${tipo}, ${`${t}/${tipo}/${randomUUID()}.${ext}`}, 10, 'image/png') returning caminho`;
  async function cenario() {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const comoP2 = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p2.id), (tx) => tx.execute(q), app.db);
    return { T, p1, p2, comoP2 };
  }

  it('(a) diary_entries: o paciente não cria registro com foto convertida, comentário, "visto", status final nem com a foto de outro paciente', async () => {
    const { T, p1, p2, comoP2 } = await cenario();
    // fotos de P1 (gravadas pelo worker/equipe): a convertida e a original
    const [jpegDeP1] = (await withTenant(T.ctx, (tx) => tx.execute(arquivo(T.tenantId, p1.id, 'diario_foto', 'jpg')), app.db)).rows as { caminho: string }[];
    const [originalDeP1] = (await withTenant(T.ctx, (tx) => tx.execute(arquivo(T.tenantId, p1.id, 'diario_foto_original')), app.db)).rows as { caminho: string }[];
    const registro = (extra: ReturnType<typeof sql>) =>
      comoP2(sql`insert into diary_entries (tenant_id, patient_id, refeicao, texto, foto_status, foto_path, foto_original_path, comentario_nutri, comentado_em, visto_pela_nutri_em) values (${T.tenantId}, ${p2.id}, 'Almoço', 'arroz', ${extra})`);
    await expect(registro(sql`'pronta', ${jpegDeP1.caminho}, null, null, null, null`)).rejects.toSatisfy(violaRls);
    await expect(registro(sql`'processando', null, ${originalDeP1.caminho}, null, null, null`)).rejects.toSatisfy(violaRls);
    await expect(registro(sql`'sem_foto', null, null, 'ótimo!', now(), null`)).rejects.toSatisfy(violaRls);
    await expect(registro(sql`'sem_foto', null, null, null, null, now()`)).rejects.toSatisfy(violaRls);
    await expect(registro(sql`'falhou', null, null, null, null, null`)).rejects.toSatisfy(violaRls);
    // o fluxo legítimo continua: só texto; e a própria original em "processando" (gravada na mesma transação)
    await registro(sql`'sem_foto', null, null, null, null, null`);
    await withTenant(
      ctxPaciente(T.tenantId, p2.id),
      async (tx) => {
        const [minha] = (await tx.execute(arquivo(T.tenantId, p2.id, 'diario_foto_original'))).rows as { caminho: string }[];
        await tx.execute(sql`insert into diary_entries (tenant_id, patient_id, refeicao, foto_status, foto_original_path) values (${T.tenantId}, ${p2.id}, 'Jantar', 'processando', ${minha.caminho})`);
      },
      app.db,
    );
    expect((await comoP2(sql`select refeicao from diary_entries order by refeicao`)).rows).toEqual([{ refeicao: 'Almoço' }, { refeicao: 'Jantar' }]);
  });

  it('(b) data_exports: o paciente só vê, pede e altera as exportações do titular; as da equipe ficam invisíveis e intocáveis', async () => {
    const { T, p2, comoP2 } = await cenario();
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into data_exports (tenant_id, patient_id, escopo) values (${T.tenantId}, ${p2.id}, 'equipe'), (${T.tenantId}, ${p2.id}, 'titular')`), app.db);
    expect((await comoP2(sql`select escopo from data_exports`)).rows).toEqual([{ escopo: 'titular' }]);
    await expect(comoP2(sql`insert into data_exports (tenant_id, patient_id, escopo) values (${T.tenantId}, ${p2.id}, 'equipe')`)).rejects.toSatisfy(violaRls);
    await expect(comoP2(sql`update data_exports set escopo = 'equipe'`)).rejects.toSatisfy(negado); // gatilho paciente_colunas (0085)
    expect((await comoP2(sql`update data_exports set status = 'falhou' where escopo = 'equipe'`)).rowCount).toBe(0);
    expect((await comoP2(sql`update data_exports set status = 'falhou'`)).rowCount).toBe(1); // o do titular (solicitarExportacao)
    await comoP2(sql`insert into data_exports (tenant_id, patient_id, escopo) values (${T.tenantId}, ${p2.id}, 'titular')`);
    const daEquipe = await withTenant(T.ctx, (tx) => tx.execute(sql`select status from data_exports where escopo = 'equipe'`), app.db);
    expect(daEquipe.rows).toEqual([{ status: 'pendente' }]);
  });

  it('(c) stored_files: o paciente só grava a foto original do diário, nem como dono de laudo, PDF ou ZIP', async () => {
    const { T, p2, comoP2 } = await cenario();
    for (const tipo of ['exame', 'plano_pdf', 'diario_foto', 'exportacao']) await expect(comoP2(arquivo(T.tenantId, p2.id, tipo)), tipo).rejects.toSatisfy(violaRls);
    expect((await comoP2(arquivo(T.tenantId, p2.id, 'diario_foto_original'))).rows).toHaveLength(1);
  });
});
