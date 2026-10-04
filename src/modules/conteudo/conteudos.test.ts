import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novaEtiqueta } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { contents, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { trocarCapa, trocarPdf } from './arquivos';
import { MSG_CONTEUDO } from './constantes';
import { carregarConteudoDoPainel, criarConteudo, despublicarConteudo, excluirConteudo, listarConteudosDoPainel, publicarConteudo, salvarConteudo, validarConteudo } from './conteudos';
import { ConteudoError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#09f' } }).jpeg().toBuffer();
});
/** oEmbed que responde: o JSON aponta para i.ytimg.com e a miniatura é o JPEG acima. */
const oembedOk = (async (url: string | URL | Request) =>
  String(url).includes('oembed')
    ? Response.json({ thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
    : new Response(new Uint8Array(jpeg))) as typeof fetch;
const oembedFora = (async () => {
  throw new TypeError('fetch failed');
}) as typeof fetch;
const base = { titulo: 'Como montar o prato', resumo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConteudoError) return e.erros;
    throw e;
  }
  throw new Error('não falhou');
};
const capas = (T: { ctx: Parameters<typeof withTenant>[0] }) =>
  withTenant(T.ctx, (tx) => tx.select({ caminho: storedFiles.caminho }).from(storedFiles).where(eq(storedFiles.tipo, 'capa')), app.db);

describe('validação (US-050 a US-053)', () => {
  it('mensagens por campo', () => {
    const e = (tipo: 'video' | 'receita' | 'orientacao', x: Record<string, unknown>) => {
      try {
        validarConteudo(tipo, { ...base, ...x });
        return {};
      } catch (err) {
        return (err as ConteudoError).erros;
      }
    };
    expect(e('orientacao', { titulo: '  ' })).toEqual({ titulo: MSG_CONTEUDO.titulo });
    expect(e('orientacao', { resumo: 'x'.repeat(301) })).toEqual({ resumo: MSG_CONTEUDO.resumo });
    expect(e('orientacao', { etiquetas: Array.from({ length: 11 }, (_, i) => `e${i}`).join(',') })).toEqual({ etiquetas: MSG_CONTEUDO.etiquetas });
    expect(e('orientacao', { visibilidade: 'publico' })).toEqual({ visibilidade: MSG_CONTEUDO.visibilidade });
    expect(e('orientacao', { visibilidade: 'pacientes', pacientes: ['nao-e-id'] })).toEqual({ visibilidade: MSG_CONTEUDO.audienciaVazia });
    expect(e('video', { link: 'https://tiktok.com/@x/video/1' })).toEqual({ link: 'Use um link do YouTube ou do Vimeo' });
    expect(e('receita', { link: 'https://tiktok.com/@x/video/1' })).toEqual({ link: 'Use um link do YouTube ou do Vimeo' });
    expect(e('receita', { link: '' })).toEqual({}); // vídeo opcional na receita (US-051)
    expect(e('orientacao', { corpo: 'x'.repeat(20001) })).toEqual({ corpo: MSG_CONTEUDO.corpo });
    expect(validarConteudo('orientacao', { ...base, etiquetas: 'sem lactose, Sem Lactose ,café da manhã,,' }).etiquetas).toEqual(['sem lactose', 'café da manhã']);
  });

  it('R6: NUL em qualquer texto (o Postgres recusaria com 500) → só "Formulário inválido." e nada gravado', async () => {
    expect(MSG_CONTEUDO.formulario).toBe('Formulário inválido.');
    const geral = { geral: MSG_CONTEUDO.formulario };
    const campos = [{ titulo: 'Como\0 montar' }, { resumo: 'a\0' }, { etiquetas: 'ok,se\0m' }, { etiquetas: ['ok', 'se\0m'] }, { corpo: 'x\0' }, { link: 'https://youtu.be/dQw4w9WgXcQ\0' }];
    for (const x of campos) expect(await erros(Promise.resolve().then(() => validarConteudo('receita', { ...base, ...x })))).toEqual(geral);
    const T = await novoTenant(app.db);
    expect(await erros(criarConteudo(T.ctx, 'orientacao', { ...base, titulo: 'a\0b' }, { db: app.db }))).toEqual(geral);
    expect(await listarConteudosDoPainel(T.ctx, {}, app.db)).toEqual([]);
  });
});

