import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { diaryEntries, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { avisarComentario } from './avisos';
import { paraRegistro, type RegistroDoDiario } from './diario';
import { COMENTARIO_MAX } from './diario-constantes';

export const MSG_COMENTARIO = {
  vazio: 'Escreva o comentário.',
  tamanho: 'Use no máximo 1000 caracteres.',
  salvo: 'Comentário salvo.',
  naoEncontrado: 'Registro não encontrado.',
  nenhum: 'Nenhum registro de diário ainda.',
} as const;

export class ComentarioError extends Error {
  override name = 'ComentarioError';
  constructor(readonly erros: { comentario: string }) {
    super(erros.comentario);
  }
}

export type ItemDoFeed = RegistroDoDiario & { patientId: string; paciente: string; visto: boolean; somenteLeitura: boolean };

const soNutri = (ctx: TenantContext) => {
  if (ctx.role !== 'nutri') throw new Error('os diários dos pacientes são lidos e comentados só na sessão da nutricionista');
};

// Bloqueado ou anonimizado: só leitura (a mesma regra de carregarPacienteParaEscrita) — a tela esconde o "Comentar"
const colunas = { e: diaryEntries, paciente: patients.nome, somenteLeitura: sql<boolean>`(${patients.status} = 'bloqueado' or ${patients.anonimizadoEm} is not null)` };
const paraItem = (r: { e: typeof diaryEntries.$inferSelect; paciente: string; somenteLeitura: boolean }): ItemDoFeed => ({
  ...paraRegistro(r.e),
  patientId: r.e.patientId,
  paciente: r.paciente,
  visto: r.e.vistoPelaNutriEm !== null,
  somenteLeitura: r.somenteLeitura,
});

/** US-043 "Feed de diários": registros recentes de todos os pacientes, não vistos primeiro. Leitura auditada por paciente. */
export async function feedDeDiarios(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<ItemDoFeed[]> {
  soNutri(ctx);
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select(colunas)
        .from(diaryEntries)
        .innerJoin(patients, eq(patients.id, diaryEntries.patientId))
        .orderBy(sql`${diaryEntries.vistoPelaNutriEm} is not null`, desc(diaryEntries.dataHora))
        .limit(o.limite ?? 50);
      const titulares = [...new Set(r.map((x) => x.e.patientId))];
      if (titulares.length) await auditRead(tx, titulares.map((patientId) => ({ entidade: 'diario', entidadeId: null, patientId })));
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map(paraItem);
}

/** Início (cartão "Diários para ver"): só a contagem — sem auditRead (nenhum registro é devolvido). */
export async function contarDiariosNaoVistos(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  soNutri(ctx);
  return withTenant(ctx, contarDiariosNaoVistosNaTransacao, db);
}

/** Só numa transação de sessão de nutricionista (quem chama confere o papel, como o soNutri). */
export async function contarDiariosNaoVistosNaTransacao(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(diaryEntries).where(isNull(diaryEntries.vistoPelaNutriEm));
  return r.n;
}

/** US-043: abrir o registro preenche `visto_pela_nutri_em` (só na primeira vez). */
export async function abrirRegistro(ctx: TenantContext, id: string, o: { db?: Db; agora?: Date } = {}): Promise<ItemDoFeed | null> {
  soNutri(ctx);
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      await tx.update(diaryEntries).set({ vistoPelaNutriEm: o.agora ?? new Date() }).where(and(eq(diaryEntries.id, id), isNull(diaryEntries.vistoPelaNutriEm)));
      const [r] = await tx.select(colunas).from(diaryEntries).innerJoin(patients, eq(patients.id, diaryEntries.patientId)).where(eq(diaryEntries.id, id));
      if (!r) return null;
      await auditRead(tx, { entidade: 'diario', entidadeId: id, patientId: r.e.patientId });
      return paraItem(r);
    },
    o.db ?? getDb(),
  );
}

/**
 * US-043 "Comentar" / D13: um comentário por registro (corrigível); o push sai só no primeiro. Escrita no prontuário
 * como as outras da nutricionista: o paciente é travado antes (carregarPacienteParaEscrita — mesma ordem de travas:
 * paciente → registro) e bloqueado/anonimizado recusa com PacienteBloqueadoError (US-018 "só para consulta").
 */
export async function comentarRegistro(ctx: TenantContext, id: string, texto: unknown, o: { db?: Db; agora?: Date } = {}): Promise<{ primeiro: boolean }> {
  soNutri(ctx);
  // SUS-110 (regra 3): sem o NUL (22021, com o comentário no log) nem o surrogate sem par
  const comentario = typeof texto === 'string' ? semInvalidosNoBanco(texto).normalize('NFC').trim() : '';
  if (!comentario) throw new ComentarioError({ comentario: MSG_COMENTARIO.vazio });
  if (comentario.length > COMENTARIO_MAX) throw new ComentarioError({ comentario: MSG_COMENTARIO.tamanho });
  if (!idValido(id)) throw new ComentarioError({ comentario: MSG_COMENTARIO.naoEncontrado });
  const agora = o.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [alvo] = await tx.select({ patientId: diaryEntries.patientId }).from(diaryEntries).where(eq(diaryEntries.id, id));
      if (!alvo) throw new ComentarioError({ comentario: MSG_COMENTARIO.naoEncontrado });
      await carregarPacienteParaEscrita(tx, alvo.patientId);
      const [atual] = await tx.select({ patientId: diaryEntries.patientId, comentario: diaryEntries.comentarioNutri }).from(diaryEntries).where(eq(diaryEntries.id, id)).for('update');
      if (!atual) throw new ComentarioError({ comentario: MSG_COMENTARIO.naoEncontrado });
      await tx.update(diaryEntries).set({ comentarioNutri: comentario, comentadoEm: agora, vistoPelaNutriEm: sql`coalesce(${diaryEntries.vistoPelaNutriEm}, ${agora})`, updatedAt: agora }).where(eq(diaryEntries.id, id));
      const primeiro = atual.comentario === null;
      if (primeiro) await avisarComentario(tx, { tenantId: ctx.tenantId, patientId: atual.patientId }, agora);
      return { primeiro };
    },
    o.db ?? getDb(),
  );
}
