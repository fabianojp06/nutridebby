import { and, count, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents, recipeIngredients, type ContentRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { signFileUrl } from '@/lib/signed-url';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { apagarArquivo, CotaEsgotadaError, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { removerCapa, trocarCapa } from './arquivos';
import { gravarAudiencia, lerAudiencia } from './audiencia';
import { CORPO_MAX, ehVisibilidade, ETIQUETA_MAX, ETIQUETAS_MAX, MSG_CONTEUDO, RESUMO_MAX, TITULO_MAX, type TipoConteudo, type Visibilidade } from './constantes';
import { ConteudoError, ConteudoNaoEncontradoError, VideoTrocadoError } from './erros';
import { miniaturaDoVideo } from './oembed';
import { lerLinkDeVideo, urlDoVideo, videoDoConteudo, type VideoDoLink } from './video';

export type EntradaConteudo = { titulo?: unknown; resumo?: unknown; etiquetas?: unknown; visibilidade?: unknown; pacientes?: unknown; tags?: unknown; link?: unknown; corpo?: unknown };
export type Deps = { db?: Db; dataDir?: string; agora?: Date; fetchImpl?: typeof fetch };
type Validado = { titulo: string; resumo: string; etiquetas: string[]; visibilidade: Visibilidade; pacientes: string[]; tags: string[]; video: VideoDoLink | null; corpoMd: string };

export type ConteudoDaLista = { id: string; tipo: TipoConteudo; titulo: string; status: 'rascunho' | 'publicado'; visibilidade: Visibilidade; publicadoEm: Date | null; atualizadoEm: Date };
export type ConteudoDoPainel = {
  id: string;
  tipo: TipoConteudo;
  titulo: string;
  resumo: string;
  corpoMd: string;
  etiquetas: string[];
  visibilidade: Visibilidade;
  status: 'rascunho' | 'publicado';
  publicadoEm: Date | null;
  video: VideoDoLink | null;
  /** O link canônico do vídeo, para o campo do formulário ('' sem vídeo). */
  link: string;
  capaUrl: string | null;
  pdfUrl: string | null;
  audiencia: { pacientes: string[]; etiquetas: string[] };
};

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** "sem lactose, Sem Lactose, café da manhã" → ['sem lactose', 'café da manhã']; passou do limite → null. */
export function lerEtiquetasDoConteudo(v: unknown): string[] | null {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const bruta of typeof v === 'string' ? v.split(',') : textos(v)) {
    const e = normalizarTexto(bruta);
    if (!e) continue;
    if (e.length > ETIQUETA_MAX) return null;
    const chave = e.toLocaleLowerCase('pt-BR');
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    out.push(e);
  }
  return out.length > ETIQUETAS_MAX ? null : out;
}

/** R6: NUL (`\0`) num texto recebido — o Postgres o recusa em `text` (SQLSTATE 22021, um 500). Como o F-4 do diário. */
const temNul = (e: EntradaConteudo): boolean =>
  [e.titulo, e.resumo, e.link, e.corpo, ...(typeof e.etiquetas === 'string' ? [e.etiquetas] : textos(e.etiquetas))].some((v) => typeof v === 'string' && v.includes('\0'));

/** Validação completa antes de tocar no banco: erro por campo, nunca gravação parcial. */
export function validarConteudo(tipo: TipoConteudo, e: EntradaConteudo): Validado {
  if (temNul(e)) throw new ConteudoError({ geral: MSG_CONTEUDO.formulario });
  const erros: Record<string, string> = {};
  const titulo = normalizarTexto(e.titulo);
  if (!titulo || titulo.length > TITULO_MAX) erros.titulo = MSG_CONTEUDO.titulo;
  const resumo = typeof e.resumo === 'string' ? e.resumo.trim() : '';
  if (resumo.length > RESUMO_MAX) erros.resumo = MSG_CONTEUDO.resumo;
  const etiquetas = lerEtiquetasDoConteudo(e.etiquetas);
  if (!etiquetas) erros.etiquetas = MSG_CONTEUDO.etiquetas;
  const visibilidade = ehVisibilidade(e.visibilidade) ? e.visibilidade : null;
  const pacientes = textos(e.pacientes).filter(idValido);
  const tags = textos(e.tags).filter(idValido);
  if (!visibilidade) erros.visibilidade = MSG_CONTEUDO.visibilidade;
  else if ((visibilidade === 'pacientes' && !pacientes.length) || (visibilidade === 'etiquetas' && !tags.length)) erros.visibilidade = MSG_CONTEUDO.audienciaVazia;
  const link = typeof e.link === 'string' ? e.link.trim() : '';
  const video = tipo === 'orientacao' || !link ? null : lerLinkDeVideo(link);
  if ((tipo === 'video' && !video) || (tipo === 'receita' && link && !video)) erros.link = MSG_CONTEUDO.videoDominio;
  const corpoMd = tipo === 'orientacao' && typeof e.corpo === 'string' ? e.corpo.replace(/\r\n?/g, '\n').trim() : '';
  if (corpoMd.length > CORPO_MAX) erros.corpo = MSG_CONTEUDO.corpo;
  if (Object.keys(erros).length) throw new ConteudoError(erros);
  return { titulo, resumo, etiquetas: etiquetas!, visibilidade: visibilidade!, pacientes, tags, video, corpoMd };
}

const colunas = (v: Validado, agora: Date) => ({
  titulo: v.titulo,
  resumo: v.resumo,
  etiquetas: v.etiquetas,
  visibilidade: v.visibilidade,
  corpoMd: v.corpoMd,
  videoProvider: v.video?.provider ?? null,
  videoId: v.video?.id ?? null,
  updatedAt: agora,
});

/** Grava o público e confere que sobrou alguém (paciente de outro tenant/arquivado some em gravarAudiencia). */
async function gravarPublico(tx: Tx, tenantId: string, contentId: string, v: Validado): Promise<void> {
  const a = await gravarAudiencia(tx, tenantId, contentId, { visibilidade: v.visibilidade, pacientes: v.pacientes, etiquetas: v.tags });
  if (v.visibilidade !== 'todos' && !a.pacientes.length && !a.etiquetas.length) throw new ConteudoError({ visibilidade: MSG_CONTEUDO.audienciaVazia });
}

/**
 * D9: capa do vídeo pelo oEmbed, FORA da transação. Falhou (ou a cota acabou) → sem capa: a capa padrão (US-050 não
 * bloqueia o cadastro). Só o tipo `video`: na receita, a capa é a enviada pela nutricionista. Gravar e remover
 * reconferem, com a linha travada, que o conteúdo ainda aponta para ESTE vídeo (`doVideo`): se outro salvamento trocou o
 * link enquanto o oEmbed respondia (ou o conteúdo foi excluído), a capa é dele e esta desiste.
 */
async function capaDoVideo(ctx: TenantContext, id: string, video: VideoDoLink, deps: Deps): Promise<void> {
  const miniatura = await miniaturaDoVideo(video, { fetchImpl: deps.fetchImpl });
  if (miniatura) {
    try {
      await trocarCapa(ctx, id, miniatura, { ...deps, doVideo: video });
      return;
    } catch (err) {
      if (err instanceof VideoTrocadoError || err instanceof ConteudoNaoEncontradoError) return;
      if (!(err instanceof TipoNaoPermitidoError || err instanceof CotaEsgotadaError)) throw err;
    }
  }
  await removerCapa(ctx, id, { ...deps, doVideo: video });
}

export async function criarConteudo(ctx: TenantContext, tipo: TipoConteudo, entrada: EntradaConteudo, deps: Deps = {}): Promise<string> {
  const v = validarConteudo(tipo, entrada);
  const agora = deps.agora ?? new Date();
  const id = await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.insert(contents).values({ tenantId: ctx.tenantId, tipo, ...colunas(v, agora), createdAt: agora }).returning({ id: contents.id });
      await gravarPublico(tx, ctx.tenantId, c.id, v);
      return c.id;
    },
    deps.db ?? getDb(),
  );
  if (tipo === 'video' && v.video) await capaDoVideo(ctx, id, v.video, deps);
  return id;
}

