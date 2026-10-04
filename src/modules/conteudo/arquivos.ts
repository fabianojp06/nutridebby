import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { apagarArquivo, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { processarCapa } from './capa';
import { MSG_CONTEUDO, TIPOS_CONTEUDO, type TipoConteudo } from './constantes';
import { ConteudoError, ConteudoNaoEncontradoError, VideoTrocadoError } from './erros';
import type { VideoDoLink } from './video';

type DepsArquivo = { db?: Db; dataDir?: string };
/** D9: a capa do oEmbed só vale enquanto o conteúdo aponta para este vídeo (conferido com a linha travada). */
type DoVideo = { doVideo?: VideoDoLink };
type Campo = 'capaPath' | 'pdfPath';
/** O `set` do ponteiro com a coluna nomeada (chave computada não tipa no Drizzle). */
const apontar = (campo: Campo, caminho: string | null) =>
  campo === 'capaPath' ? { capaPath: caminho, updatedAt: new Date() } : { pdfPath: caminho, updatedAt: new Date() };
const outroVideo = (c: { videoProvider: string | null; videoId: string | null }, v: VideoDoLink | undefined) =>
  Boolean(v) && (c.videoProvider !== v!.provider || c.videoId !== v!.id);

/**
 * Regra 9: o arquivo entra por salvarArquivo e o ponteiro em `contents` é gravado no `registrar` (mesma transação);
 * o antigo sai por apagarArquivo, cujo `naMesmaTransacao` confere que nada aponta mais para ele. Ordem de travas igual
 * à de salvarArquivo: conteúdo (antesDaReserva, FOR UPDATE) → tenant (cota) → registro.
 */
async function trocar(
  ctx: TenantContext,
  contentId: string,
  campo: Campo,
  arquivo: { tipo: 'capa' | 'orientacao_pdf'; conteudo: Buffer; permitidos: readonly ('jpg' | 'pdf')[] },
  tipos: readonly TipoConteudo[],
  o: DepsArquivo & DoVideo,
): Promise<string> {
  if (!idValido(contentId)) throw new ConteudoNaoEncontradoError();
  let antigo: string | null = null;
  const salvo = await salvarArquivo(
    ctx,
    {
      tipo: arquivo.tipo,
      conteudo: arquivo.conteudo,
      permitidos: arquivo.permitidos,
      antesDaReserva: async (tx) => {
        const [c] = await tx
          .select({ tipo: contents.tipo, atual: contents[campo], videoProvider: contents.videoProvider, videoId: contents.videoId })
          .from(contents)
          .where(eq(contents.id, contentId))
          .for('update');
        if (!c || !tipos.includes(c.tipo as TipoConteudo)) throw new ConteudoNaoEncontradoError();
        // D9: outro salvamento trocou o link depois do oEmbed deste — desiste (rollback: nada gravado, cota intacta)
        if (outroVideo(c, o.doVideo)) throw new VideoTrocadoError();
        antigo = c.atual;
      },
      registrar: async (tx, a) => {
        await tx.update(contents).set(apontar(campo, a.caminho)).where(eq(contents.id, contentId));
      },
    },
    o,
  );
  if (antigo) await apagarSolto(ctx, contentId, campo, antigo, o);
  return salvo.caminho;
}

/** Apaga um arquivo que o conteúdo deixou de apontar (se ainda aponta — outra troca no meio —, fica). */
async function apagarSolto(ctx: TenantContext, contentId: string, campo: Campo, caminho: string, o: DepsArquivo): Promise<void> {
  await apagarArquivo(ctx, { caminho }, {
    ...o,
    naMesmaTransacao: async (tx: Tx) => {
      const [c] = await tx.select({ atual: contents[campo] }).from(contents).where(eq(contents.id, contentId)).for('update');
      return !c || c.atual !== caminho;
    },
  });
}

/**
 * D8: capa em JPEG ≤ 1280 px sem EXIF. Upload da nutricionista: `aceitos: ['jpg','png']`, `tipos: ['receita','orientacao']`.
 * Capa do oEmbed: `doVideo` — só entra se o conteúdo ainda aponta para esse vídeo (senão `VideoTrocadoError`).
 */
export async function trocarCapa(
  ctx: TenantContext,
  contentId: string,
  conteudo: Buffer,
  o: DepsArquivo & DoVideo & { aceitos?: readonly ('jpg' | 'png' | 'webp')[]; tipos?: readonly TipoConteudo[] } = {},
): Promise<string> {
  const jpeg = await processarCapa(conteudo, o.aceitos);
  return trocar(ctx, contentId, 'capaPath', { tipo: 'capa', conteudo: jpeg, permitidos: ['jpg'] }, o.tipos ?? TIPOS_CONTEUDO, o);
}

/** US-052: o PDF da orientação (tipo pelo conteúdo; D20: ≤ 10 MB, conferido na rota). */
export async function trocarPdf(ctx: TenantContext, contentId: string, conteudo: Buffer, o: DepsArquivo = {}): Promise<string> {
  return trocar(ctx, contentId, 'pdfPath', { tipo: 'orientacao_pdf', conteudo, permitidos: ['pdf'] }, ['orientacao'], o);
}

/**
 * Tira o arquivo do conteúdo: o ponteiro é limpo no `naMesmaTransacao` de apagarArquivo (regra 9), com a linha
 * travada. D17: o PDF de uma orientação PUBLICADA sem texto não sai (ela ficaria publicada vazia). D9: com `doVideo`,
 * só remove se o conteúdo ainda aponta para esse vídeo.
 */
async function remover(ctx: TenantContext, contentId: string, campo: Campo, o: DepsArquivo & DoVideo): Promise<boolean> {
  if (!idValido(contentId)) return false;
  const db = o.db ?? getDb();
  const [c] = await withTenant(ctx, (tx) => tx.select({ atual: contents[campo] }).from(contents).where(eq(contents.id, contentId)), db);
  if (!c?.atual) return false;
  const caminho = c.atual;
  return apagarArquivo(ctx, { caminho }, {
    ...o,
    naMesmaTransacao: async (tx) => {
      const [x] = await tx
        .select({ atual: contents[campo], status: contents.status, corpoMd: contents.corpoMd, videoProvider: contents.videoProvider, videoId: contents.videoId })
        .from(contents)
        .where(eq(contents.id, contentId))
        .for('update');
      if (!x || x.atual !== caminho || outroVideo(x, o.doVideo)) return false;
      if (campo === 'pdfPath' && x.status === 'publicado' && !x.corpoMd) throw new ConteudoError({ geral: MSG_CONTEUDO.publicadoVazio });
      await tx.update(contents).set(apontar(campo, null)).where(eq(contents.id, contentId));
      return true;
    },
  });
}

export const removerCapa = (ctx: TenantContext, contentId: string, o: DepsArquivo & DoVideo = {}) => remover(ctx, contentId, 'capaPath', o);
export const removerPdf = (ctx: TenantContext, contentId: string, o: DepsArquivo = {}) => remover(ctx, contentId, 'pdfPath', o);
