import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { examVersoes, exams } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida, hojeNoFuso } from '@/modules/pacientes/datas';
import { ExameError, lerLinhasComErros, MSG_EXAME, type ValorExame } from '@/modules/pacientes/exames';
import { auditRead, nomesDosAtores } from '@/modules/plataforma/audit';
import { catalogoParaLancamentoNaTransacao, exigirNutri, type ItemParaLancamento } from './catalogo';
import { MSG_EXAMES } from './constantes';

/**
 * Plano 22 (T4, US-371, RN-378; EP-D21, EP-D41, EP-D62): ler para editar, editar com versão e "Versões anteriores".
 * Fica FORA de `src/modules/pacientes/exames.ts` (que `ia/conferencia.ts` importa): nada que leia ou grave `exam_versoes`
 * fica ao alcance da IA (RN-399). Só a sessão `nutri` (`exam_versoes` é staff_only: numa sessão de paciente a leitura
 * voltaria vazia em silêncio, por isso o assert vem antes da transação). Toda leitura é pelos dois ids (exame **e**
 * paciente, M8): sem linha → `null` e nenhum `auditRead` (a trilha nunca atribui a leitura ao titular errado). Valores,
 * títulos e justificativas nunca vão a log nem à mensagem de erro técnica (RNF-370).
 */

const E = MSG_EXAMES.lancamentoErros;
const NAO_ENCONTRADO = MSG_EXAMES.erros.naoEncontrado;
/** O mesmo texto do Histórico de acessos (`listAccessHistory`) para quem não tem mais conta. */
const USUARIO_REMOVIDO = 'Usuário removido';
const JUSTIFICATIVA_MIN = 5;
const JUSTIFICATIVA_MAX = 500;

export type ExameParaEditar = {
  id: string;
  titulo: string;
  data: string;
  valores: ValorExame[];
  /** `updated_at` lido, em `toISOString()` (milissegundos, como o Date do JS): volta como `lidoEm` (M3). */
  updatedAt: string;
  noAppEm: Date | null;
  catalogo: ItemParaLancamento[];
};

/**
 * "Editar exame": o exame pelos dois ids e o catálogo, numa transação, com o `auditRead` (entidade `exames`) na mesma
 * transação. Exame de outro paciente, de outro consultório ou excluído → `null`, sem `ler`.
 */
export async function exameParaEditar(ctx: TenantContext, patientId: string, exameId: string, deps: { db?: Db } = {}): Promise<ExameParaEditar | null> {
  exigirNutri(ctx);
  if (!idValido(patientId) || !idValido(exameId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select().from(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, patientId)));
      if (!e) return null;
      const catalogo = await catalogoParaLancamentoNaTransacao(tx);
      await auditRead(tx, { entidade: 'exames', entidadeId: e.id, patientId: e.patientId });
      return { id: e.id, titulo: e.titulo, data: e.data, valores: e.valores, updatedAt: e.updatedAt.toISOString(), noAppEm: e.mostrarNoAppEm, catalogo };
    },
    deps.db ?? getDb(),
  );
}

/** Uma linha do formulário de edição: `origem` é o índice da linha gravada que ela continua (`null` = linha nova). */
export type LinhaEditada = { origem: number | null; nome: unknown; valor: unknown; unidade: unknown; referencia: unknown; refMin: unknown; refMax: unknown };

/** A linha como o banco a compara: as chaves opcionais ausentes valem `null` (a ordem das chaves do jsonb não conta). */
const chaveDaLinha = (v: ValorExame) => JSON.stringify([v.nome, v.valor, v.unidade, v.referencia, v.iaTarefaId ?? null, v.refMin ?? null, v.refMax ?? null]);

