import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaNutriMensagens, notifications, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { ROTULO_CATEGORIA, type Autor, type CategoriaConversa } from './constantes';
import type { CodigoTextoFixo } from './textos';

/**
 * Plano 15 (US-175, §7.5, D22, D24 = b): o lado da equipe — a fila "Dúvidas dos pacientes", abrir a dúvida, "Marcar como
 * vista", a conversa na aba "IA Nutri" da ficha e o contador do menu. Tudo na sessão `nutri` (withTenant com ator e IP); o
 * gatilho ia_nutri_mensagens_regras só deixa a equipe abrir e resolver, em nome da própria usuária.
 */

export type SeloDaDuvida = 'risco' | 'risco_revogado' | 'aviso_minimo';
export type ItemDaFila = { id: string; patientId: string; paciente: string; criadaEm: Date; selo: SeloDaDuvida | null };
export type DuvidaAberta = {
  id: string;
  patientId: string;
  paciente: string;
  criadaEm: Date;
  texto: string | null;
  resposta: { texto: string | null; textoFixo: CodigoTextoFixo | null; categoria: string | null } | null;
  selo: ItemDaFila['selo'];
  resolvida: boolean;
};
export type MensagemNaFicha = {
  id: string;
  criadaEm: Date;
  autor: Autor;
  texto: string | null;
  textoFixo: CodigoTextoFixo | null;
  categoria: string | null;
  risco: boolean;
  avaliacao: 'ajudou' | 'nao_ajudou' | null;
  duvida: 'aberta' | 'vista' | 'encerrada' | null;
};

/** A pergunta encaminhada à nutricionista e ainda não resolvida (o índice parcial ia_nutri_mensagens_fila_idx). */
const aberta = and(eq(iaNutriMensagens.autor, 'paciente'), isNotNull(iaNutriMensagens.encaminhadaEm), isNull(iaNutriMensagens.resolvidaEm));

/** D22: com risco de quem revogou, com texto → mostrada uma vez e apagada ao abrir; sem texto (depois de 30 dias) → aviso mínimo. */
const seloDe = (m: { risco: string | null; revogadaEm: Date | null; texto: string | null }): SeloDaDuvida | null =>
  !m.risco ? null : !m.revogadaEm ? 'risco' : m.texto ? 'risco_revogado' : 'aviso_minimo';

const situacaoDaDuvida = (m: { encaminhadaEm: Date | null; resolucao: string | null }): MensagemNaFicha['duvida'] =>
  !m.encaminhadaEm ? null : m.resolucao === 'vista' ? 'vista' : m.resolucao === 'encerrada' ? 'encerrada' : 'aberta';
const rotuloDaCategoria = (c: string | null): string | null => (c ? (ROTULO_CATEGORIA[c as CategoriaConversa] ?? null) : null);

/** US-175 "Fila": as dúvidas abertas, "Sinal de risco" primeiro e depois as mais antigas. Só lista (sem auditRead, como "Exames recebidos"). */
export async function filaDeDuvidas(ctx: TenantContext, db: Db = getDb()): Promise<ItemDaFila[]> {
  const r = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: iaNutriMensagens.id, patientId: iaNutriMensagens.patientId, paciente: patients.nome, criadaEm: iaNutriMensagens.createdAt, risco: iaNutriMensagens.risco, revogadaEm: iaNutriMensagens.revogadaEm, texto: iaNutriMensagens.texto })
        .from(iaNutriMensagens)
        .innerJoin(patients, eq(patients.id, iaNutriMensagens.patientId))
        .where(aberta)
        .orderBy(sql`(${iaNutriMensagens.risco} is null)`, asc(iaNutriMensagens.createdAt), asc(iaNutriMensagens.id)),
    db,
  );
  return r.map(({ risco, revogadaEm, texto, ...x }) => ({ ...x, selo: seloDe({ risco, revogadaEm, texto }) }));
}

