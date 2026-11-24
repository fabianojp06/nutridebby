import { desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { exams } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { foraParaOApp } from '@/modules/exames/classificacao';
import { auditRead } from '@/modules/plataforma/audit';
import { pacienteDaSessao } from './sessao';

/**
 * Plano 22 (T6, US-375, RN-385, RN-386, CS-373, EP-D22; Review Focus 1 e 5): os exames da nutricionista que o paciente vê
 * em "Resultados liberados" (`/p/exames`). Só sessão de paciente (`pacienteDaSessao`). A RLS decide **quais exames**: a
 * política RESTRICTIVE `paciente_exame_liberado` só deixa a sessão de paciente ler o exame com `mostrar_no_app_em` — aqui
 * não há filtro por essa coluna em TypeScript (a contagem do "No app" da ficha conta pela mesma política, RN-387). A
 * projeção decide **quais campos**: id, data, título e, por linha, nome, valor, unidade, referência e "fora" — nunca
 * `iaTarefaId`, o laudo (`arquivo_path`), as faixas, a nota de interpretação ou a categoria do consultório. O laudo não é
 * servido ao portal por nenhuma rota (a linha de `stored_files` tipo `exame` não é listada nem assinada aqui). No portal,
 * só este arquivo consulta `exams`; a IA Nutri não o importa (guarda em `src/modules/exames/guardas.test.ts`). Valores e
 * nomes nunca vão a log.
 */

export type ExameLiberado = {
  id: string;
  data: string;
  titulo: string;
  linhas: { nome: string; valor: number; unidade: string | null; referencia: string | null; fora: boolean | null }[];
};

/** RN-386: a lista do paciente da sessão, da data mais recente para a mais antiga; `auditRead` (entidade `exames`) uma vez com itens. */
export async function examesLiberadosDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<ExameLiberado[]> {
  const patientId = pacienteDaSessao(ctx, 'examesLiberadosDoPaciente');
  const lidos = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: exams.id, data: exams.data, titulo: exams.titulo, valores: exams.valores })
        .from(exams)
        .where(eq(exams.patientId, patientId))
        .orderBy(desc(exams.data), desc(exams.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'exames', entidadeId: null, patientId });
      return r;
    },
    db,
  );
  return lidos.map((e) => ({
    id: e.id,
    data: e.data,
    titulo: e.titulo,
    // projeção fechada por linha: as chaves uma a uma (o `...v` levaria `iaTarefaId` e a faixa ao navegador)
    linhas: e.valores.map((v) => ({ nome: v.nome, valor: v.valor, unidade: v.unidade, referencia: v.referencia, fora: foraParaOApp(v) })),
  }));
}

/** RN-386: o paciente da sessão tem exame liberado? Só existe/não existe (menu do app), sem `auditRead`. */
export async function temExameLiberado(ctx: TenantContext, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'temExameLiberado');
  return withTenant(ctx, (tx) => temExameLiberadoNaTransacao(tx, patientId), db);
}

/**
 * P08-13: o mesmo, dentro da transação da faixa de Hoje (`faixaDeHoje`). Só numa transação de sessão de paciente: é a
 * política `paciente_exame_liberado` que deixa de fora o exame não liberado.
 */
export async function temExameLiberadoNaTransacao(tx: Tx, patientId: string): Promise<boolean> {
  const r = await tx.select({ id: exams.id }).from(exams).where(eq(exams.patientId, patientId)).limit(1);
  return r.length > 0;
}