export async function salvarConteudo(ctx: TenantContext, id: string, entrada: EntradaConteudo, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  const r = await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(eq(contents.id, id)).for('update');
      if (!c) throw new ConteudoNaoEncontradoError();
      const tipo = c.tipo as TipoConteudo;
      const v = validarConteudo(tipo, entrada);
      // D17: a mesma exigência da publicação vale para o que já está publicado — não fica publicado vazio
      if (c.status === 'publicado' && tipo === 'orientacao' && !v.corpoMd && !c.pdfPath) throw new ConteudoError({ corpo: MSG_CONTEUDO.publicadoVazio });
      await tx.update(contents).set(colunas(v, agora)).where(eq(contents.id, id));
      await gravarPublico(tx, ctx.tenantId, id, v);
      const mudou = (v.video?.provider ?? null) !== c.videoProvider || (v.video?.id ?? null) !== c.videoId;
      return { tipo, video: v.video, mudou };
    },
    deps.db ?? getDb(),
  );
  if (r.tipo === 'video' && r.mudou && r.video) await capaDoVideo(ctx, id, r.video, deps);
}

async function exigirPublicavel(tx: Tx, c: ContentRow): Promise<void> {
  if (c.tipo === 'receita') {
    const [{ n }] = await tx.select({ n: count() }).from(recipeIngredients).where(eq(recipeIngredients.contentId, c.id));
    if (!n) throw new ConteudoError({ geral: MSG_CONTEUDO.receitaIncompleta });
  }
  if (c.tipo === 'orientacao' && !c.corpoMd && !c.pdfPath) throw new ConteudoError({ geral: MSG_CONTEUDO.orientacaoVazia });
  if (c.visibilidade !== 'todos') {
    const a = await lerAudiencia(tx, c.id);
    if (!a.pacientes.length && !a.etiquetas.length) throw new ConteudoError({ visibilidade: MSG_CONTEUDO.audienciaVazia });
  }
}

