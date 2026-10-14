import { and, eq, gt } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { exams, iaTarefas, storedFiles } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida, hojeNoFuso } from '@/modules/pacientes/datas';
import { agruparMarcadores, lerValores, MSG_EXAME, type ValorExame } from '@/modules/pacientes/exames';
import { auditRead } from '@/modules/plataforma/audit';
import { autorizacaoDaTarefa, vigentePara } from './autorizacao';
import { MAX_LINHAS_SUGESTAO, MAX_VALORES_EXAME, MSG_IA, USO_DA_TAREFA, type DestinoIA } from './constantes';
import { jaLancado, nomeDaSerie } from './correspondencia';
import { ehLeitura } from './tipos';
import { lerValorLaudo, type ValorLido } from './valor-laudo';

export type LinhaConferencia = {
  indice: number;
  nomeLido: string;
  /** O nome da série existente (RN-113) ou o lido. */
  nomeSugerido: string;
  nomeAjustado: boolean;
  valorTexto: string;
  valor: ValorLido;
  unidade: string | null;
  referencia: string | null;
  pagina: number | null;
  jaLancado: boolean;
};

export type SugestaoAberta = {
  tarefaId: string;
  exame: { id: string; titulo: string; data: string; arquivoPath: string | null; mime: string | null; quantidadeDeValores: number };
  dataColeta: string | null;
  linhas: LinhaConferencia[];
  descartadas: number;
  expiraEm: Date;
};

type Deps = { db?: Db; agora?: Date };

/**
 * US-111 "Tabela de conferência": abrir a sugestão é LEITURA de dado de saúde — auditRead (entidade `ia`) na mesma
 * transação (regra 8, §5.11). A correspondência com as séries do paciente e o "já lançado" são do sistema (RN-113).
 */
export async function abrirSugestao(ctx: TenantContext, patientId: string, tarefaId: string, deps: Deps = {}): Promise<SugestaoAberta | null> {
  if (!idValido(patientId) || !idValido(tarefaId)) return null;
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx
        .select()
        .from(iaTarefas)
        .where(and(eq(iaTarefas.id, tarefaId), eq(iaTarefas.patientId, patientId), eq(iaTarefas.status, 'pronta'), gt(iaTarefas.expiraEm, agora)));
      // a leitura só lê o resultado da leitura (o resumo e o rascunho do Plano 14B têm `tipo` e nunca têm exame)
      if (!t || !ehLeitura(t.resultado) || !t.examId || !t.expiraEm) return null;
      const doPaciente = await tx.select().from(exams).where(eq(exams.patientId, patientId));
      const exame = doPaciente.find((e) => e.id === t.examId);
      if (!exame) return null;
      const [arq] = exame.arquivoPath ? await tx.select({ mime: storedFiles.mime }).from(storedFiles).where(eq(storedFiles.caminho, exame.arquivoPath)) : [];
      const series = agruparMarcadores(doPaciente);
      const linhas = t.resultado.linhas.map((l, indice): LinhaConferencia => {
        const ajuste = nomeDaSerie(l.nome, l.unidade, series);
        const valor = lerValorLaudo(l.valorTexto);
        const nome = ajuste ?? l.nome;
        return {
          indice, nomeLido: l.nome, nomeSugerido: nome, nomeAjustado: ajuste !== null, valorTexto: l.valorTexto, valor, unidade: l.unidade, referencia: l.referencia, pagina: l.pagina,
          jaLancado: valor.tipo === 'numero' && jaLancado(exame.valores, nome, valor.valor, l.unidade),
        };
      });
      await auditRead(tx, { entidade: 'ia', entidadeId: t.id, patientId });
      return {
        tarefaId: t.id,
        exame: { id: exame.id, titulo: exame.titulo, data: exame.data, arquivoPath: exame.arquivoPath, mime: arq?.mime ?? null, quantidadeDeValores: exame.valores.length },
        dataColeta: t.resultado.dataColeta,
        linhas,
        descartadas: t.resultado.descartadas,
        expiraEm: t.expiraEm,
      };
    },
    deps.db ?? getDb(),
  );
}

export type LinhaEnviada = { indice: number; nome: unknown; valor: unknown; unidade: unknown; referencia: unknown };

export class ConferenciaError extends Error {
  override name = 'ConferenciaError';
  constructor(readonly erros: Record<string, string>) {
    super('Conferência inválida');
  }
}

/**
 * US-111 "Conferir e salvar" / RN-114. Ordem de travas: paciente → exame → tarefa. Só ACRESCENTA (as linhas existentes não
 * mudam); cada linha nova leva `iaTarefaId`; o valor enviado passa de novo por lerValorLaudo (D10) e pelas regras da
 * US-015 (lerValores). A mesma transação marca a tarefa "aplicada" com quem, quando e quantas linhas, e esvazia a
 * sugestão. O gatilho de auditoria registra a alteração do exame e a da tarefa, com o ator. Plano 14A (RN-108, RN-122):
 * a autorização do paciente é conferida com o paciente travado — retirada (ou versão/destino que não vale mais) depois
 * da leitura → nada é aplicado. `deps.destino` = o do provedor em uso (configIA).
 */
