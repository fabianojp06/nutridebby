import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { comoPaciente, idsVisiveis, novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import type { Tx } from '@/db/client';
import { auditLog, contentAudience, contents, patients, patientTagLinks } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { gravarAudiencia, lerAudiencia, liberarReceitasDoPlano, naAudiencia, naAudienciaDaLinha, opcoesDeAudiencia } from './audiencia';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
  return { T, ana, bia, comoAna: comoPaciente(app.db, T.tenantId, ana.id), comoBia: comoPaciente(app.db, T.tenantId, bia.id) };
}

describe('audiência avaliada na leitura (RN-12, US-053) — a RLS da sessão de paciente', () => {
  it('"todos": todo paciente do tenant vê o publicado; rascunho ninguém vê; a nutricionista vê os dois', async () => {
    const { T, comoAna, comoBia } = await cenario();
    const pub = await novoConteudo(app.db, T);
    const rasc = await novoConteudo(app.db, T, { status: 'rascunho', titulo: 'Rascunho' });
    expect(await comoAna(idsVisiveis)).toEqual([pub.id]);
    expect(await comoBia(idsVisiveis)).toEqual([pub.id]);
    expect(await withTenant(T.ctx, idsVisiveis, app.db)).toEqual([pub.id, rasc.id]);
  });

  it('"pacientes" = [Ana]: só a Ana vê; a Bia não acha a linha (404 pela URL) e não lê a lista de alvos', async () => {
    const { T, ana, comoAna, comoBia } = await cenario();
    const c = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] });
    expect(await comoAna(idsVisiveis)).toEqual([c.id]);
    expect(await comoBia(idsVisiveis)).toEqual([]);
    expect(await comoBia((tx) => tx.select().from(contentAudience))).toEqual([]);
    expect((await comoAna((tx) => tx.select().from(contentAudience))).map((r) => r.patientId)).toEqual([ana.id]);
  });

  it('"etiquetas" = [gestante]: só quem tem a etiqueta e está ativo; aplicar a etiqueta à Bia vale na hora; tirar, também', async () => {
    const { T, ana, bia, comoAna, comoBia } = await cenario();
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    expect(await comoAna(idsVisiveis)).toEqual([c.id]);
    expect(await comoBia(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.insert(patientTagLinks).values({ tenantId: T.tenantId, patientId: bia.id, tagId: gestante }), app.db);
    expect(await comoBia(idsVisiveis)).toEqual([c.id]); // "passa a ver imediatamente"
    await withTenant(T.ctx, (tx) => tx.delete(patientTagLinks).where(eq(patientTagLinks.patientId, bia.id)), app.db);
    expect(await comoBia(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, ana.id)), app.db);
    expect(await comoAna(idsVisiveis)).toEqual([]); // RN-08: arquivado sai das audiências
    // a sessão de paciente continua sem ver etiqueta nenhuma (US-019), nem as linhas de alvo por etiqueta
    expect(await comoAna((tx) => tx.execute(sql`select 1 from patient_tag_links`).then((r) => r.rows))).toEqual([]);
    expect(await comoAna((tx) => tx.select().from(contentAudience))).toEqual([]);
  });

  it('a função devolve o contexto do chamador e não responde fora da sessão de paciente', async () => {
    const { T, ana, comoAna } = await cenario();
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    const r = await comoAna((tx) =>
      tx.execute(sql`select app_conteudo_por_etiqueta(${c.id}) as ok, current_setting('app.role') as papel, current_setting('app.patient_id') as paciente`),
    );
    expect(r.rows[0]).toEqual({ ok: true, papel: 'paciente', paciente: ana.id });
    const comoNutri = await withTenant(T.ctx, (tx) => tx.execute(sql`select app_conteudo_por_etiqueta(${c.id}) as ok`), app.db);
    expect(comoNutri.rows[0]).toEqual({ ok: false });
  });

  it('exceção da RN-12 (US-054): a receita sugerida no plano PUBLICADO da Bia aparece para ela SÓ no caminho do plano, com receita e ingredientes; plano arquivado ou receita despublicada, não', async () => {
    const { T, ana, bia, comoBia } = await cenario();
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      visibilidade: 'pacientes',
      pacientes: [ana.id],
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: idTaco(3), g: 200 }] },
    });
    const plano = await withTenant(
      T.ctx,
      async (tx) => {
        const [p] = (await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo, status, publicado_em) values (${T.tenantId}, ${bia.id}, 'Plano', 'publicado', now()) returning id`)).rows as { id: string }[];
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, horario, ordem, recipe_content_id) values (gen_random_uuid(), ${T.tenantId}, ${bia.id}, ${p.id}, 'Café da manhã', '07:00', 0, ${r.id})`);
        return p.id;
      },
      app.db,
    );
    // fora do caminho do plano (feed, busca, filtro de etiquetas, selo "Novo", URL direta): a receita não existe para ela
    expect(await comoBia(idsVisiveis)).toEqual([]);
    expect(await comoBia((tx) => tx.execute(sql`select count(*)::int as n from recipe_ingredients`).then((x) => x.rows[0]))).toEqual({ n: 0 });
    // "Meu plano" e a receita aberta pelo cartão ligam a liberação na própria transação
    const peloPlano = <R,>(fn: (tx: Tx) => Promise<R>) =>
      comoBia(async (tx) => {
        await liberarReceitasDoPlano(tx);
        return fn(tx);
      });
    expect(await peloPlano(idsVisiveis)).toEqual([r.id]);
    expect(await peloPlano((tx) => tx.execute(sql`select count(*)::int as n from recipes`).then((x) => x.rows[0]))).toEqual({ n: 1 });
    expect(await peloPlano((tx) => tx.execute(sql`select count(*)::int as n from recipe_ingredients`).then((x) => x.rows[0]))).toEqual({ n: 1 });
    // D14: nem com a liberação ligada a visualização/favorito passam (só pela audiência)
    await expect(peloPlano((tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${r.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    await expect(peloPlano((tx) => tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${r.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    // a liberação vale só na transação que a ligou (set_config local): a seguinte volta ao normal
    expect(await comoBia(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update meal_plans set status = 'arquivado' where id = ${plano}`), app.db);
    expect(await peloPlano(idsVisiveis)).toEqual([]);
    expect(await peloPlano((tx) => tx.execute(sql`select count(*)::int as n from recipe_ingredients`).then((x) => x.rows[0]))).toEqual({ n: 0 });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update meal_plans set status = 'publicado' where id = ${plano}`), app.db);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update contents set status = 'rascunho', publicado_em = null where id = ${r.id}`), app.db);
    expect(await peloPlano(idsVisiveis)).toEqual([]); // US-054 "Receita despublicada"
  });

  it('exceção da RN-12 só para o plano DELA: a Ana, com a liberação ligada, não vê a receita fora da audiência das duas que só está no plano publicado da Bia', async () => {
    const { T, bia, comoAna, comoBia } = await cenario();
    const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio' });
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      visibilidade: 'pacientes',
      pacientes: [caio.id],
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: idTaco(3), g: 200 }] },
    });
    await withTenant(
      T.ctx,
      async (tx) => {
        const [p] = (await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo, status, publicado_em) values (${T.tenantId}, ${bia.id}, 'Plano', 'publicado', now()) returning id`)).rows as { id: string }[];
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, horario, ordem, recipe_content_id) values (gen_random_uuid(), ${T.tenantId}, ${bia.id}, ${p.id}, 'Café da manhã', '07:00', 0, ${r.id})`);
      },
      app.db,
    );
    const peloPlano = (como: typeof comoAna) => <R,>(fn: (tx: Tx) => Promise<R>) =>
      como(async (tx) => {
        await liberarReceitasDoPlano(tx);
        return fn(tx);
      });
    const contar = (t: 'recipes' | 'recipe_ingredients') => (tx: Tx) => tx.execute(sql.raw(`select count(*)::int as n from ${t}`)).then((x) => x.rows[0]);
    expect(await peloPlano(comoBia)(idsVisiveis)).toEqual([r.id]); // o plano é dela: a exceção vale
    expect(await peloPlano(comoAna)(idsVisiveis)).toEqual([]); // o plano da Bia não libera nada para a Ana
    expect(await peloPlano(comoAna)(contar('recipes'))).toEqual({ n: 0 });
    expect(await peloPlano(comoAna)(contar('recipe_ingredients'))).toEqual({ n: 0 });
  });

  it('"etiquetas": a paciente com a etiqueta, mas anonimizada, não vê o conteúdo dirigido à etiqueta', async () => {
    const { T, ana, comoAna } = await cenario();
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    expect(await comoAna(idsVisiveis)).toEqual([c.id]);
    // só o anonimizado_em muda (o status continua 'ativo'): a função também o confere
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, ana.id)), app.db);
    expect(await comoAna(idsVisiveis)).toEqual([]);
  });

  it('"pacientes" em rascunho: nem a paciente-alvo vê; publicado, ela vê', async () => {
    const { T, ana, comoAna } = await cenario();
    const c = await novoConteudo(app.db, T, { status: 'rascunho', visibilidade: 'pacientes', pacientes: [ana.id] });
    expect(await comoAna(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.update(contents).set({ status: 'publicado', publicadoEm: new Date() }).where(eq(contents.id, c.id)), app.db);
    expect(await comoAna(idsVisiveis)).toEqual([c.id]);
  });

  it('visualização e favorito só de conteúdo visível (42501 no invisível); repetir a visualização não duplica', async () => {
    const { T, ana, bia, comoBia } = await cenario();
    const daAna = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] });
    const deTodos = await novoConteudo(app.db, T);
    await expect(comoBia((tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${daAna.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    await expect(comoBia((tx) => tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${daAna.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    const ver = sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${deTodos.id}, ${bia.id}) on conflict do nothing`;
    await comoBia((tx) => tx.execute(ver));
    await comoBia((tx) => tx.execute(ver));
    expect(await comoBia((tx) => tx.execute(sql`select count(*)::int as n from content_views`).then((x) => x.rows[0]))).toEqual({ n: 1 });
  });
});

