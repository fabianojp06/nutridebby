import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examInterpretacoes, exams } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead, nomesDosAtores, recordAudit } from '@/modules/plataforma/audit';
import { exigirNutri } from './catalogo';
import { MSG_EXAMES, NOTA_MAX } from './constantes';

/**
 * Plano 22 (T5a, US-373, RN-383; EP-D18, EP-D19, EP-D41, EP-D61): a nota de interpretação do exame, escrita pela
 * nutricionista, **só de inclusão** — cada "Salvar nota" grava uma versão nova (`versao` = maior + 1) e "Apagar nota"
 * grava uma versão com `texto` nulo; a em vigor é a de maior versão (lida por `abrirExame`). Autor e hora pelo gatilho
 * `exam_interpretacoes_regras`; a inclusão é auditada pelo gatilho (entidade `exames_nota`). Fica FORA de
 * `src/modules/pacientes/exames.ts` (que a IA alcança): a nota nunca vai ao app, ao PDF, à IA nem ao comparativo; sai só
 * no `dados.json` (EP-D19). O texto nunca vai a log nem a mensagem de erro técnica (RNF-370).
 *
 * Travas (RN-383, a ordem de `editarExame` e `excluirExame`): paciente (`carregarPacienteParaEscrita`, `FOR UPDATE`,
 * recusa bloqueado e anonimizado) → exame `FOR NO KEY UPDATE` pelos dois ids (sem linha → "Exame não encontrado.", nunca
 * o 23503 cru da FK com um `excluirExame` concorrente) → a nota. A trava do paciente serializa duas notas do mesmo exame.
 */

export class NotaError extends Error {
  override name = 'NotaError';
  constructor(readonly erros: Record<string, string>) {
    super('Nota inválida');
  }
}

const N = MSG_EXAMES.nota;
const NAO_ENCONTRADO = MSG_EXAMES.erros.naoEncontrado;
/** O mesmo texto do Histórico de acessos (`listAccessHistory`) para quem não tem mais conta. */
const USUARIO_REMOVIDO = 'Usuário removido';

/** O texto da nota: sem espaços nas pontas, sem NUL (o Postgres não guarda), de 1 a 2000 code points (o CHECK conta assim). */
function lerTexto(v: unknown): string {
  const t = typeof v === 'string' ? v.replaceAll('\u0000', '').trim() : '';
  if (!t) throw new NotaError({ texto: N.vazia });
  if ([...t].length > NOTA_MAX) throw new NotaError({ texto: N.max });
  return t;
}

/** Paciente → exame (as travas da RN-383) e a última versão da nota, na transação de quem grava. */
async function travarParaNota(tx: Tx, patientId: string, exameId: string) {
  const p = await carregarPacienteParaEscrita(tx, patientId);
  const [e] = await tx
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.id, exameId), eq(exams.patientId, p.id)))
    .for('no key update');
  if (!e) throw new NotaError({ geral: NAO_ENCONTRADO });
  const [ultima] = await tx
    .select({ versao: examInterpretacoes.versao, texto: examInterpretacoes.texto })
    .from(examInterpretacoes)
    .where(and(eq(examInterpretacoes.examId, e.id), eq(examInterpretacoes.patientId, p.id)))
    .orderBy(desc(examInterpretacoes.versao))
    .limit(1);
  return { patientId: p.id, exameId: e.id, ultima };
}

async function inserirVersao(tx: Tx, ctx: TenantContext, alvo: { patientId: string; exameId: string; ultima?: { versao: number } }, texto: string | null) {
  await tx.insert(examInterpretacoes).values({
    tenantId: ctx.tenantId,
    patientId: alvo.patientId,
    examId: alvo.exameId,
    versao: (alvo.ultima?.versao ?? 0) + 1,
    texto,
    // ignorados: o gatilho exam_interpretacoes_regras grava a usuária da sessão e o relógio do banco
    criadoPor: sql`app_current_user()`,
    criadoEm: sql`clock_timestamp()`,
  });
}

/** "Salvar nota" (US-373): uma versão nova com o texto (1 a 2000). `NotaError` com `texto` ou `geral`. */
export async function salvarNota(ctx: TenantContext, patientId: string, exameId: string, texto: unknown, deps: { db?: Db } = {}): Promise<void> {
  exigirNutri(ctx);
  const t = lerTexto(texto);
  if (!idValido(exameId)) throw new NotaError({ geral: NAO_ENCONTRADO });
  await withTenant(
    ctx,
    async (tx) => {
      const alvo = await travarParaNota(tx, patientId, exameId);
      await inserirVersao(tx, ctx, alvo, t);
    },
    deps.db ?? getDb(),
  );
}

/**
 * "Apagar nota" (US-373): uma versão nova com `texto` nulo e, na mesma transação, um `excluir` de `exames_nota` com o id
 * do exame (EP-D61: o Histórico mostra "Excluiu · Nota de interpretação do exame"; o `criar` do gatilho da linha nula
 * fica, porque é a inclusão que aconteceu). Sem nota em vigor (nenhuma, ou já apagada), nada é gravado.
 */
export async function apagarNota(ctx: TenantContext, patientId: string, exameId: string, deps: { db?: Db } = {}): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(exameId)) throw new NotaError({ geral: NAO_ENCONTRADO });
  await withTenant(
    ctx,
    async (tx) => {
      const alvo = await travarParaNota(tx, patientId, exameId);
      if (!alvo.ultima || alvo.ultima.texto === null) return;
      await inserirVersao(tx, ctx, alvo, null);
      await recordAudit(tx, { acao: 'excluir', entidade: 'exames_nota', entidadeId: alvo.exameId, patientId: alvo.patientId });
    },
    deps.db ?? getDb(),
  );
}

export type NotaAnterior = { versao: number; texto: string | null; por: string; em: Date };

/**
 * "Notas anteriores" (em "Versões anteriores"; I3, R22-04, M8): as versões da nota **antes da em vigor**, da mais nova
 * para a mais antiga (`texto` nulo = um "Apagar nota"), pelos dois ids. Quando devolve ao menos uma, `auditRead` (entidade
 * `exames_nota`) na mesma transação da leitura; sem nota anterior, nenhum `ler`. O nome de quem escreveu vem de
 * `nomesDosAtores`, fora da transação; sem conta → "Usuário removido".
 */
export async function notasAnteriores(ctx: TenantContext, patientId: string, exameId: string, deps: { db?: Db } = {}): Promise<NotaAnterior[]> {
  exigirNutri(ctx);
  if (!idValido(patientId) || !idValido(exameId)) return [];
  const db = deps.db ?? getDb();
  const anteriores = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select({ id: exams.id }).from(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, patientId)));
      if (!e) return [];
      const todas = await tx
        .select({ versao: examInterpretacoes.versao, texto: examInterpretacoes.texto, criadoPor: examInterpretacoes.criadoPor, criadoEm: examInterpretacoes.criadoEm })
        .from(examInterpretacoes)
        .where(and(eq(examInterpretacoes.examId, e.id), eq(examInterpretacoes.patientId, patientId)))
        .orderBy(desc(examInterpretacoes.versao));
      const lista = todas.slice(1);
      if (lista.length) await auditRead(tx, { entidade: 'exames_nota', entidadeId: e.id, patientId });
      return lista;
    },
    db,
  );
  if (!anteriores.length) return [];
  const nomes = await nomesDosAtores(db, anteriores.map((n) => n.criadoPor));
  return anteriores.map((n) => ({ versao: n.versao, texto: n.texto, por: nomes.get(n.criadoPor)?.nome ?? USUARIO_REMOVIDO, em: n.criadoEm }));
}