/** Justificativa (RN-378): 5 a 500 caracteres (code points), sem NUL; vazia → `null`; inválida → `undefined`. */
function lerJustificativa(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  if (v.includes('\u0000')) return undefined;
  const t = v.trim();
  if (!t) return null;
  // por code point, como o CHECK `char_length` (0127): "🙂🙂🙂" tem 3, não 6 (a recusa nunca chega ao banco nem ao log)
  const tamanho = [...t].length;
  return tamanho >= JUSTIFICATIVA_MIN && tamanho <= JUSTIFICATIVA_MAX ? t : undefined;
}

/**
 * US-371 "Editar exame" (RN-378): título, data e linhas; o laudo não muda (EP-D44). Valida tudo antes da transação (as
 * mensagens de hoje e as de "Lançamento: erros"); depois, a ordem de travas da conferência da IA e de `excluirExame`:
 * paciente (`carregarPacienteParaEscrita`, `FOR UPDATE`, recusa bloqueado e anonimizado) → exame `FOR NO KEY UPDATE`
 * pelos dois ids. Concorrência otimista: `lidoEm` × `updated_at` comparados em TypeScript (o banco guarda microssegundos;
 * o Date, milissegundos — M3). A origem da IA (`iaTarefaId`) só é copiada aqui, de `e.valores[origem]`, sob a trava; a
 * linha com origem mantém nome, valor e unidade da original (só faixa e referência mudam). Na mesma transação, a versão
 * de antes vai para `exam_versoes` (`versao` = maior + 1; autor e hora pelo gatilho `exam_versoes_regras`) e o exame é
 * atualizado. Justificativa obrigatória, salvo quando a edição só acrescenta linhas.
 */
export async function editarExame(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  exameId: string,
  input: { titulo: unknown; data: unknown; linhas: LinhaEditada[]; justificativa: unknown; lidoEm: string },
  deps: { db?: Db; agora?: Date } = {},
): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(exameId)) throw new ExameError({ geral: NAO_ENCONTRADO });
  const agora = deps.agora ?? new Date();
  const erros: Record<string, string> = {};
  const titulo = normalizarTexto(input.titulo).slice(0, 120);
  if (!titulo) erros.titulo = MSG_EXAME.titulo;
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_EXAME.data;
  else if (data > hojeNoFuso(tenant.fuso, agora)) erros.data = MSG_EXAME.futuro;
  const brutas = Array.isArray(input.linhas) ? input.linhas : null;
  // só os campos da linha: `origem` vai à parte e qualquer `iaTarefaId` do formulário fica de fora
  const lidas = lerLinhasComErros(brutas?.map((l) => ({ nome: l?.nome, valor: l?.valor, unidade: l?.unidade, referencia: l?.referencia, refMin: l?.refMin, refMax: l?.refMax })));
  if ('erros' in lidas) Object.assign(erros, lidas.erros);
  const justificativa = lerJustificativa(input.justificativa);
  if (Object.keys(erros).length || !('linhas' in lidas) || !brutas) throw new ExameError(erros);

  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [e] = await tx.select().from(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, p.id))).for('no key update');
      if (!e) throw new ExameError({ geral: NAO_ENCONTRADO });
      if (e.updatedAt.toISOString() !== input.lidoEm) throw new ExameError({ geral: E.mudou });

      const usadas = new Set<number>();
      const valores = lidas.linhas.map(({ indice, valor }): ValorExame => {
        const origem = brutas[indice]?.origem;
        const valida = typeof origem === 'number' && Number.isInteger(origem) && origem >= 0 && origem < e.valores.length && !usadas.has(origem);
        if (!valida) return valor;
        usadas.add(origem);
        const original = e.valores[origem];
        if (!original.iaTarefaId) return valor;
        // RN-378: a linha da IA tem nome, valor e unidade fixos; a origem vem da linha gravada, nunca do formulário
        const v: ValorExame = { nome: original.nome, valor: original.valor, unidade: original.unidade, referencia: valor.referencia, iaTarefaId: original.iaTarefaId };
        if (valor.refMin !== undefined) v.refMin = valor.refMin;
        if (valor.refMax !== undefined) v.refMax = valor.refMax;
        return v;
      });

      const antes = e.valores.map(chaveDaLinha);
      const depois = valores.map(chaveDaLinha);
      const mesmosDados = titulo === e.titulo && data === e.data;
      if (mesmosDados && antes.length === depois.length && antes.every((c, i) => c === depois[i])) throw new ExameError({ geral: E.nadaAlterado });
      const soAcrescimo = mesmosDados && depois.length > antes.length && antes.every((c, i) => c === depois[i]);
      if (justificativa === undefined || (justificativa === null && !soAcrescimo)) throw new ExameError({ justificativa: E.justificativa });

      const [ultima] = await tx
        .select({ versao: examVersoes.versao })
        .from(examVersoes)
        .where(and(eq(examVersoes.examId, e.id), eq(examVersoes.patientId, p.id)))
        .orderBy(desc(examVersoes.versao))
        .limit(1);
      await tx.insert(examVersoes).values({
        tenantId: ctx.tenantId,
        patientId: p.id,
        examId: e.id,
        versao: (ultima?.versao ?? 0) + 1,
        titulo: e.titulo,
        data: e.data,
        valores: e.valores,
        justificativa,
        // ignorados: o gatilho exam_versoes_regras grava a usuária da sessão e o relógio do banco
        alteradoPor: sql`app_current_user()`,
        alteradoEm: sql`clock_timestamp()`,
      });
      // estritamente depois do lido (no mesmo milissegundo, o próximo `lidoEm` não distinguiria as duas edições)
      const updatedAt = new Date(Math.max(agora.getTime(), e.updatedAt.getTime() + 1));
      await tx.update(exams).set({ titulo, data, valores, updatedAt }).where(and(eq(exams.id, e.id), eq(exams.patientId, p.id)));
    },
    deps.db ?? getDb(),
  );
}

