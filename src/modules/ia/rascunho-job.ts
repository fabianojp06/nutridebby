import { and, eq, inArray, isNull } from 'drizzle-orm';
import { iaTarefas, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/modules/plataforma/audit';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { avisarCredencialInvalida, avisarTetoGlobal } from './alertas';
import { autorizacaoDaTarefa, motivoDoPaciente } from './autorizacao';
import { MAX_VOLTAS_RASCUNHO, PRAZO_LACO_MS, PRAZO_SUGESTAO_DIAS, USO_DA_TAREFA, type ModeloIA, type MotivoFalha } from './constantes';
import { acertar, avisarSeChegou80Ia, estornar, marcarIncerto } from './cota';
import { buscaDoTenant, executarFerramenta, FERRAMENTAS_ALIMENTOS, novoCatalogo } from './ferramentas-alimentos';
import { ESFORCO_RASCUNHO, instrucaoRascunho, SISTEMA_RASCUNHO } from './instrucoes/rascunho';
import { custoMaximoDaPrimeiraVolta, ErroNoLaco, rodarLaco, type FimDoLaco } from './laco-ferramentas';
import { RepetirIaError, type FimDoJob } from './leitura-job';
import { motivoDoErro, type DepsJobAssistente } from './modelos-job';
import { estadoIaComPaciente } from './modo';
import { SCHEMA_PLANO_IA, validarPlanoIa } from './plano-ia';
import { MAX_TOKENS_VOLTA } from './precos';
import { montarPedidoDoRascunho, validarMetas, type MetasDoRascunho } from './rascunho-dados';
import type { ResultadoRascunho } from './tipos';

const USO = USO_DA_TAREFA.rascunho_plano;
/** O que fazer com a reserva ao falhar: estornar (nada saiu), manter (incerto) ou acertar pelo que as voltas custaram. */
type Reserva = 'estornar' | 'manter' | { acertar: FimDoLaco | ErroNoLaco };

/**
 * Plano 14B (US-121, US-122, §5.6, RN-100, RN-101, RN-108, RN-121, D4, D5): o job do rascunho de plano, na fila
 * `ia-assistente` (só o worker importa — guarda de grafo). A forma do resumo, com o laço de ferramentas: (1) pega a tarefa →
 * (2) RN-100 barata → (3) PORTÃO (paciente FOR SHARE → tenant FOR SHARE → tarefa), que MONTA o pedido com o paciente
 * travado, grava a saída e "Dados enviados à IA" → (4) o laço (até 12 voltas, 12 min e o teto da tarefa, que é a reserva —
 * D5), conferindo a cada volta seguinte a tarefa, a IA do consultório e a autorização (leitura simples; a retirada no meio
 * para na volta seguinte: o que já saiu, saiu; nada novo sai) → (5) revalida o plano contra o catálogo da tarefa → (6) grava
 * com as mesmas travas do portão, conferindo de novo a tarefa, a IA e a autorização; o acerto é sempre pela soma das voltas.
 * Nada de conteúdo em log (RNF-104): só ids, números, motivo e request-id.
 */
export async function processarRascunho(d: { tenantId: string; tarefaId: string }, deps: DepsJobAssistente): Promise<FimDoJob> {
  const agora = deps.agora ?? (() => new Date());
  const ctx: TenantContext = { tenantId: d.tenantId, role: 'worker' };
  const alertas = deps.alertas ?? { credencial: (a: Date) => avisarCredencialInvalida(deps.db, a, deps.appUrl), teto: (a: Date) => avisarTetoGlobal(deps.db, a, deps.appUrl) };
  // o aviso de 80% da cota de IA (Plano 11), sempre que houve custo
  const avisar80 = () =>
    avisarSeChegou80Ia(deps.db, d.tenantId, agora(), deps.appUrl).catch((err: unknown) =>
      logger.error({ tenantId: d.tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha no aviso de 80% da IA'),
    );
  const falhar = async (motivo: MotivoFalha, reserva: Reserva = 'estornar'): Promise<FimDoJob> => {
    const contas = typeof reserva === 'object' ? reserva.acertar : null;
    await withTenant(
      ctx,
      async (tx) => {
        const x = await tx
          .update(iaTarefas)
          .set({ status: 'falhou', erro: motivo, parametros: null, resultado: null, concluidoEm: agora(), updatedAt: agora(), ...(contas ? { custoMicroUsd: contas.custoMicroUsd } : {}) })
          .where(and(eq(iaTarefas.id, d.tarefaId), inArray(iaTarefas.status, ['na_fila', 'processando'])))
          .returning({ id: iaTarefas.id });
        if (!x.length) return; // a varredura (ou o cancelamento) já encerrou a tarefa e cuidou da reserva
        if (reserva === 'estornar') await estornar(tx, d.tarefaId, agora());
        else if (reserva === 'manter') await marcarIncerto(tx, d.tarefaId, agora());
        else {
          const a = reserva.acertar;
          const requestId = a instanceof ErroNoLaco ? a.erro.requestId : a.requestId;
          const recusaCategoria = a instanceof ErroNoLaco || a.tipo !== 'parou' ? null : a.recusaCategoria;
          await acertar(tx, { tarefaId: d.tarefaId, custoMicroUsd: a.custoMicroUsd, uso: a.uso, recusaCategoria, requestId, agora: agora() });
        }
      },
      deps.db,
    );
    logger.warn(
      { tarefaId: d.tarefaId, tenantId: d.tenantId, finalidade: 'rascunho', motivo, voltas: contas?.voltas ?? 0, custoMicroUsd: contas?.custoMicroUsd ?? null },
      'rascunho de plano pela IA não concluído',
    );
    if (motivo === 'credencial_invalida') await alertas.credencial(agora()).catch(() => undefined);
    if (motivo === 'teto_plataforma') await alertas.teto(agora()).catch(() => undefined);
    if (contas) await avisar80();
    return 'falhou';
  };

  // (1) pega a tarefa: "na_fila", ou "processando" sem envio (nova tentativa de antes do envio). R7 (pre-flight da 14B-2,
  // R14 da 14B-1): o início é o DESTA tentativa — a varredura conta os 15 min a partir dele (o laço tem até 12 min)
  const lida = await withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx.select().from(iaTarefas).where(eq(iaTarefas.id, d.tarefaId)).for('update');
      if (!t || t.tipo !== 'rascunho_plano' || (t.status !== 'na_fila' && t.status !== 'processando')) return null;
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
  const provedor = deps.provedor;

  // (3) PORTÃO DO ENVIO (RN-100, RN-108, D4). Numa transação, na ordem de travas da spec (§5.5): paciente FOR SHARE
  // (serializa com a retirada e a exclusão) → tenant FOR SHARE (desativarIa, a admin, a suspensão) → tarefa. O pedido é
  // MONTADO AQUI, com o paciente travado (as metas da tarefa, revalidadas; a anamnese só com "Considerar a anamnese").
  // RN-104 (como o D12 do resumo): se nem a 1ª volta cabe no teto da tarefa (IA_TETO_RASCUNHO_USD abaixo do custo máximo
  // de uma volta), `limite_custo` aqui, ANTES da marca — nada sai, a reserva é estornada e nada se registra como enviado.
  // Grava `enviado_em`, `saiu_em` (primeira saída, nunca volta a nulo) e `destino` só se a tarefa ainda está "processando"
  // e sem envio; grava "Dados enviados à IA" (exportar/ia, ator nulo, sem conteúdo). A reserva NÃO desce: ela é o teto do
  // laço (D5). Só depois do commit o pedido sai.
  const pedidoDoLaco = { finalidade: 'rascunho', modelo, geo: deps.geo, sistema: SISTEMA_RASCUNHO, ferramentas: FERRAMENTAS_ALIMENTOS, schema: SCHEMA_PLANO_IA, maxTokens: MAX_TOKENS_VOLTA, esforco: ESFORCO_RASCUNHO } as const;
  const portao = await withTenant(
    ctx,
    async (tx): Promise<MotivoFalha | 'ignorada' | { inicio: string; metas: MetasDoRascunho }> => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId)).for('share');
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa' || !deps.destino) return 'ia_desligada';
      // D6 (RN-109): a tarefa que já saiu para um destino (tentativa anterior) não sai para outro
      if (t.destino && t.destino !== deps.destino) return 'ia_desligada';
      if (!p) return 'paciente_indisponivel';
      // CS-105 / RN-108 (D14): a autorização para o USO da tarefa, relida com o paciente travado
      const doPaciente = motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO);
      if (doPaciente) return doPaciente;
      const v = validarMetas(t.parametros);
      if (!v.ok) return 'resposta_invalida'; // metas fora do formato (nunca pelo app): nada sai
      const pedido = await montarPedidoDoRascunho(tx, p, v.metas, { agora: agora(), fuso: tn.fuso });
      const inicio = `${instrucaoRascunho}\n${JSON.stringify(pedido.dados)}`;
      if (custoMaximoDaPrimeiraVolta(pedidoDoLaco, inicio) > t.reservaMicroUsd) return 'limite_custo';
      const marcada = await tx
        .update(iaTarefas)
        .set({ enviadoEm: agora(), saiuEm: t.saiuEm ?? agora(), destino: t.destino ?? deps.destino, updatedAt: agora() })
        .where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'), isNull(iaTarefas.enviadoEm)))
        .returning({ id: iaTarefas.id });
      if (!marcada.length) return 'ignorada';
      await recordAudit(tx, { acao: 'exportar', entidade: 'ia', entidadeId: t.id, patientId: t.patientId }); // "Dados enviados à IA"
      return { inicio, metas: v.metas };
    },
    deps.db,
  );
  if (portao === 'ignorada') return 'ignorada';
  if (typeof portao === 'string') return falhar(portao);
  const { inicio: mensagemInicial, metas } = portao;

  // (4) o laço (D4, D5): até 12 voltas, 12 min e o teto da tarefa; ferramentas só de alimentos, no tenant da tarefa
  const cat = novoCatalogo();
  const buscar = (deps.buscar ?? ((x: string) => buscaDoTenant(x, deps.db)))(d.tenantId);
  const inicio = Date.now();
  let fim: FimDoLaco;
  try {
    fim = await rodarLaco({
      provedor,
      pedido: pedidoDoLaco,
      inicio: mensagemInicial,
      executar: (c) => executarFerramenta(c, cat, buscar),
      limites: { voltas: MAX_VOLTAS_RASCUNHO, tetoMicroUsd: t.reservaMicroUsd, prazoMs: PRAZO_LACO_MS },
      // §5.6: "as voltas seguintes conferem de novo a tarefa e a autorização (leitura simples, sem trava) e param com
      // sem_autorizacao se a retirada chegou no meio (o que já saiu, saiu; nada novo sai)"
      antesDaVolta: async (volta) => {
        if (volta === 1) return null; // acabou de passar pelo portão
        return withTenant(
          ctx,
          async (tx): Promise<MotivoFalha | null> => {
            const [atual] = await tx.select({ status: iaTarefas.status }).from(iaTarefas).where(eq(iaTarefas.id, t.id));
            if (atual?.status !== 'processando') return 'interrompida';
            const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId));
            if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa') return 'ia_desligada';
            const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId));
            return p ? motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO) : 'paciente_indisponivel';
          },
          deps.db,
        );
      },
    });
  } catch (e) {
    if (!(e instanceof ErroNoLaco)) throw e;
    logger.warn(
      { tarefaId: t.id, tenantId: d.tenantId, finalidade: 'rascunho', tipo: e.erro.tipo, status: e.erro.status, voltas: e.voltas, requestId: e.erro.requestId },
      'provedor de IA recusou ou falhou',
    );
    const m = motivoDoErro(e);
    if (m === 'repetir') {
      // nada saiu (1ª volta): limpa só a marca de "pode ter sido processado"; saiu_em e a auditoria ficam (registro
      // conservador). O início é regravado pela nova tentativa, no passo (1) (R7)
      await withTenant(ctx, (tx) => tx.update(iaTarefas).set({ enviadoEm: null, updatedAt: agora() }).where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'))), deps.db);
      if (deps.ultimaTentativa) return falhar('provedor_indisponivel');
      throw new RepetirIaError(`provedor: ${e.erro.tipo}`);
    }
    return falhar(m.motivo, m.reserva);
  }
  // parou antes de passar do limite (voltas, prazo, custo), pela conferência da volta, recusa ou resposta cortada; sem
  // nenhuma volta, nada saiu
  if (fim.tipo === 'parou') return falhar(fim.motivo, fim.voltas === 0 ? 'estornar' : { acertar: fim });

  // (5) revalida contra o catálogo da tarefa (D14): só ids reais, gramas do sistema, itens inválidos descartados e contados.
  // A meta é a da nutricionista (RN-02, RN-116): o número do modelo nunca é gravado
  const valido = validarPlanoIa(fim.texto, cat);
  const plano = valido && valido.refeicoes.length ? { ...valido, metaKcal: metas.metaKcal } : null;
  const ultimo = fim;

  // (6) grava com o acerto, com as MESMAS travas do portão (paciente FOR SHARE → tenant FOR SHARE → tarefa FOR UPDATE →
  // ia_uso → plataforma). O que mudou depois da última volta — a tarefa (varredura, cancelamento), a IA do consultório, a
  // autorização do paciente — faz o resultado não ser gravado (o custo é).
  const motivo = await withTenant(
    ctx,
    async (tx): Promise<MotivoFalha | null> => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId)).for('share');
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      const [atual] = await tx.select({ status: iaTarefas.status }).from(iaTarefas).where(eq(iaTarefas.id, t.id)).for('update');
      const doPaciente = p ? motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO) : 'paciente_indisponivel';
      let m: MotivoFalha | null = null;
      if (atual?.status !== 'processando') m = 'interrompida';
      else if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa') m = 'ia_desligada';
      else if (doPaciente) m = doPaciente;
      else if (!plano) m = 'resposta_invalida';
      const base = { custoMicroUsd: ultimo.custoMicroUsd, concluidoEm: agora(), updatedAt: agora() };
      if (m === null && plano) {
        const resultado: ResultadoRascunho = { tipo: 'rascunho', versao: 1, plano };
        await tx
          .update(iaTarefas)
          .set({ ...base, status: 'pronta', resultado, expiraEm: new Date(agora().getTime() + PRAZO_SUGESTAO_DIAS * 86_400_000) })
          .where(eq(iaTarefas.id, t.id));
      } else if (atual?.status === 'processando') {
        await tx.update(iaTarefas).set({ ...base, status: 'falhou', erro: m, parametros: null, resultado: null }).where(eq(iaTarefas.id, t.id));
      }
      await acertar(tx, { tarefaId: t.id, custoMicroUsd: ultimo.custoMicroUsd, uso: ultimo.uso, recusaCategoria: null, requestId: ultimo.requestId, agora: agora() });
      return m;
    },
    deps.db,
  );
  logger.info(
    {
      tarefaId: t.id, tenantId: d.tenantId, finalidade: 'rascunho', modelo, promptVersao: t.promptVersao, voltas: fim.voltas, tokensEntrada: fim.uso.entrada, tokensSaida: fim.uso.saida,
      custoMicroUsd: fim.custoMicroUsd, duracaoMs: Date.now() - inicio, descartados: plano?.descartados ?? null, motivo, requestId: fim.requestId,
    },
    'rascunho de plano pela IA',
  );
  await avisar80();
  return motivo === null ? 'pronta' : 'falhou';
}