/** US-175: "Dúvidas dos pacientes (n)" no menu. Só contagem. */
export async function contadorDeDuvidas(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  const [{ n }] = await withTenant(ctx, (tx) => tx.select({ n: count() }).from(iaNutriMensagens).where(aberta), db);
  return n;
}

/**
 * US-175: abrir a dúvida — "Visualizou — IA Nutri (conversa com o paciente)" (auditRead) e `aberta_pela_nutri_em` (uma
 * vez). D22: a pergunta com risco de quem revogou é mostrada uma vez e apagada na mesma transação (o gatilho de DELETE só
 * deixa a equipe apagar essa, depois de aberta; o SET NULL de `responde_a` da mensagem que aponta para ela passa pelo
 * gatilho de colunas como ação referencial). Ordem DP-10: o paciente primeiro (FOR SHARE), depois a mensagem (FOR UPDATE).
 * Id inválido, de outro consultório, resposta da IA ou pergunta não encaminhada → null.
 */
export async function abrirDuvida(ctx: TenantContext, id: string, db: Db = getDb()): Promise<DuvidaAberta | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [dono] = await tx.select({ patientId: iaNutriMensagens.patientId }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, id));
      if (!dono) return null;
      await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, dono.patientId)).for('share');
      const [m] = await tx
        .select({ m: iaNutriMensagens, paciente: patients.nome })
        .from(iaNutriMensagens)
        .innerJoin(patients, eq(patients.id, iaNutriMensagens.patientId))
        .where(and(eq(iaNutriMensagens.id, id), eq(iaNutriMensagens.autor, 'paciente'), isNotNull(iaNutriMensagens.encaminhadaEm)))
        .for('update', { of: iaNutriMensagens });
      if (!m) return null;
      if (!m.m.abertaPelaNutriEm) await tx.update(iaNutriMensagens).set({ abertaPelaNutriEm: new Date(), updatedAt: new Date() }).where(eq(iaNutriMensagens.id, id));
      const [r] = await tx
        .select({ texto: iaNutriMensagens.texto, textoFixo: iaNutriMensagens.textoFixo, categoria: iaNutriMensagens.categoria })
        .from(iaNutriMensagens)
        .where(eq(iaNutriMensagens.respondeA, id))
        .orderBy(desc(iaNutriMensagens.createdAt), desc(iaNutriMensagens.id))
        .limit(1);
      await auditRead(tx, { entidade: 'ia_nutri', entidadeId: id, patientId: m.m.patientId });
      const selo = seloDe(m.m);
      if (selo === 'risco_revogado') await tx.delete(iaNutriMensagens).where(eq(iaNutriMensagens.id, id)); // D22: apagada ao abrir
      return {
        id,
        patientId: m.m.patientId,
        paciente: m.paciente,
        criadaEm: m.m.createdAt,
        texto: m.m.texto,
        resposta: r ? { texto: r.texto, textoFixo: (r.textoFixo as CodigoTextoFixo | null) ?? null, categoria: rotuloDaCategoria(r.categoria) } : null,
        selo,
        resolvida: !!m.m.resolvidaEm,
      };
    },
    db,
  );
}

/**
 * US-175 "Marcar como vista" (D24 = b): o paciente vê no app "Sua dúvida foi vista no consultório." e recebe o push neutro;
 * nenhum texto livre da nutricionista vai pela plataforma. Ordem DP-10: lê o paciente da mensagem, trava o paciente (FOR
 * SHARE) e só então o UPDATE e o INSERT em notifications (filha de patients) — sem ciclo com a revogação, que trava o
 * paciente antes das mensagens. O aviso mínimo de quem desativou a IA Nutri (D22 b) resolve sem push: a conversa dele foi
 * apagada e não há o que ver no app. Já resolvida, apagada ou de outro consultório → false.
 */