export type VersaoDoExame = { versao: number; titulo: string; data: string; valores: ValorExame[]; justificativa: string | null; por: string; em: Date };

/**
 * "Versões anteriores" (RN-378): o exame e as versões pelos dois ids, da mais nova para a mais antiga; `auditRead`
 * (entidade `exames_versoes`) sempre que o exame é achado (o título e a data saem mesmo sem versão). O nome de quem alterou vem de `nomesDosAtores`, fora da transação
 * (como o Histórico de acessos); sem conta → "Usuário removido".
 */
export async function versoesDoExame(
  ctx: TenantContext,
  patientId: string,
  exameId: string,
  deps: { db?: Db } = {},
): Promise<{ exame: { titulo: string; data: string }; versoes: VersaoDoExame[] } | null> {
  exigirNutri(ctx);
  if (!idValido(patientId) || !idValido(exameId)) return null;
  const db = deps.db ?? getDb();
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select({ titulo: exams.titulo, data: exams.data }).from(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, patientId)));
      if (!e) return null;
      const versoes = await tx
        .select()
        .from(examVersoes)
        .where(and(eq(examVersoes.examId, exameId), eq(examVersoes.patientId, patientId)))
        .orderBy(desc(examVersoes.versao));
      // sempre que o exame é achado: a tela devolve o título e a data mesmo sem versão (regra 8; code review do PR 2)
      await auditRead(tx, { entidade: 'exames_versoes', entidadeId: exameId, patientId });
      return { exame: e, versoes };
    },
    db,
  );
  if (!lido) return null;
  const nomes = await nomesDosAtores(db, lido.versoes.map((v) => v.alteradoPor));
  return {
    exame: lido.exame,
    versoes: lido.versoes.map((v) => ({
      versao: v.versao,
      titulo: v.titulo,
      data: v.data,
      valores: v.valores,
      justificativa: v.justificativa,
      por: nomes.get(v.alteradoPor)?.nome ?? USUARIO_REMOVIDO,
      em: v.alteradoEm,
    })),
  };
}
