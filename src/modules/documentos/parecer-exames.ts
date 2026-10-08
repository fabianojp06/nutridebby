import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissions, exams } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { DocumentoError } from './erros';
import { mesmoExame, MSG_PARECER, type ExameCopiado } from './parecer';

/**
 * RN-148 / RN-154 (Plano 13): a cópia dos exames escolhidos, na transação de quem chama (salvar o rascunho e, por último,
 * o preparo). Só exames do PRÓPRIO paciente (filtro por `patient_id` dentro do withTenant da nutricionista, regra 1): um id
 * de outro paciente, de outro consultório ou excluído é "Um dos exames selecionados foi excluído." e nada é gravado.
 * Copia data, título e as linhas de `valores` como estão (a origem `iaTarefaId` vai junto; Q13-2 ★) e marca o exame que veio
 * de um envio aceito do paciente (Plano 12); NUNCA o laudo (`arquivo_path`). Sem auditRead: nada é devolvido à tela aqui —
 * a seleção do editor já passou por listarExames (auditada).
 */
export async function copiarExames(tx: Tx, patientId: string, ids: readonly string[]): Promise<ExameCopiado[]> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return [];
  const rs = await tx
    .select({ id: exams.id, data: exams.data, titulo: exams.titulo, valores: exams.valores })
    .from(exams)
    .where(and(eq(exams.patientId, patientId), inArray(exams.id, unicos)));
  if (rs.length !== unicos.length) throw new DocumentoError({ exames: MSG_PARECER.exameExcluido });
  const doApp = new Set(
    (await tx.select({ e: examSubmissions.examId }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), inArray(examSubmissions.examId, unicos)))).map((r) => r.e),
  );
  const porId = new Map(rs.map((r) => [r.id, r]));
  return unicos.map((id) => {
    const e = porId.get(id)!;
    return {
      id,
      data: e.data,
      titulo: e.titulo,
      valores: e.valores.map((v) => ({ nome: v.nome, valor: v.valor, unidade: v.unidade, referencia: v.referencia, ...(v.iaTarefaId ? { iaTarefaId: v.iaTarefaId } : {}) })),
      ...(doApp.has(id) ? { enviadoPeloPaciente: true as const } : {}),
    };
  });
}

export type SituacaoExame = 'igual' | 'mudou' | 'excluido';

/**
 * RN-148 v0.5: a tela do parecer compara a cópia guardada com o exame atual (mesmo id: título, data e linhas), sem gravar
 * nada. Devolve só a situação por id da cópia — nenhum valor sai daqui (D-P2: sem auditRead; a página já audita a leitura
 * do documento). Exame de outro paciente (id forjado) conta como excluído.
 */
export async function situacaoDosExames(ctx: TenantContext, patientId: string, copia: readonly ExameCopiado[], db: Db = getDb()): Promise<Record<string, SituacaoExame>> {
  if (!copia.length || !idValido(patientId)) return {};
  return withTenant(
    ctx,
    async (tx) => {
      const atuais = await tx
        .select({ id: exams.id, data: exams.data, titulo: exams.titulo, valores: exams.valores })
        .from(exams)
        .where(and(eq(exams.patientId, patientId), inArray(exams.id, copia.map((e) => e.id))));
      const porId = new Map(atuais.map((a) => [a.id, a]));
      return Object.fromEntries(copia.map((e) => {
        const a = porId.get(e.id);
        return [e.id, !a ? 'excluido' : mesmoExame(e, a) ? 'igual' : 'mudou'] as const;
      }));
    },
    db,
  );
}