export async function marcarComoVista(ctx: TenantContext, id: string, deps: { db?: Db; agora?: Date } = {}): Promise<boolean> {
  if (!idValido(id)) return false;
  if (ctx.role !== 'nutri' || !ctx.actorUserId) throw new Error('marcarComoVista: só a sessão da nutricionista');
  const agora = deps.agora ?? new Date();
  const nutri = ctx.actorUserId;
  return withTenant(
    ctx,
    async (tx) => {
      const [dono] = await tx.select({ patientId: iaNutriMensagens.patientId }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, id));
      if (!dono) return false;
      await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, dono.patientId)).for('share');
      const [m] = await tx
        .update(iaNutriMensagens)
        .set({ abertaPelaNutriEm: sql`coalesce(${iaNutriMensagens.abertaPelaNutriEm}, now())`, resolvidaEm: agora, resolvidaPor: nutri, resolucao: 'vista', updatedAt: agora })
        .where(and(eq(iaNutriMensagens.id, id), aberta))
        .returning({ patientId: iaNutriMensagens.patientId, revogadaEm: iaNutriMensagens.revogadaEm });
      if (!m) return false;
      if (!m.revogadaEm) await avisarDuvidaVista(tx, { tenantId: ctx.tenantId, patientId: m.patientId }, agora);
      return true;
    },
    deps.db ?? getDb(),
  );
}

/**
 * INT-03 / RNF-166: o push neutro "Há uma atualização para você no app." (tipo duvida_vista, tela /p/plano/ia), na
 * transação do evento. O motor decide a entrega (paciente ativo, com conta e push ativo — senão "ignorada").
 */
export async function avisarDuvidaVista(tx: Tx, o: { tenantId: string; patientId: string }, agora: Date): Promise<void> {
  await tx.insert(notifications).values({ tenantId: o.tenantId, patientId: o.patientId, canal: 'push', tipo: 'duvida_vista', agendadaPara: agora });
  await dispararEnvio(tx, o.tenantId);
}

/**
 * US-175 "Ver a conversa" (D7 = a): a aba "IA Nutri" da ficha — auditada (ler, entidade `ia_nutri`). Projeção fechada: nunca
 * fontes, modelo, versão do prompt, custo nem motivo técnico. Mesma ordem da tela do paciente (a pergunta antes da resposta
 * gravada no mesmo instante).
 */
export async function conversaNaFicha(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<MensagemNaFicha[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      // paciente de outro consultório (a RLS esconde): nada, nem a linha de auditoria com o id dele
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId));
      if (!p) return [];
      const ms = await tx
        .select({
          id: iaNutriMensagens.id,
          criadaEm: iaNutriMensagens.createdAt,
          autor: iaNutriMensagens.autor,
          texto: iaNutriMensagens.texto,
          textoFixo: iaNutriMensagens.textoFixo,
          categoria: iaNutriMensagens.categoria,
          risco: iaNutriMensagens.risco,
          avaliacao: iaNutriMensagens.avaliacao,
          encaminhadaEm: iaNutriMensagens.encaminhadaEm,
          resolucao: iaNutriMensagens.resolucao,
        })
        .from(iaNutriMensagens)
        .where(eq(iaNutriMensagens.patientId, patientId))
        .orderBy(asc(iaNutriMensagens.createdAt), sql`case ${iaNutriMensagens.autor} when 'paciente' then 0 else 1 end`, asc(iaNutriMensagens.id));
      await auditRead(tx, { entidade: 'ia_nutri', entidadeId: null, patientId });
      return ms.map(
        (m): MensagemNaFicha => ({
          id: m.id,
          criadaEm: m.criadaEm,
          autor: m.autor as Autor,
          texto: m.texto,
          textoFixo: (m.textoFixo as CodigoTextoFixo | null) ?? null,
          categoria: rotuloDaCategoria(m.categoria),
          risco: !!m.risco,
          avaliacao: (m.avaliacao as 'ajudou' | 'nao_ajudou' | null) ?? null,
          duvida: situacaoDaDuvida(m),
        }),
      );
    },
    db,
  );
}