describe('vídeo por link (US-050, INT-05)', () => {
  it('"https://youtu.be/dQw4w9WgXcQ" + "Como montar o prato" → youtube/dQw4w9WgXcQ, capa baixada para /data, rascunho', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedOk });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(contents).where(eq(contents.id, id)), app.db);
    expect(c).toMatchObject({ tipo: 'video', titulo: 'Como montar o prato', videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ', status: 'rascunho' });
    expect(c.capaPath).toMatch(new RegExp(`^${T.tenantId}/capa/`));
    const p = await carregarConteudoDoPainel(T.ctx, id, app.db);
    expect(p).toMatchObject({ link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video: { provider: 'youtube', id: 'dQw4w9WgXcQ' } });
    expect(p!.capaUrl).toMatch(/^\/api\/arquivos\?/);
  });

  it('oEmbed indisponível → salvo com a capa padrão (sem capa); trocar o link troca a capa; link que falha tira a antiga', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedFora });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.capaUrl).toBeNull();
    await salvarConteudo(T.ctx, id, { ...base, link: 'https://vimeo.com/76979871' }, { db: app.db, fetchImpl: oembedOk });
    const [primeira] = await capas(T);
    expect(primeira).toBeDefined();
    await salvarConteudo(T.ctx, id, { ...base, titulo: 'Só o título', link: 'https://vimeo.com/76979871' }, { db: app.db, fetchImpl: oembedFora }); // mesmo vídeo: nem pede o oEmbed
    expect(await capas(T)).toEqual([primeira]);
    await salvarConteudo(T.ctx, id, { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedFora });
    expect(await capas(T)).toEqual([]);
  });

  it('dois salvamentos sobrepostos: a capa do link anterior, que chega depois do oEmbed, não fica (D9)', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedFora });
    let segundo: Promise<void> | undefined;
    let capaDoSegundo: string | null = null;
    // o oEmbed do 1º salvamento (→ Vimeo) só responde depois que um 2º salvamento (→ outro YouTube) termina com a capa dele
    const lento = (async (url: string | URL | Request) => {
      segundo ??= salvarConteudo(T.ctx, id, { ...base, link: 'https://youtu.be/9bZkp7q19f0' }, { db: app.db, fetchImpl: oembedOk }).then(async () => {
        capaDoSegundo = (await withTenant(T.ctx, (tx) => tx.select({ c: contents.capaPath }).from(contents).where(eq(contents.id, id)), app.db))[0].c;
      });
      await segundo;
      return oembedOk(url);
    }) as typeof fetch;
    await salvarConteudo(T.ctx, id, { ...base, link: 'https://vimeo.com/76979871' }, { db: app.db, fetchImpl: lento });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(contents).where(eq(contents.id, id)), app.db);
    expect(c).toMatchObject({ videoProvider: 'youtube', videoId: '9bZkp7q19f0' });
    expect(capaDoSegundo).not.toBeNull();
    expect(c.capaPath).toBe(capaDoSegundo); // sem a conferência do vídeo, a capa do Vimeo trocaria esta
    expect(await capas(T)).toEqual([{ caminho: capaDoSegundo }]);
  });
});

describe('público do conteúdo (US-053)', () => {
  it('"pacientes" grava os alvos; só paciente de outro consultório → "Escolha pelo menos uma etiqueta ou um paciente." e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const deFora = await novoPaciente(app.db, U.ctx);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, visibilidade: 'pacientes', pacientes: [ana.id] }, { db: app.db });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.audiencia).toEqual({ pacientes: [ana.id], etiquetas: [] });
    expect(await erros(criarConteudo(T.ctx, 'orientacao', { ...base, titulo: 'Outro', visibilidade: 'pacientes', pacientes: [deFora.id] }, { db: app.db }))).toEqual({
      visibilidade: MSG_CONTEUDO.audienciaVazia,
    });
    expect((await listarConteudosDoPainel(T.ctx, {}, app.db)).map((c) => c.titulo)).toEqual([base.titulo]);
    const gestante = await novaEtiqueta(app.db, T, 'gestante');
    await salvarConteudo(T.ctx, id, { ...base, visibilidade: 'etiquetas', tags: [gestante] }, { db: app.db });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.audiencia).toEqual({ pacientes: [], etiquetas: [gestante] });
  });
});

