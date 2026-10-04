import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { novoTenant } from '../../../test/pacientes';
import { contents, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { COTA_BYTES, CotaEsgotadaError, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { removerCapa, removerPdf, trocarCapa, trocarPdf } from './arquivos';
import { MSG_CONTEUDO } from './constantes';
import { ConteudoNaoEncontradoError, VideoTrocadoError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#f80' } }).png().toBuffer();
});
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000)]);
const arquivos = (T: { ctx: Parameters<typeof withTenant>[0] }) =>
  withTenant(T.ctx, (tx) => tx.select({ tipo: storedFiles.tipo, caminho: storedFiles.caminho, patientId: storedFiles.patientId }).from(storedFiles), app.db);
const conteudo = (T: { ctx: Parameters<typeof withTenant>[0] }, id: string) => withTenant(T.ctx, (tx) => tx.select().from(contents).where(eq(contents.id, id)), app.db).then((r) => r[0]);

describe('capa e PDF do conteúdo (D8, regra 9)', () => {
  it('capa: PNG vira JPEG do consultório; trocar apaga a antiga; remover limpa o ponteiro e o arquivo', async () => {
    const T = await novoTenant(app.db);
    const c = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca' });
    const primeira = await trocarCapa(T.ctx, c.id, png, { ...deps, aceitos: ['jpg', 'png'] });
    expect(primeira).toMatch(new RegExp(`^${T.tenantId}/capa/.+\\.jpg$`));
    const segunda = await trocarCapa(T.ctx, c.id, png, deps);
    expect((await conteudo(T, c.id)).capaPath).toBe(segunda);
    expect(await arquivos(T)).toEqual([{ tipo: 'capa', caminho: segunda, patientId: null }]);
    expect(await removerCapa(T.ctx, c.id, deps)).toBe(true);
    expect((await conteudo(T, c.id)).capaPath).toBeNull();
    expect(await arquivos(T)).toEqual([]);
  });

  it('capa: WebP enviado pela nutricionista é recusado; capa enviada em vídeo não (só o oEmbed põe capa no vídeo)', async () => {
    const T = await novoTenant(app.db);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R' });
    const webp = await sharp(png).webp().toBuffer();
    await expect(trocarCapa(T.ctx, r.id, webp, { ...deps, aceitos: ['jpg', 'png'] })).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    const v = await novoConteudo(app.db, T, { tipo: 'video', titulo: 'V', videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ' });
    await expect(trocarCapa(T.ctx, v.id, png, { ...deps, tipos: ['receita', 'orientacao'] })).rejects.toBeInstanceOf(ConteudoNaoEncontradoError);
    expect(await arquivos(T)).toEqual([]);
  });

  it('D9: a capa do oEmbed (e a remoção dela) só vale se o conteúdo ainda aponta para o mesmo vídeo', async () => {
    const T = await novoTenant(app.db);
    const v = await novoConteudo(app.db, T, { tipo: 'video', titulo: 'V', videoProvider: 'vimeo', videoId: '76979871' });
    const antigo = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;
    await expect(trocarCapa(T.ctx, v.id, png, { ...deps, doVideo: antigo })).rejects.toBeInstanceOf(VideoTrocadoError);
    expect(await arquivos(T)).toEqual([]); // nada gravado, cota intacta
    const capa = await trocarCapa(T.ctx, v.id, png, { ...deps, doVideo: { provider: 'vimeo', id: '76979871' } });
    expect(await removerCapa(T.ctx, v.id, { ...deps, doVideo: antigo })).toBe(false);
    expect((await conteudo(T, v.id)).capaPath).toBe(capa);
  });

  it('D17: orientação PUBLICADA sem texto não perde o PDF (ficaria vazia); com texto, perde', async () => {
    const T = await novoTenant(app.db);
    const o = await novoConteudo(app.db, T); // publicada, sem texto
    await trocarPdf(T.ctx, o.id, pdf, deps);
    await expect(removerPdf(T.ctx, o.id, deps)).rejects.toMatchObject({ erros: { geral: MSG_CONTEUDO.publicadoVazio } });
    expect((await conteudo(T, o.id)).pdfPath).not.toBeNull();
    expect(await arquivos(T)).toHaveLength(1);
    await withTenant(T.ctx, (tx) => tx.update(contents).set({ corpoMd: 'Leia a porção.' }).where(eq(contents.id, o.id)), app.db);
    expect(await removerPdf(T.ctx, o.id, deps)).toBe(true);
  });

  it('PDF: só na orientação; tipo pelo conteúdo; cota esgotada não grava nada', async () => {
    const T = await novoTenant(app.db);
    const o = await novoConteudo(app.db, T, { status: 'rascunho' }); // rascunho: tirar o PDF não esbarra na D17
    const caminho = await trocarPdf(T.ctx, o.id, pdf, deps);
    expect(caminho).toMatch(/\/orientacao_pdf\/.+\.pdf$/);
    await expect(trocarPdf(T.ctx, o.id, png, deps)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R' });
    await expect(trocarPdf(T.ctx, r.id, pdf, deps)).rejects.toBeInstanceOf(ConteudoNaoEncontradoError);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    await expect(trocarPdf(T.ctx, o.id, pdf, deps)).rejects.toBeInstanceOf(CotaEsgotadaError);
    expect((await conteudo(T, o.id)).pdfPath).toBe(caminho);
    expect(await removerPdf(T.ctx, o.id, deps)).toBe(true);
    expect(await removerPdf(T.ctx, o.id, deps)).toBe(false);
  });
});
