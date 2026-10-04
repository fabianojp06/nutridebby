import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { contentFavorites, contents, contentViews } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { signFileUrl } from '@/lib/signed-url';
import { liberarReceitasDoPlano } from '@/modules/conteudo/audiencia';
import { FEED_LIMITE, MSG_PORTAL_CONTEUDO, type TipoConteudo } from '@/modules/conteudo/constantes';
import { nutrientesPorPorcao, textoPorPorcao } from '@/modules/conteudo/receita-calculo';
import { lerReceitaNaTransacao, type ReceitaLida } from '@/modules/conteudo/receitas';
import { videoDoConteudo, type VideoDoLink } from '@/modules/conteudo/video';
import { idValido } from '@/modules/pacientes/base';
import { pacienteDaSessao } from './sessao';

export type FiltroDoFeed = { tipo?: TipoConteudo; busca?: string; etiqueta?: string; favoritos?: boolean };
export type ItemDoFeed = { id: string; tipo: TipoConteudo; titulo: string; resumo: string; capaUrl: string | null; publicadoEm: Date; novo: boolean; favorito: boolean };
export type ConteudoDoPaciente = {
  id: string;
  tipo: TipoConteudo;
  titulo: string;
  resumo: string;
  corpoMd: string;
  capaUrl: string | null;
  video: VideoDoLink | null;
  temPdf: boolean;
  favorito: boolean;
  receita: ReceitaLida | null;
  /** "Por porção: …" (RN-11) ou null fora da receita. */
  porPorcao: string | null;
  /**
   * US-054: receita fora da audiência, aberta pelo cartão do plano publicado (`?de=plano`). A página não mostra
   * "Favoritar" nem registra a visualização (o banco recusaria; D14: não conta) e volta para "Meu plano".
   */
  soPeloPlano: boolean;
};

const BUSCA_MAX = 100;

/** R6: o Postgres recusa NUL em `text` (SQLSTATE 22021) — `?busca=%00` daria 500 no portal. */
const semNul = (s: string) => s.replaceAll('\0', '');

/** O termo e a etiqueta como o feed os usa: sem NUL, e a busca com pelo menos 2 caracteres (senão, sem filtro). */
const termoDaBusca = (busca: string | undefined) => semNul(busca ?? '').trim().slice(0, BUSCA_MAX);
const buscaFiltra = (termo: string) => termo.length >= 2;

/**
 * O texto da lista vazia: com busca, etiqueta ou tipo que de fato filtram — também em "Favoritos" — é "Nenhum conteúdo
 * encontrado."; "Você ainda não favoritou…" só quando não há favorito nenhum.
 */
export function mensagemDoFeedVazio(filtro: FiltroDoFeed): string {
  const filtrando = Boolean(filtro.tipo || buscaFiltra(termoDaBusca(filtro.busca)) || semNul(filtro.etiqueta ?? ''));
  if (filtrando) return MSG_PORTAL_CONTEUDO.semResultado;
  return filtro.favoritos ? MSG_PORTAL_CONTEUDO.semFavoritos : MSG_PORTAL_CONTEUDO.vazio;
}

/**
 * US-055: o feed. A RLS já entrega só o publicado da audiência (D2) — aqui só os filtros, o "Novo" (sem visualização
 * do próprio paciente) e os favoritos. NUNCA chama `liberarReceitasDoPlano`: a receita sugerida no plano, fora da
 * audiência, não entra no feed, na busca nem no filtro de etiquetas (US-054 só abre pelo cartão). Não é prontuário:
 * sem auditoria (D6). Busca full-text (D19).
 */
export async function feedDeConteudos(ctx: TenantContext, filtro: FiltroDoFeed = {}, db: Db = getDb()): Promise<{ itens: ItemDoFeed[]; etiquetas: string[] }> {
  const patientId = pacienteDaSessao(ctx, 'feedDeConteudos');
  const termo = termoDaBusca(filtro.busca);
  const etiqueta = semNul(filtro.etiqueta ?? '');
  // Qualificado à mão: na lista do SELECT de uma tabela só, o drizzle escreve `"id"` sem a tabela, e dentro da subconsulta
  // ele casaria com `v.id`/`f.id` (o "Novo" e o favorito sairiam sempre errados).
  const idDoConteudo = sql`${contents}.${sql.identifier(contents.id.name)}`;
  const visto = sql<boolean>`exists (select 1 from ${contentViews} v where v.content_id = ${idDoConteudo} and v.patient_id = ${patientId})`;
  const favorito = sql<boolean>`exists (select 1 from ${contentFavorites} f where f.content_id = ${idDoConteudo} and f.patient_id = ${patientId})`;
  const condicoes: SQL[] = [eq(contents.status, 'publicado')];
  if (filtro.tipo) condicoes.push(eq(contents.tipo, filtro.tipo));
  if (etiqueta) condicoes.push(sql`${contents.etiquetas} @> array[${etiqueta}]::text[]`);
  if (buscaFiltra(termo))
    condicoes.push(sql`to_tsvector('portuguese', app_unaccent(${contents.titulo} || ' ' || ${contents.resumo})) @@ websearch_to_tsquery('portuguese', app_unaccent(${termo}))`);
  if (filtro.favoritos) condicoes.push(favorito);
  return withTenant(
    ctx,
    async (tx) => {
      const rs = await tx
        .select({ id: contents.id, tipo: contents.tipo, titulo: contents.titulo, resumo: contents.resumo, capaPath: contents.capaPath, publicadoEm: contents.publicadoEm, visto, favorito })
        .from(contents)
        .where(and(...condicoes))
        .orderBy(desc(contents.publicadoEm), desc(contents.id))
        .limit(FEED_LIMITE);
      const e = await tx.execute(sql`select coalesce(array_agg(distinct x order by x), '{}') as etiquetas from ${contents}, unnest(${contents.etiquetas}) as x where ${contents.status} = 'publicado'`);
      return {
        itens: rs.map((r) => ({
          id: r.id,
          tipo: r.tipo as TipoConteudo,
          titulo: r.titulo,
          resumo: r.resumo,
          capaUrl: r.capaPath ? signFileUrl(r.capaPath) : null,
          publicadoEm: r.publicadoEm!,
          novo: !r.visto,
          favorito: r.favorito,
        })),
        etiquetas: (e.rows[0] as { etiquetas: string[] }).etiquetas,
      };
    },
    db,
  );
}

