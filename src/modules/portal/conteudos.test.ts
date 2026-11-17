import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { apagarPublicos, inserirPublicos } from '../../../test/alimentos-publicos';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { contents, recipeIngredients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trocarPdf } from '@/modules/conteudo/arquivos';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { caminhoDoPdfDoConteudo, conteudoDoPaciente, feedDeConteudos, marcarFavorito, mensagemDoFeedVazio, registrarVisualizacao } from './conteudos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let usda: string;
beforeAll(async () => {
  [usda] = await inserirPublicos(owner.pool, [{ nome: 'Mirtilo, cru', nomeOriginal: 'Blueberries, raw', grupo: 'Frutas e derivados', kcal: null, carboidratoG: 14.5, micros: { vitamina_k_mcg: 19.3 } }]);
});
afterAll(async () => {
  await apagarPublicos(owner.pool, [usda]);
  await app.pool.end();
  await owner.pool.end();
});

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia' });
  return { T, ana, bia, ctxAna: ctxPaciente(T.tenantId, ana.id), ctxBia: ctxPaciente(T.tenantId, bia.id) };
}
const titulos = (r: { itens: { titulo: string }[] }) => r.itens.map((i) => i.titulo);

describe('aba "Conteúdos" (US-055)', () => {
  it('feed: só a audiência, do mais recente para o mais antigo, filtro por tipo, "Novo" até abrir', async () => {
    const { T, ana, ctxAna, ctxBia } = await cenario();
    const antigo = await novoConteudo(app.db, T, { titulo: 'Como ler rótulos', publicadoEm: new Date('2026-10-01T12:00:00Z') });
    await novoConteudo(app.db, T, { tipo: 'video', titulo: 'Como montar o prato', videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ', publicadoEm: new Date('2026-10-02T12:00:00Z') });
    await novoConteudo(app.db, T, { titulo: 'Só da Ana', visibilidade: 'pacientes', pacientes: [ana.id], publicadoEm: new Date('2026-10-03T12:00:00Z') });
    await novoConteudo(app.db, T, { titulo: 'Rascunho', status: 'rascunho' });
    expect(titulos(await feedDeConteudos(ctxAna, {}, app.db))).toEqual(['Só da Ana', 'Como montar o prato', 'Como ler rótulos']);
    expect(titulos(await feedDeConteudos(ctxBia, {}, app.db))).toEqual(['Como montar o prato', 'Como ler rótulos']);
    expect(titulos(await feedDeConteudos(ctxAna, { tipo: 'video' }, app.db))).toEqual(['Como montar o prato']);
    expect((await feedDeConteudos(ctxAna, {}, app.db)).itens.every((i) => i.novo)).toBe(true);
    expect(await registrarVisualizacao(ctxAna, antigo.id, app.db)).toBe(true);
    expect(await registrarVisualizacao(ctxAna, antigo.id, app.db)).toBe(true); // "uma única vez": a segunda não duplica
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from content_views where content_id = ${antigo.id}`), app.db);
    expect(n.rows[0]).toEqual({ n: 1 });
    expect((await feedDeConteudos(ctxAna, {}, app.db)).itens.find((i) => i.titulo === 'Como ler rótulos')!.novo).toBe(false);
  });

  it('"Busca e filtro": "aveia" no título ou resumo E a etiqueta "sem lactose"; as etiquetas do filtro vêm do que ela vê', async () => {
    const { T, ctxAna } = await cenario();
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', etiquetas: ['sem lactose'] });
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Mingau', resumo: 'Com aveia e leite', etiquetas: ['café da manhã'] });
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Bolo sem leite', etiquetas: ['sem lactose'] });
    expect(titulos(await feedDeConteudos(ctxAna, { busca: 'aveia', etiqueta: 'sem lactose' }, app.db))).toEqual(['Panqueca de aveia']);
    expect(titulos(await feedDeConteudos(ctxAna, { busca: 'Aveia' }, app.db)).sort()).toEqual(['Mingau', 'Panqueca de aveia']);
    expect(titulos(await feedDeConteudos(ctxAna, { busca: '<script>' }, app.db))).toEqual([]); // nada quebra
    expect((await feedDeConteudos(ctxAna, {}, app.db)).etiquetas).toEqual(['café da manhã', 'sem lactose']);
  });

  it('R6: NUL na busca ou na etiqueta (?busca=%00) não vira 500 — o \\0 sai antes da consulta', async () => {
    const { T, ctxAna } = await cenario();
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', etiquetas: ['sem lactose'] });
    await expect(feedDeConteudos(ctxAna, { busca: 'a\0veia' }, app.db)).resolves.toMatchObject({ etiquetas: ['sem lactose'] });
    expect(titulos(await feedDeConteudos(ctxAna, { busca: 'ave\0ia', etiqueta: 'sem \0lactose' }, app.db))).toEqual(['Panqueca de aveia']);
    expect(titulos(await feedDeConteudos(ctxAna, { busca: '\0' }, app.db))).toEqual(['Panqueca de aveia']); // sobra nada: sem filtro
  });

  it('lista vazia: "Nenhum conteúdo encontrado." só com filtro que filtra (também em Favoritos); busca de 1 caractere ou só \\0 não conta', () => {
    expect(mensagemDoFeedVazio({})).toBe('Nenhum conteúdo por aqui ainda.');
    expect(mensagemDoFeedVazio({ favoritos: true })).toBe('Você ainda não favoritou nenhum conteúdo.');
    expect(mensagemDoFeedVazio({ favoritos: true, busca: 'aveia' })).toBe('Nenhum conteúdo encontrado.');
    expect(mensagemDoFeedVazio({ favoritos: true, etiqueta: 'sem lactose' })).toBe('Nenhum conteúdo encontrado.');
    expect(mensagemDoFeedVazio({ tipo: 'video' })).toBe('Nenhum conteúdo encontrado.');
    expect(mensagemDoFeedVazio({ busca: 'a' })).toBe('Nenhum conteúdo por aqui ainda.'); // o feed ignora: mostra tudo
    expect(mensagemDoFeedVazio({ busca: ' \0\0 ', etiqueta: '\0' })).toBe('Nenhum conteúdo por aqui ainda.');
    expect(mensagemDoFeedVazio({ favoritos: true, busca: 'a\0' })).toBe('Você ainda não favoritou nenhum conteúdo.');
  });

  it('"Favoritos": favoritar uma receita → aparece em Favoritos; desfavoritar tira; conteúdo invisível não favorita', async () => {
    const { T, ana, ctxAna, ctxBia } = await cenario();
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia' });
    const daAna = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] });
    expect(await marcarFavorito(ctxAna, r.id, true, app.db)).toBe(true);
    expect(titulos(await feedDeConteudos(ctxAna, { favoritos: true }, app.db))).toEqual(['Panqueca de aveia']);
    expect((await feedDeConteudos(ctxAna, {}, app.db)).itens.find((i) => i.id === r.id)!.favorito).toBe(true);
    expect(await marcarFavorito(ctxAna, r.id, false, app.db)).toBe(true);
    expect(titulos(await feedDeConteudos(ctxAna, { favoritos: true }, app.db))).toEqual([]);
    expect(await marcarFavorito(ctxBia, daAna.id, true, app.db)).toBe(false);
    expect(await registrarVisualizacao(ctxBia, daAna.id, app.db)).toBe(false);
  });

  it('detalhe: fora da audiência → null (a página dá 404); receita com valores por porção; PDF só da orientação visível', async () => {
    const { T, ana, ctxAna, ctxBia } = await cenario();
    const daAna = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id], pdfPath: null });
    expect(await conteudoDoPaciente(ctxBia, daAna.id, app.db)).toBeNull();
    expect(await conteudoDoPaciente(ctxBia, 'nao-e-id', app.db)).toBeNull();
    expect(await conteudoDoPaciente(ctxAna, daAna.id, app.db)).toMatchObject({ id: daAna.id, tipo: 'orientacao', temPdf: false, favorito: false, receita: null });
    expect(await caminhoDoPdfDoConteudo(ctxBia, daAna.id, app.db)).toBeNull();
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      videoProvider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: '00000000-0000-4000-8000-000000000003', g: 400 }] },
    });
    const c = (await conteudoDoPaciente(ctxAna, r.id, app.db))!;
    expect(c.video).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(c.receita).toMatchObject({ rendimentoG: 1000, porcaoG: 250, ingredientes: [{ quantidadeG: 400 }] });
    expect(c.porPorcao).toMatch(/^Por porção: \d+ kcal/);
    expect(c.soPeloPlano).toBe(false);
  });

  it('RN-230: ingrediente da USDA na receita do portal — a fonte vem de foods.fonte ("Sem valor na USDA"), sem micros (CS-232)', async () => {
    const { T, ctxAna } = await cenario();
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca com mirtilo', receita: { rendimento: 500, porcao: 100, ingredientes: [{ foodId: '00000000-0000-4000-8000-000000000003', g: 400 }, { foodId: usda, g: 100 }] } });
    try {
      const c = (await conteudoDoPaciente(ctxAna, r.id, app.db))!;
      const [arroz, mirtilo] = c.receita!.ingredientes;
      expect([arroz.fonte, arroz.origem, mirtilo.fonte, mirtilo.origem]).toEqual(['taco', 'TACO', 'usda', 'USDA (EUA)']);
      expect(mirtilo.porCem.kcal).toBeNull();
      expect(MSG_PLANO.semValor(mirtilo.fonte)).toBe('Sem valor na USDA');
      expect(JSON.stringify(c)).not.toMatch(/micros|vitamina_k/);
    } finally {
      await withTenant(T.ctx, (tx) => tx.delete(recipeIngredients).where(eq(recipeIngredients.foodId, usda)), app.db);
    }
  });

  it('D2: orientação em rascunho com PDF e conteúdo de outro tenant — nem detalhe, nem PDF, nem visualização ou favorito', async () => {
    const { T, ana, ctxAna } = await cenario();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
    const rascunho = await novoConteudo(app.db, T, { status: 'rascunho', visibilidade: 'pacientes', pacientes: [ana.id] });
    await trocarPdf(T.ctx, rascunho.id, pdf, { db: app.db });
    expect(await withTenant(T.ctx, (tx) => tx.select({ p: contents.pdfPath }).from(contents).where(eq(contents.id, rascunho.id)), app.db)).toEqual([{ p: expect.any(String) }]);
    expect(await conteudoDoPaciente(ctxAna, rascunho.id, app.db)).toBeNull();
    expect(await caminhoDoPdfDoConteudo(ctxAna, rascunho.id, app.db)).toBeNull();
    expect(await registrarVisualizacao(ctxAna, rascunho.id, app.db)).toBe(false);
    expect(await marcarFavorito(ctxAna, rascunho.id, true, app.db)).toBe(false);
    const U = await novoTenant(app.db);
    const deFora = await novoConteudo(app.db, U);
    await trocarPdf(U.ctx, deFora.id, pdf, { db: app.db });
    expect(await conteudoDoPaciente(ctxAna, deFora.id, app.db, { doPlano: true })).toBeNull();
    expect(await caminhoDoPdfDoConteudo(ctxAna, deFora.id, app.db)).toBeNull();
    expect(await registrarVisualizacao(ctxAna, deFora.id, app.db)).toBe(false);
    expect(await marcarFavorito(ctxAna, deFora.id, true, app.db)).toBe(false);
  });

  it('US-054: receita fora da audiência sugerida no plano PUBLICADO da Bia só abre pelo cartão — nem feed, busca, etiqueta, "Novo", favorito ou visualização', async () => {
    const { T, ana, bia, ctxAna, ctxBia } = await cenario();
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      etiquetas: ['sem lactose'],
      visibilidade: 'pacientes',
      pacientes: [ana.id],
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: '00000000-0000-4000-8000-000000000003', g: 400 }] },
    });
    await withTenant(
      T.ctx,
      async (tx) => {
        const [p] = (await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo, status, publicado_em) values (${T.tenantId}, ${bia.id}, 'Plano', 'publicado', now()) returning id`)).rows as { id: string }[];
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, horario, ordem, recipe_content_id) values (gen_random_uuid(), ${T.tenantId}, ${bia.id}, ${p.id}, 'Café da manhã', '07:00', 0, ${r.id})`);
      },
      app.db,
    );
    expect(await feedDeConteudos(ctxBia, {}, app.db)).toEqual({ itens: [], etiquetas: [] });
    expect((await feedDeConteudos(ctxBia, { busca: 'aveia', etiqueta: 'sem lactose' }, app.db)).itens).toEqual([]);
    expect(await conteudoDoPaciente(ctxBia, r.id, app.db)).toBeNull(); // URL direta, sem o caminho do plano: 404
    expect(await conteudoDoPaciente(ctxBia, r.id, app.db, { doPlano: true })).toMatchObject({ id: r.id, soPeloPlano: true, favorito: false, receita: { porcaoG: 250 } });
    expect(await marcarFavorito(ctxBia, r.id, true, app.db)).toBe(false);
    expect(await registrarVisualizacao(ctxBia, r.id, app.db)).toBe(false); // D14: quem abre só pelo cartão não conta
    // na audiência, o caminho do plano não muda nada
    expect(await conteudoDoPaciente(ctxAna, r.id, app.db, { doPlano: true })).toMatchObject({ id: r.id, soPeloPlano: false });
  });

  it('guarda: só "Meu plano" e o detalhe pelo cartão ligam a liberação das receitas do plano (o feed nunca)', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const fontes = (await readdir('src', { recursive: true })).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    // critério amplo: qualquer menção ao nome da função ou ao parâmetro — pega import com alias, `.then(liberar…)`,
    // set_config e `SET SESSION` (que sobreviveria no pool). Só a guarda da RLS (db/rls-guard.ts) cita o parâmetro
    // para conferir a política, e fica de fora pelo nome.
    const usam: string[] = [];
    for (const f of fontes) {
      if (f === 'db/rls-guard.ts') continue;
      if (/\bliberarReceitasDoPlano\b|receitas_do_plano/.test(await readFile(`src/${f}`, 'utf8'))) usam.push(f);
    }
    expect(usam.sort()).toEqual(['modules/conteudo/audiencia.ts', 'modules/portal/conteudos.ts', 'modules/portal/plano.ts']);
    // em cada chamador: o import sem alias e UMA chamada, dentro da função certa
    const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [arquivo, funcao] of [
      ['modules/portal/conteudos.ts', 'conteudoDoPaciente'],
      ['modules/portal/plano.ts', 'planoDoPaciente'],
    ] as const) {
      const codigo = semComentarios(await readFile(`src/${arquivo}`, 'utf8'));
      expect(codigo.match(/\bliberarReceitasDoPlano\b/g), arquivo).toHaveLength(2); // o import e a chamada
      expect(codigo, arquivo).toContain("import { liberarReceitasDoPlano } from '@/modules/conteudo/audiencia';");
      expect(codigo.match(/await liberarReceitasDoPlano\(tx\);/g), arquivo).toHaveLength(1);
      const inicio = codigo.indexOf(`export async function ${funcao}(`);
      const fim = codigo.indexOf('\nexport ', inicio + 1);
      const chamada = codigo.indexOf('await liberarReceitasDoPlano(tx);');
      expect(inicio, arquivo).toBeGreaterThanOrEqual(0);
      expect(chamada > inicio && (fim < 0 || chamada < fim), `${arquivo}: a chamada fica dentro de ${funcao}`).toBe(true);
    }
  });
});