export async function aplicarSugestao(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  tarefaId: string,
  entrada: { linhas: LinhaEnviada[]; usarData: boolean },
  deps: Deps & { destino: DestinoIA | null },
): Promise<{ linhas: number }> {
  if (!idValido(tarefaId)) throw new ConferenciaError({ geral: MSG_IA.indisponivelSugestao });
  if (!entrada.linhas.length) throw new ConferenciaError({ geral: MSG_IA.nadaMarcado });
  // RN-111: a sugestão tem no máximo 150 linhas; lista maior não veio da tela (índices repetidos)
  if (entrada.linhas.length > MAX_LINHAS_SUGESTAO) throw new ConferenciaError({ geral: MSG_IA.indisponivelSugestao });
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [ref] = await tx.select({ examId: iaTarefas.examId, criadoEm: iaTarefas.criadoEm }).from(iaTarefas).where(and(eq(iaTarefas.id, tarefaId), eq(iaTarefas.patientId, p.id)));
      if (!ref?.examId) throw new ConferenciaError({ geral: MSG_IA.indisponivelSugestao });
      // RN-108 (Plano 14A): retirada (ou versão/destino que não vale mais) depois da leitura → nada é aplicado; a sugestão
      // pedida antes da última retirada também não, mesmo com o paciente autorizado de novo (D14; criado_em não muda)
      if (!vigentePara(await autorizacaoDaTarefa(tx, { patientId: p.id, criadoEm: ref.criadoEm }, deps.destino), USO_DA_TAREFA.leitura_exame)) {
        throw new ConferenciaError({ geral: MSG_IA.indisponivelSugestao });
      }
      const [e] = await tx.select().from(exams).where(and(eq(exams.id, ref.examId), eq(exams.patientId, p.id))).for('update');
      const [t] = await tx.select().from(iaTarefas).where(eq(iaTarefas.id, tarefaId)).for('update');
      if (!e || !t || t.status !== 'pronta' || !ehLeitura(t.resultado) || t.examId !== e.id || !t.expiraEm || t.expiraEm <= agora) {
        throw new ConferenciaError({ geral: MSG_IA.indisponivelSugestao });
      }
      const erros: Record<string, string> = {};
      const vistos = new Set<number>();
      const novas: ValorExame[] = [];
      for (const l of entrada.linhas) {
        const original = Number.isInteger(l.indice) ? t.resultado.linhas[l.indice] : undefined;
        if (!original || vistos.has(l.indice)) {
          erros.geral = MSG_IA.indisponivelSugestao;
          continue;
        }
        vistos.add(l.indice);
        const lido = lerValorLaudo(typeof l.valor === 'string' ? l.valor : '');
        if (lido.tipo !== 'numero') {
          erros[`valor-${l.indice}`] = lido.tipo === 'ambiguo' ? MSG_IA.ambiguo : MSG_IA.naoNumerico;
          continue;
        }
        // o número já lido (lerDecimal aceita number): sem voltar a texto, que cairia em notação exponencial ("1e-7")
        const validada = lerValores([{ nome: l.nome, valor: lido.valor, unidade: l.unidade, referencia: l.referencia }]);
        if (!validada || validada.length !== 1) {
          erros[`linha-${l.indice}`] = MSG_EXAME.valores;
          continue;
        }
        novas.push({ ...validada[0], iaTarefaId: t.id });
      }
      if (Object.keys(erros).length) throw new ConferenciaError(erros);
      const sobra = e.valores.length + novas.length - MAX_VALORES_EXAME;
      if (sobra > 0) throw new ConferenciaError({ geral: MSG_IA.limiteLinhas(sobra) });
      let novaData: string | null = null;
      if (entrada.usarData) {
        const d = t.resultado.dataColeta;
        if (!d || !dataValida(d) || d > hojeNoFuso(tenant.fuso, agora)) throw new ConferenciaError({ data: MSG_IA.dataInvalida });
        if (d !== e.data) novaData = d;
      }
      await tx
        .update(exams)
        .set({ valores: [...e.valores, ...novas], ...(novaData ? { data: novaData } : {}), updatedAt: agora })
        .where(eq(exams.id, e.id));
      await tx
        .update(iaTarefas)
        .set({ status: 'aplicada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: ctx.actorUserId ?? null, linhasAplicadas: novas.length, exameDataAnterior: novaData ? e.data : null, updatedAt: agora })
        .where(eq(iaTarefas.id, t.id));
      return { linhas: novas.length };
    },
    deps.db ?? getDb(),
  );
}

/** US-111 "Descartar": esvazia a sugestão, registra quem e quando; o exame não muda (§5.11: a linha fica). */
export async function descartarSugestao(ctx: TenantContext, patientId: string, tarefaId: string, deps: Deps = {}): Promise<boolean> {
  if (!idValido(patientId) || !idValido(tarefaId)) return false;
  const agora = deps.agora ?? new Date();
  const r = await withTenant(
    ctx,
    (tx) =>
      tx
        .update(iaTarefas)
        .set({ status: 'descartada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: ctx.actorUserId ?? null, updatedAt: agora })
        .where(and(eq(iaTarefas.id, tarefaId), eq(iaTarefas.patientId, patientId), eq(iaTarefas.status, 'pronta')))
        .returning({ id: iaTarefas.id }),
    deps.db ?? getDb(),
  );
  return r.length > 0;
}
