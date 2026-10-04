import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { caminhoDoPdfDoConteudo, conteudoDoPaciente, feedDeConteudos, marcarFavorito, registrarVisualizacao } from './conteudos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

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
    const usam: string[] = [];
    for (const f of fontes) {
      const texto = await readFile(`src/${f}`, 'utf8');
      // quem LIGA a liberação (set_config/SET) ou chama a função; a guarda da RLS (`db/rls-guard.ts`) só lê o nome na política
      if (/set_config\(\s*'app\.receitas_do_plano'|\bset\s+(?:local\s+)?app\.receitas_do_plano|liberarReceitasDoPlano\(/i.test(texto)) usam.push(f);
    }
    expect(usam.sort()).toEqual(['modules/conteudo/audiencia.ts', 'modules/portal/conteudos.ts', 'modules/portal/plano.ts']);
  });
});