/** D17: publica (de novo: `publicado_em` renovado — volta ao topo do feed). */
export async function publicarConteudo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(eq(contents.id, id)).for('update');
      if (!c) throw new ConteudoNaoEncontradoError();
      await exigirPublicavel(tx, c);
      await tx.update(contents).set({ status: 'publicado', publicadoEm: agora, updatedAt: agora }).where(eq(contents.id, id));
    },
    deps.db ?? getDb(),
  );
}

/** D17 / US-054 "Receita despublicada": some do feed e do cartão do plano na hora (a RLS só mostra o publicado). */
export async function despublicarConteudo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  const r = await withTenant(
    ctx,
    (tx) => tx.update(contents).set({ status: 'rascunho', publicadoEm: null, updatedAt: agora }).where(eq(contents.id, id)).returning({ id: contents.id }),
    deps.db ?? getDb(),
  );
  if (!r.length) throw new ConteudoNaoEncontradoError();
}

/** Voltas da exclusão: cada envio de capa/PDF que chega no meio custa uma (com capa e PDF, a primeira tira a capa). */
const EXCLUIR_VOLTAS = 4;

/**
 * D17 / regra 9: o conteúdo sai na MESMA transação que apaga o último arquivo dele — o `naMesmaTransacao` de
 * apagarArquivo trava a linha, confere que os dois ponteiros são os lidos e faz o DELETE (as filhas saem em cascata; a
 * sugestão na refeição vira nula — D13). Um upload de capa/PDF que entra entre a leitura e o DELETE troca o ponteiro:
 * a conferência falha, nada é apagado e a volta seguinte relê — nunca sobra `stored_files` órfão nem cota contada.
 * Com capa e PDF, a capa sai antes (removerCapa: ponteiro limpo na transação dela; a capa não tem a exigência da D17).
 * Sem arquivo, o DELETE trava e confere do mesmo jeito. Esgotadas as voltas: "Outro envio está em andamento…".
 */
export async function excluirConteudo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const db = deps.db ?? getDb();
  for (let volta = 0; volta < EXCLUIR_VOLTAS; volta++) {
    const [c] = await withTenant(ctx, (tx) => tx.select({ capaPath: contents.capaPath, pdfPath: contents.pdfPath }).from(contents).where(eq(contents.id, id)), db);
    if (!c) throw new ConteudoNaoEncontradoError();
    if (c.capaPath && c.pdfPath) {
      await removerCapa(ctx, id, deps); // a próxima volta tem um arquivo só (o PDF)
      continue;
    }
    let apagou = false;
    const apagarSeIgual = async (tx: Tx): Promise<boolean> => {
      const [x] = await tx.select({ capaPath: contents.capaPath, pdfPath: contents.pdfPath }).from(contents).where(eq(contents.id, id)).for('update');
      if (!x || x.capaPath !== c.capaPath || x.pdfPath !== c.pdfPath) return false;
      await tx.delete(contents).where(eq(contents.id, id));
      apagou = true;
      return true;
    };
    const ultimo = c.capaPath ?? c.pdfPath;
    if (ultimo) await apagarArquivo(ctx, { caminho: ultimo }, { ...deps, naMesmaTransacao: apagarSeIgual });
    else await withTenant(ctx, apagarSeIgual, db);
    if (apagou) return;
  }
  throw new ConteudoError({ geral: MSG_CONTEUDO.ocupado });
}

export async function listarConteudosDoPainel(ctx: TenantContext, filtro: { tipo?: TipoConteudo } = {}, db: Db = getDb()): Promise<ConteudoDaLista[]> {
  const rs = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: contents.id, tipo: contents.tipo, titulo: contents.titulo, status: contents.status, visibilidade: contents.visibilidade, publicadoEm: contents.publicadoEm, atualizadoEm: contents.updatedAt })
        .from(contents)
        .where(filtro.tipo ? eq(contents.tipo, filtro.tipo) : undefined)
        .orderBy(desc(contents.updatedAt))
        .limit(200),
    db,
  );
  return rs.map((r) => ({ ...r, tipo: r.tipo as TipoConteudo, status: r.status as ConteudoDaLista['status'], visibilidade: r.visibilidade as Visibilidade }));
}

export async function carregarConteudoDoPainel(ctx: TenantContext, id: string, db: Db = getDb()): Promise<ConteudoDoPainel | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(and(eq(contents.id, id)));
      if (!c) return null;
      const video = videoDoConteudo(c);
      return {
        id: c.id,
        tipo: c.tipo as TipoConteudo,
        titulo: c.titulo,
        resumo: c.resumo,
        corpoMd: c.corpoMd,
        etiquetas: c.etiquetas,
        visibilidade: c.visibilidade as Visibilidade,
        status: c.status as ConteudoDoPainel['status'],
        publicadoEm: c.publicadoEm,
        video,
        link: video ? urlDoVideo(video) : '',
        capaUrl: c.capaPath ? signFileUrl(c.capaPath) : null,
        pdfUrl: c.pdfPath ? signFileUrl(c.pdfPath) : null,
        audiencia: await lerAudiencia(tx, c.id),
      };
    },
    db,
  );
}