describe('audiência fora da sessão de paciente (naAudiencia, gravarAudiencia)', () => {
  it('naAudiencia: os pacientes ATIVOS da audiência, para cada visibilidade', async () => {
    const { T, ana, bia } = await cenario();
    const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio', status: 'arquivado' });
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id, caio.id]);
    const todos = await novoConteudo(app.db, T);
    const porEtiqueta = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    const daBia = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [bia.id, caio.id] });
    const quem = (id: string, v: 'todos' | 'etiquetas' | 'pacientes') =>
      withTenant(T.ctx, (tx) => tx.select({ id: patients.id }).from(patients).where(naAudiencia(id, v)).orderBy(patients.nome), app.db).then((r) => r.map((x) => x.id));
    expect(await quem(todos.id, 'todos')).toEqual([ana.id, bia.id]);
    expect(await quem(porEtiqueta.id, 'etiquetas')).toEqual([ana.id]);
    expect(await quem(daBia.id, 'pacientes')).toEqual([bia.id]);
    // naAudienciaDaLinha: o mesmo resultado com o conteúdo vindo da linha (a visibilidade lida do banco)
    const daLinha = (id: string) =>
      withTenant(
        T.ctx,
        (tx) =>
          tx
            .select({ id: patients.id })
            .from(patients)
            .innerJoin(contents, and(eq(contents.tenantId, patients.tenantId), eq(contents.id, id)))
            .where(naAudienciaDaLinha(contents.id, contents.visibilidade))
            .orderBy(patients.nome),
        app.db,
      ).then((r) => r.map((x) => x.id));
    expect(await daLinha(todos.id)).toEqual([ana.id, bia.id]);
    expect(await daLinha(porEtiqueta.id)).toEqual([ana.id]);
    expect(await daLinha(daBia.id)).toEqual([bia.id]);
  });

  it('gravarAudiencia: grava só a diferença, ignora paciente de outro tenant, arquivado e etiqueta desconhecida; alvo que o formulário não mostra fica (D15); trocar a visibilidade limpa os alvos', async () => {
    const { T, ana, bia } = await cenario();
    const U = await novoTenant(app.db);
    const deFora = await novoPaciente(app.db, U.ctx);
    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const c = await novoConteudo(app.db, T, { status: 'rascunho' });
    const gravar = (a: Parameters<typeof gravarAudiencia>[3]) => withTenant(T.ctx, (tx) => gravarAudiencia(tx, T.tenantId, c.id, a), app.db);
    expect(await gravar({ visibilidade: 'pacientes', pacientes: [ana.id, deFora.id, arquivado.id, 'lixo'], etiquetas: [] })).toEqual({ pacientes: [ana.id], etiquetas: [] });
    const auditadas = () => withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'conteudos'))), app.db).then((r) => r.length);
    const antes = await auditadas();
    await gravar({ visibilidade: 'pacientes', pacientes: [ana.id], etiquetas: [] }); // nada mudou: nenhuma escrita
    expect(await auditadas()).toBe(antes);
    await gravar({ visibilidade: 'pacientes', pacientes: [bia.id], etiquetas: [] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [bia.id], etiquetas: [] });
    // D15: o Caio era alvo e foi arquivado — o formulário não o mostra (só ativos), então salvar NÃO o tira;
    // desarquivado, volta à audiência sem a nutricionista refazer a escolha
    const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio' });
    await gravar({ visibilidade: 'pacientes', pacientes: [bia.id, caio.id], etiquetas: [] });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, caio.id)), app.db);
    expect(await gravar({ visibilidade: 'pacientes', pacientes: [bia.id], etiquetas: [] })).toEqual({ pacientes: [bia.id], etiquetas: [] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [bia.id, caio.id], etiquetas: [] });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, caio.id)), app.db);
    const naDaBia = await withTenant(T.ctx, (tx) => tx.select({ id: patients.id }).from(patients).where(naAudiencia(c.id, 'pacientes')).orderBy(patients.nome), app.db);
    expect(naDaBia.map((x) => x.id)).toEqual([bia.id, caio.id]);
    // o que o formulário mostra e a nutricionista desmarca, sai
    await gravar({ visibilidade: 'pacientes', pacientes: [bia.id], etiquetas: [] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [bia.id], etiquetas: [] });
    const gestante = await novaEtiqueta(app.db, T, 'gestante');
    await gravar({ visibilidade: 'etiquetas', pacientes: [bia.id], etiquetas: [gestante, crypto.randomUUID()] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [], etiquetas: [gestante] });
    await gravar({ visibilidade: 'todos', pacientes: [ana.id], etiquetas: [gestante] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [], etiquetas: [] });
  });

  it('opcoesDeAudiencia: etiquetas do tenant e só pacientes ativos, por nome', async () => {
    const { T, ana, bia } = await cenario();
    await novoPaciente(app.db, T.ctx, { nome: 'Arquivada', status: 'arquivado' });
    const gestante = await novaEtiqueta(app.db, T, 'gestante');
    const o = await opcoesDeAudiencia(T.ctx, app.db);
    expect(o.pacientes).toEqual([{ id: ana.id, nome: 'Ana Souza' }, { id: bia.id, nome: 'Bia Lima' }]);
    expect(o.etiquetas.map((e) => e.id)).toEqual([gestante]);
  });
});