/**
 * O conteúdo aberto pelo paciente; fora da audiência (ou id inválido) → null, e a página responde 404 (US-053).
 * `doPlano` (o link do cartão "Sugestão de receita", US-054): se a audiência não o mostra, liga a liberação das receitas
 * do plano NESTA transação e tenta de novo — a RLS só a entrega se for receita de refeição do plano publicado dele.
 */
export async function conteudoDoPaciente(ctx: TenantContext, id: string, db: Db = getDb(), o: { doPlano?: boolean } = {}): Promise<ConteudoDoPaciente | null> {
  const patientId = pacienteDaSessao(ctx, 'conteudoDoPaciente');
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const ler = () => tx.select().from(contents).where(and(eq(contents.id, id), eq(contents.status, 'publicado')));
      let [c] = await ler();
      let soPeloPlano = false;
      if (!c && o.doPlano) {
        await liberarReceitasDoPlano(tx);
        [c] = await ler();
        soPeloPlano = Boolean(c);
      }
      if (!c) return null;
      const [fav] = await tx.select({ id: contentFavorites.id }).from(contentFavorites).where(and(eq(contentFavorites.contentId, id), eq(contentFavorites.patientId, patientId)));
      const receita = c.tipo === 'receita' ? await lerReceitaNaTransacao(tx, id) : null;
      const n = receita ? nutrientesPorPorcao(receita.ingredientes, receita.rendimentoG, receita.porcaoG) : null;
      return {
        id: c.id,
        tipo: c.tipo as TipoConteudo,
        titulo: c.titulo,
        resumo: c.resumo,
        corpoMd: c.corpoMd,
        capaUrl: c.capaPath ? signFileUrl(c.capaPath) : null,
        video: videoDoConteudo(c),
        temPdf: Boolean(c.pdfPath),
        favorito: Boolean(fav),
        receita,
        porPorcao: n ? textoPorPorcao(n) : null,
        soPeloPlano,
      };
    },
    db,
  );
}

/** D18: uma visualização por paciente (ON CONFLICT DO NOTHING). Conteúdo que ele não vê → false (o banco também recusa). O filtro
 * de publicado repete a RLS por clareza (D2), como no feed e no detalhe. */
export async function registrarVisualizacao(ctx: TenantContext, id: string, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'registrarVisualizacao');
  if (!idValido(id)) return false;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ id: contents.id }).from(contents).where(and(eq(contents.id, id), eq(contents.status, 'publicado')));
      if (!c) return false;
      await tx.insert(contentViews).values({ tenantId: ctx.tenantId, contentId: id, patientId }).onConflictDoNothing();
      return true;
    },
    db,
  );
}

/** US-055 "Favoritos": marca ou desmarca. Conteúdo que ele não vê → false. */
export async function marcarFavorito(ctx: TenantContext, id: string, favorito: boolean, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'marcarFavorito');
  if (!idValido(id)) return false;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ id: contents.id }).from(contents).where(and(eq(contents.id, id), eq(contents.status, 'publicado')));
      if (!c) return false;
      if (favorito) await tx.insert(contentFavorites).values({ tenantId: ctx.tenantId, contentId: id, patientId }).onConflictDoNothing();
      else await tx.delete(contentFavorites).where(and(eq(contentFavorites.contentId, id), eq(contentFavorites.patientId, patientId)));
      return true;
    },
    db,
  );
}

/** US-052 "Baixar material (PDF)": o caminho interno, para a rota assinar na hora do clique (D20). */
export async function caminhoDoPdfDoConteudo(ctx: TenantContext, id: string, db: Db = getDb()): Promise<string | null> {
  pacienteDaSessao(ctx, 'caminhoDoPdfDoConteudo');
  if (!idValido(id)) return null;
  const [c] = await withTenant(ctx, (tx) => tx.select({ pdfPath: contents.pdfPath }).from(contents).where(and(eq(contents.id, id), eq(contents.tipo, 'orientacao'), eq(contents.status, 'publicado'))), db);
  return c?.pdfPath ?? null;
}