describe('publicar, despublicar, excluir (D17)', () => {
  it('orientação sem texto nem PDF não publica; com texto publica com a data; despublicar volta a rascunho', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, titulo: 'Como ler rótulos' }, { db: app.db });
    expect(await erros(publicarConteudo(T.ctx, id, { db: app.db }))).toEqual({ geral: MSG_CONTEUDO.orientacaoVazia });
    await salvarConteudo(T.ctx, id, { ...base, titulo: 'Como ler rótulos', corpo: '## Rótulos\n\nLeia a **porção**.' }, { db: app.db });
    const agora = new Date('2026-10-20T13:00:00Z');
    await publicarConteudo(T.ctx, id, { db: app.db, agora });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toMatchObject({ status: 'publicado', publicadoEm: agora, corpoMd: '## Rótulos\n\nLeia a **porção**.' });
    await despublicarConteudo(T.ctx, id, { db: app.db });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toMatchObject({ status: 'rascunho', publicadoEm: null });
  });

  it('orientação PUBLICADA não fica vazia: salvar sem texto (e sem PDF) é recusado; no rascunho pode', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, corpo: 'Leia a porção.' }, { db: app.db });
    await publicarConteudo(T.ctx, id, { db: app.db });
    expect(await erros(salvarConteudo(T.ctx, id, { ...base, corpo: '   ' }, { db: app.db }))).toEqual({ corpo: MSG_CONTEUDO.publicadoVazio });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.corpoMd).toBe('Leia a porção.');
    await despublicarConteudo(T.ctx, id, { db: app.db });
    await salvarConteudo(T.ctx, id, { ...base, corpo: '' }, { db: app.db });
  });

  it('receita sem ingredientes não publica', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'receita', { ...base, titulo: 'Panqueca de aveia' }, { db: app.db });
    expect(await erros(publicarConteudo(T.ctx, id, { db: app.db }))).toEqual({ geral: MSG_CONTEUDO.receitaIncompleta });
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) values (${T.tenantId}, ${id}, 1000, 250)`);
      await tx.execute(sql`insert into recipe_ingredients (tenant_id, content_id, food_id, quantidade_g, ordem) values (${T.tenantId}, ${id}, ${idTaco(3)}, 200, 0)`);
    }, app.db);
    await publicarConteudo(T.ctx, id, { db: app.db });
  });

  it('excluir apaga capa e PDF (regra 9) e devolve o espaço', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, corpo: 'x' }, { db: app.db });
    await trocarCapa(T.ctx, id, jpeg, { db: app.db });
    await trocarPdf(T.ctx, id, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]), { db: app.db });
    await excluirConteudo(T.ctx, id, { db: app.db });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toBeNull();
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    const [t] = await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.b).toBe(0);
  });

  it('excluir com um envio de capa ao mesmo tempo: nunca sobra arquivo sem conteúdo nem cota contada (regra 9)', async () => {
    for (let i = 0; i < 5; i++) {
      const T = await novoTenant(app.db);
      const id = await criarConteudo(T.ctx, 'orientacao', { ...base, corpo: 'x' }, { db: app.db });
      await trocarPdf(T.ctx, id, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]), { db: app.db });
      await Promise.allSettled([excluirConteudo(T.ctx, id, { db: app.db }), trocarCapa(T.ctx, id, jpeg, { db: app.db })]);
      const resta = await carregarConteudoDoPainel(T.ctx, id, app.db);
      const guardados = await withTenant(T.ctx, (tx) => tx.select({ caminho: storedFiles.caminho, bytes: storedFiles.bytes }).from(storedFiles), app.db);
      const [t] = await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId));
      expect(t.b).toBe(guardados.reduce((s, f) => s + f.bytes, 0));
      if (!resta) expect(guardados).toEqual([]);
    }
  });

  it('id inválido ou de outro tenant: não encontrado (nunca 500)', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const id = await criarConteudo(U.ctx, 'orientacao', base, { db: app.db });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toBeNull();
    expect(await carregarConteudoDoPainel(T.ctx, 'lixo', app.db)).toBeNull();
    await expect(salvarConteudo(T.ctx, id, base, { db: app.db })).rejects.toThrow(MSG_CONTEUDO.naoEncontrado);
  });
});
