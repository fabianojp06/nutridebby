import { and, eq, inArray, isNull } from 'drizzle-orm';
import { iaTarefas, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/modules/plataforma/audit';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { avisarCredencialInvalida, avisarTetoGlobal } from './alertas';
import { autorizacaoDaTarefa, motivoDoPaciente } from './autorizacao';
import { PRAZO_SUGESTAO_DIAS, USO_DA_TAREFA, type ModeloIA, type MotivoFalha } from './constantes';
import { acertar, avisarSeChegou80Ia, estornar, marcarIncerto, reduzirReserva } from './cota';
import { ESFORCO_RESUMO, instrucaoResumo, SCHEMA_RESUMO, SISTEMA_RESUMO } from './instrucoes/resumo';
import { RepetirIaError, type FimDoJob } from './leitura-job';
import type { DepsJobAssistente } from './modelos-job';
import { estadoIaComPaciente } from './modo';
import { custoMaximoMicroUsd, custoMicroUsd, MAX_TOKENS_RESUMO, tokensDeBytes, TOKENS_INSTRUCOES_TETO } from './precos';
import { ErroProvedor, type RespostaGeracao, type TipoErroProvedor } from './provedor';
import { validarRespostaResumo } from './resposta-resumo';
import { montarPedidoDoResumo, type PedidoDoResumo } from './resumo-dados';
import type { ResultadoResumo } from './tipos';

const USO = USO_DA_TAREFA.resumo_historico;

/**
 * Plano 14B (US-120, §5.6, RN-100, RN-101, RN-108, D12, D13): o job do resumo, na fila `ia-assistente` (só o worker importa
 * — guarda de grafo). Mesma forma da leitura: (1) pega a tarefa → (2) RN-100 barata → (3) PORTÃO (paciente FOR SHARE →
 * tenant FOR SHARE → tarefa), que MONTA o pedido com o paciente travado — o que sai é o que vale agora —, confere a
 * reserva (só desce, D12), grava a saída e "Dados enviados à IA" → (4) chama uma vez, sem ferramentas → (5) confere as
 * fontes (D13) → (6) grava com as mesmas travas, conferindo de novo a tarefa, a IA e a autorização. Nada de conteúdo em
 * log (RNF-104): só ids, números, motivo e request-id.
 */
export async function processarResumo(d: { tenantId: string; tarefaId: string }, deps: DepsJobAssistente): Promise<FimDoJob> {
  const agora = deps.agora ?? (() => new Date());
  const ctx: TenantContext = { tenantId: d.tenantId, role: 'worker' };
  const alertas = deps.alertas ?? { credencial: (a: Date) => avisarCredencialInvalida(deps.db, a, deps.appUrl), teto: (a: Date) => avisarTetoGlobal(deps.db, a, deps.appUrl) };
  const falhar = async (motivo: MotivoFalha, reserva: 'estornar' | 'manter' = 'estornar'): Promise<FimDoJob> => {
    await withTenant(
      ctx,
      async (tx) => {
        const x = await tx
          .update(iaTarefas)
          .set({ status: 'falhou', erro: motivo, parametros: null, resultado: null, concluidoEm: agora(), updatedAt: agora() })
          .where(and(eq(iaTarefas.id, d.tarefaId), inArray(iaTarefas.status, ['na_fila', 'processando'])))
          .returning({ id: iaTarefas.id });
        if (!x.length) return;
        if (reserva === 'estornar') await estornar(tx, d.tarefaId, agora());
        else await marcarIncerto(tx, d.tarefaId, agora());
      },
      deps.db,
    );
    logger.warn({ tarefaId: d.tarefaId, tenantId: d.tenantId, finalidade: 'resumo', motivo }, 'resumo do histórico pela IA não concluído');
    if (motivo === 'credencial_invalida') await alertas.credencial(agora()).catch(() => undefined);
    if (motivo === 'teto_plataforma') await alertas.teto(agora()).catch(() => undefined);
    return 'falhou';
  };

  // (1) pega a tarefa: "na_fila", ou "processando" sem envio (nova tentativa de antes do envio). R7 (pre-flight da 14B-2,
  // R14 da 14B-1): o início é o DESTA tentativa — a varredura conta os 15 min a partir dele
  const lida = await withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx.select().from(iaTarefas).where(eq(iaTarefas.id, d.tarefaId)).for('update');
      if (!t || t.tipo !== 'resumo_historico' || (t.status !== 'na_fila' && t.status !== 'processando')) return null;
      if (t.enviadoEm) return { t, jaEnviada: true as const };
      await tx.update(iaTarefas).set({ status: 'processando', iniciadoEm: agora(), tentativas: t.tentativas + 1, updatedAt: agora() }).where(eq(iaTarefas.id, t.id));
      return { t, jaEnviada: false as const };
    },
    deps.db,
  );
  if (!lida) return 'ignorada';
  if (lida.jaEnviada) return falhar('resultado_incerto', 'manter'); // D4: nunca reenviar o que pode ter sido processado
  const { t } = lida;
  const modelo = t.modelo as ModeloIA;

  // (2) RN-100 de novo, no worker (conferência barata; o portão confere de novo com travas): a IA do consultório, a
  // retenção aceita e o destino do provedor em uso; o provedor deste worker tem de atender o modelo gravado na tarefa
  const tenant = await buscarTenant(deps.db, d.tenantId);
  if (!tenant || estadoIaComPaciente(tenant, deps) !== 'ativa' || !deps.destino) return falhar('ia_desligada');
  if (!deps.provedor) return falhar(deps.modo === 'anthropic' || deps.modo === 'bedrock-eu' ? 'credencial_invalida' : 'ia_desligada');
  if (!deps.provedor.aceita(modelo, deps.geo)) {
    logger.warn({ tarefaId: t.id, tenantId: d.tenantId, modelo, provedor: deps.provedor.nome, geo: deps.geo }, 'provedor de IA do worker não atende o modelo da tarefa');
    return falhar('ia_desligada');
  }
  if (deps.abortado?.()) return 'ignorada';

  // (3) PORTÃO DO ENVIO (RN-100, RN-104, RN-108, D4, D12). Numa transação, na ordem de travas da spec (§5.5): paciente
  // FOR SHARE (serializa com a retirada e a exclusão, que travam o paciente FOR UPDATE) → tenant FOR SHARE (desativarIa, a
  // admin, a suspensão) → tarefa → ia_uso → plataforma. O pedido é MONTADO AQUI, com o paciente travado. Grava
  // `enviado_em`, `saiu_em` (primeira saída, nunca volta a nulo), `destino` e o carimbo do pedido que sai (revisão da T7: o
  // "Reaproveitar" compara com o que foi de fato enviado; a 0114 só aceita esta troca do worker, em processando, sem
  // enviado_em, junto com enviado_em) só se a tarefa ainda está "processando" e sem envio; reduz a reserva; grava "Dados
  // enviados à IA" (exportar/ia, ator nulo, sem conteúdo). Só depois do commit o pedido sai.
  const notasPrivadas = (t.parametros as { notasPrivadas?: unknown } | null)?.notasPrivadas === true;
  const portao = await withTenant(
    ctx,
    async (tx): Promise<MotivoFalha | 'ignorada' | { pedido: PedidoDoResumo }> => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId)).for('share');
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa' || !deps.destino) return 'ia_desligada';
      // D6 (RN-109): a tarefa que já saiu para um destino (tentativa anterior) não sai para outro
      if (t.destino && t.destino !== deps.destino) return 'ia_desligada';
      if (!p) return 'paciente_indisponivel';
      // CS-105 / RN-108 (D14): a autorização para o USO da tarefa, relida com o paciente travado
      const doPaciente = motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO);
      if (doPaciente) return doPaciente;
      const pedido = await montarPedidoDoResumo(tx, p, { notasPrivadas, agora: agora(), fuso: tn.fuso });
      if (pedido.vazio) return 'nada_encontrado';
      const teto = custoMaximoMicroUsd(modelo, deps.geo, tokensDeBytes(pedido.bytes) + TOKENS_INSTRUCOES_TETO, MAX_TOKENS_RESUMO);
      if (teto > t.reservaMicroUsd) return 'limite_custo'; // D12: a reserva nunca sobe (RN-104)
      const marcada = await tx
        .update(iaTarefas)
        .set({ enviadoEm: agora(), saiuEm: t.saiuEm ?? agora(), destino: t.destino ?? deps.destino, carimboDados: pedido.carimbo, updatedAt: agora() })
        .where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'), isNull(iaTarefas.enviadoEm)))
        .returning({ id: iaTarefas.id });
      if (!marcada.length) return 'ignorada';
      await reduzirReserva(tx, t.id, teto, agora());
      await recordAudit(tx, { acao: 'exportar', entidade: 'ia', entidadeId: t.id, patientId: t.patientId }); // "Dados enviados à IA"
      return { pedido };
    },
    deps.db,
  );
  if (portao === 'ignorada') return 'ignorada';
  if (typeof portao === 'string') return falhar(portao);
  const { pedido } = portao;

  // (4) chama, uma vez (o SDK não repete: maxRetries 0), sem ferramentas
  const inicio = Date.now();
  let r: RespostaGeracao;
  try {
    r = await deps.provedor.gerar({
      finalidade: 'resumo', modelo, geo: deps.geo, sistema: SISTEMA_RESUMO,
      turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: `${instrucaoResumo}\n${JSON.stringify(pedido.dados)}` }] }],
      ferramentas: [], schema: SCHEMA_RESUMO, maxTokens: MAX_TOKENS_RESUMO, esforco: ESFORCO_RESUMO,
    });
  } catch (e) {
    const tipo = e instanceof ErroProvedor ? e.tipo : 'incerto';
    logger.warn(
      { tarefaId: t.id, tenantId: d.tenantId, finalidade: 'resumo', tipo, status: e instanceof ErroProvedor ? e.status : null, requestId: e instanceof ErroProvedor ? e.requestId : null },
      'provedor de IA recusou ou falhou',
    );
    if (tipo === 'nao_enviado' || tipo === 'repetir') {
      // pode repetir: limpa só a marca de "pode ter sido processado"; saiu_em e a auditoria ficam (registro conservador)
      await withTenant(ctx, (tx) => tx.update(iaTarefas).set({ enviadoEm: null, updatedAt: agora() }).where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'))), deps.db);
      if (deps.ultimaTentativa) return falhar('provedor_indisponivel');
      throw new RepetirIaError(`provedor: ${tipo}`);
    }
    return falhar(MOTIVO_DO_ERRO[tipo], tipo === 'incerto' ? 'manter' : 'estornar');
  }

  // (5) e (6): confere as fontes e grava com o acerto, com as MESMAS travas do portão (paciente FOR SHARE → tenant FOR
  // SHARE → tarefa FOR UPDATE → ia_uso → plataforma). O que mudou durante a chamada — a tarefa (varredura, cancelamento),
  // a IA do consultório, a autorização do paciente — faz o resultado não ser gravado (o custo é).
  const custo = custoMicroUsd(modelo, deps.geo, r.uso);
  const v = r.tipo === 'final' ? validarRespostaResumo(r.texto, new Set(pedido.fontes.map((f) => f.indice))) : null;
  const fim = await withTenant(
    ctx,
    async (tx): Promise<MotivoFalha | null> => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId)).for('share');
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      const [atual] = await tx.select({ status: iaTarefas.status }).from(iaTarefas).where(eq(iaTarefas.id, t.id)).for('update');
      const doPaciente = p ? motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO) : 'paciente_indisponivel';
      let motivo: MotivoFalha | null = null;
      if (atual?.status !== 'processando') motivo = 'interrompida';
      else if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa') motivo = 'ia_desligada';
      else if (doPaciente) motivo = doPaciente;
      else if (r.tipo === 'recusa') motivo = 'recusa';
      else if (!v) motivo = 'resposta_invalida';
      else if (!v.secoes.length) motivo = 'nada_encontrado';
      const base = { custoMicroUsd: custo, concluidoEm: agora(), updatedAt: agora() };
      if (motivo === null && v) {
        const resultado: ResultadoResumo = { tipo: 'resumo', versao: 1, secoes: v.secoes, retiradas: v.retiradas, fontes: pedido.fontes, tabela: pedido.tabela };
        await tx
          .update(iaTarefas)
          .set({ ...base, status: 'pronta', resultado, expiraEm: new Date(agora().getTime() + PRAZO_SUGESTAO_DIAS * 86_400_000) })
          .where(eq(iaTarefas.id, t.id));
      } else if (atual?.status === 'processando') {
        await tx.update(iaTarefas).set({ ...base, status: 'falhou', erro: motivo, parametros: null, resultado: null }).where(eq(iaTarefas.id, t.id));
      }
      await acertar(tx, { tarefaId: t.id, custoMicroUsd: custo, uso: r.uso, recusaCategoria: r.tipo === 'recusa' ? r.categoria : null, requestId: r.requestId, agora: agora() });
      return motivo;
    },
    deps.db,
  );
  logger.info(
    {
      tarefaId: t.id, tenantId: d.tenantId, finalidade: 'resumo', modelo, promptVersao: t.promptVersao, tokensEntrada: r.uso.entrada, tokensSaida: r.uso.saida,
      custoMicroUsd: custo, duracaoMs: Date.now() - inicio, retiradas: v?.retiradas ?? null, motivo: fim, requestId: r.requestId,
    },
    'resumo do histórico pela IA',
  );
  await avisarSeChegou80Ia(deps.db, d.tenantId, agora(), deps.appUrl).catch((err: unknown) =>
    logger.error({ tenantId: d.tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha no aviso de 80% da IA'),
  );
  return fim === null ? 'pronta' : 'falhou';
}

/** RN-105 / D4, como a leitura: o motivo de cada erro do provedor que não repete (o arquivo grande da leitura vira resposta inválida). */
const MOTIVO_DO_ERRO: Record<Exclude<TipoErroProvedor, 'nao_enviado' | 'repetir'>, MotivoFalha> = {
  incerto: 'resultado_incerto',
  credencial: 'credencial_invalida',
  limite_de_gasto: 'teto_plataforma',
  grande_demais: 'resposta_invalida',
  pedido_invalido: 'resposta_invalida',
};
