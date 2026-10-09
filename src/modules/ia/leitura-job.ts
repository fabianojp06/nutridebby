import { readFile } from 'node:fs/promises';
import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { exams, iaTarefas, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/modules/plataforma/audit';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { buscarTenant, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { avisarCredencialInvalida, avisarTetoGlobal } from './alertas';
import { autorizacaoDoPaciente, motivoDoPaciente, vigentePara, type SituacaoAutorizacao } from './autorizacao';
import { PRAZO_SUGESTAO_DIAS, USO_DA_TAREFA, type DestinoIA, type ModeloIA, type MotivoFalha, type RegiaoIA, type TipoTarefa } from './constantes';
import { acertar, avisarSeChegou80Ia, estornar, marcarIncerto, reduzirReserva } from './cota';
import { ESFORCO_LEITURA, INSTRUCAO_LEITURA, SISTEMA_LEITURA } from './instrucoes/leitura';
import { estadoIaComPaciente, type ModoIA } from './modo';
import { custoMaximoDoArquivo, custoMicroUsd, MAX_TOKENS_LEITURA } from './precos';
import { prepararLaudo, PreparoError } from './preparar-arquivo';
import { ErroProvedor, type ArquivoPreparado, type PedidoLeitura, type ProvedorIA, type RespostaLeitura } from './provedor';
import { SCHEMA_LEITURA, validarRespostaLeitura } from './resposta-leitura';

/**
 * Plano 11 (spec v0.3 §4, §5.6): o job `ia`. Só o worker importa (guarda de grafo). Payload só ids; nada de conteúdo em
 * log (spec §5.7). Ordem: (1) pega a tarefa → (2) RN-100 de novo → (3) prepara o arquivo → (4) PORTÃO DO ENVIO: uma
 * transação com travas reconfere tudo, reduz a reserva ao teto das páginas e grava a saída (enviado_em, saiu_em e a
 * auditoria) → (5) chama, uma vez → (6) valida e grava com o acerto, conferindo de novo paciente, IA e exame. Sem
 * count_tokens: o laudo sai ao provedor uma vez só, e só depois do portão. O que relança vira nova tentativa (RN-105).
 */
export type DadosJobIA = { tenantId: string; tarefaId: string };
export type DepsJobIA = {
  db: Db;
  dataDir: string;
  modo: ModoIA;
  provedor: ProvedorIA | null;
  geo: RegiaoIA;
  tetoGlobalMicroUsd: number;
  appUrl: string;
  agora?: () => Date;
  ultimaTentativa: boolean;
  /** pg-boss: o job expirou e outra execução assumiu — não passa do portão (a outra envia). */
  abortado?: () => boolean;
  /** Injetáveis nos testes (marca em system_heartbeat compartilhada). */
  alertas?: { credencial: (agora: Date) => Promise<unknown>; teto: (agora: Date) => Promise<unknown> };
  /** Só nos testes: mudança entre o preparo e o portão do envio (Review Focus 4). */
  depoisDoPreparo?: () => Promise<unknown>;
  /** RN-109 (Plano 14A): o destino do provedor em uso — a autorização tem de ser para ele, e o portão o grava na tarefa. Nulo = sem IA_PROVEDOR. */
  destino: DestinoIA | null;
  /** A-D4 (Plano 14A, D9): sem retenção zero, nada com dado de paciente sai (ia_desligada). */
  retencaoZero: boolean;
};
export type FimDoJob = 'pronta' | 'falhou' | 'ignorada';

/** Relançado ao pg-boss: a falha aconteceu antes de o provedor processar (RN-105). */
export class RepetirIaError extends Error {
  override name = 'RepetirIaError';
}

const PROCESSANDO_MAX_MS = 15 * 60_000;
const NA_FILA_MAX_MS = 30 * 60_000;

async function encerrarComFalha(db: Db, ctx: TenantContext, tarefaId: string, motivo: MotivoFalha, reserva: 'estornar' | 'manter', agora: Date): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .update(iaTarefas)
        .set({ status: 'falhou', erro: motivo, parametros: null, resultado: null, concluidoEm: agora, updatedAt: agora })
        .where(and(eq(iaTarefas.id, tarefaId), inArray(iaTarefas.status, ['na_fila', 'processando'])))
        .returning({ id: iaTarefas.id });
      if (!r.length) return;
      if (reserva === 'estornar') await estornar(tx, tarefaId, agora);
      else await marcarIncerto(tx, tarefaId, agora);
    },
    db,
  );
  logger.warn({ tarefaId, tenantId: ctx.tenantId, motivo }, 'leitura de laudo pela IA não concluída');
}

export async function processarTarefaIA(d: DadosJobIA, deps: DepsJobIA): Promise<FimDoJob> {
  const agora = deps.agora ?? (() => new Date());
  const { db } = deps;
  const ctx: TenantContext = { tenantId: d.tenantId, role: 'worker' };
  const alertas = deps.alertas ?? { credencial: (a: Date) => avisarCredencialInvalida(db, a, deps.appUrl), teto: (a: Date) => avisarTetoGlobal(db, a, deps.appUrl) };
  const falhar = async (motivo: MotivoFalha, reserva: 'estornar' | 'manter' = 'estornar'): Promise<FimDoJob> => {
    await encerrarComFalha(db, ctx, d.tarefaId, motivo, reserva, agora());
    if (motivo === 'credencial_invalida') await alertas.credencial(agora()).catch(() => undefined);
    if (motivo === 'teto_plataforma') await alertas.teto(agora()).catch(() => undefined);
    return 'falhou';
  };

  // (1) pega a tarefa: "na_fila", ou "processando" sem envio (nova tentativa de antes do envio)
  const lida = await withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx.select().from(iaTarefas).where(eq(iaTarefas.id, d.tarefaId)).for('update');
      if (!t || (t.status !== 'na_fila' && t.status !== 'processando')) return null;
      if (t.enviadoEm) return { t, jaEnviada: true as const, paciente: null, situacao: null, arquivo: null };
      await tx.update(iaTarefas).set({ status: 'processando', iniciadoEm: t.iniciadoEm ?? agora(), tentativas: t.tentativas + 1, updatedAt: agora() }).where(eq(iaTarefas.id, t.id));
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId));
      // Plano 14A (RN-100, RN-107): a situação da autorização junto do paciente (conferência barata; o portão relê com trava)
      const situacao: SituacaoAutorizacao | null = p ? await autorizacaoDoPaciente(tx, p.id, deps.destino) : null;
      const [e] = t.examId ? await tx.select({ arquivo: exams.arquivoPath }).from(exams).where(eq(exams.id, t.examId)) : [];
      return { t, jaEnviada: false as const, paciente: p ?? null, situacao, arquivo: e?.arquivo ?? null };
    },
    db,
  );
  if (!lida) return 'ignorada';
  if (lida.jaEnviada) return falhar('resultado_incerto', 'manter'); // D4: nunca reenviar o que pode ter sido processado
  const { t } = lida;

  // (2) RN-100 de novo, no worker (conferência barata, antes de abrir o arquivo; o portão confere de novo com travas).
  // Plano 14A: a retenção zero (A-D4) e o destino do provedor em uso (RN-109) entram aqui; a autorização, no paciente.
  const uso = USO_DA_TAREFA[t.tipo as TipoTarefa];
  const tenant = await buscarTenant(db, d.tenantId);
  if (!tenant || estadoIaComPaciente(tenant, deps) !== 'ativa' || !deps.destino) return falhar('ia_desligada');
  const motivoPaciente = lida.paciente && lida.situacao ? motivoDoPaciente(lida.paciente, lida.situacao, uso) : 'paciente_indisponivel';
  if (motivoPaciente) return falhar(motivoPaciente);
  if (!lida.arquivo) return falhar('exame_indisponivel');
  if (!deps.provedor) return falhar(deps.modo === 'anthropic' || deps.modo === 'bedrock-eu' ? 'credencial_invalida' : 'ia_desligada');
  // D3/D5 (Plano 14A, revisão da T3): o provedor deste worker tem de atender, na região dele, o modelo gravado na tarefa
  // pelo app (que pode estar com outra configuração na janela de deploy ou na troca de IA_PROVEDOR). Recusa aqui, ANTES do
  // portão: sem `saiu_em`, sem "Laudo enviado à IA" e com estorno — a recusa dentro de lerDocumento viria depois do portão
  // e registraria uma transferência que não aconteceu.
  if (!deps.provedor.aceita(t.modelo as ModeloIA, deps.geo)) {
    logger.warn({ tarefaId: t.id, tenantId: d.tenantId, modelo: t.modelo, provedor: deps.provedor.nome, geo: deps.geo }, 'provedor de IA do worker não atende o modelo da tarefa');
    return falhar('ia_desligada');
  }

  // (3) prepara o arquivo (regra 9: lê pelo caminho do exame); nada sai se não der
  let arquivo: ArquivoPreparado;
  try {
    // D4 (Plano 14A): o limite do pedido é o do provedor em uso; acima dele, arquivo_invalido aqui, antes do portão
    arquivo = await prepararLaudo(await readFile(resolverCaminho(deps.dataDir, lida.arquivo)), { limitePedidoBytes: deps.provedor.limitePedidoBytes });
  } catch (e) {
    if (e instanceof PreparoError) return falhar(e.motivo);
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return falhar('exame_indisponivel');
    throw e;
  }
  const pedido: PedidoLeitura = {
    modelo: t.modelo as ModeloIA, geo: deps.geo, sistema: SISTEMA_LEITURA, instrucao: INSTRUCAO_LEITURA, arquivo,
    schema: SCHEMA_LEITURA, maxTokens: MAX_TOKENS_LEITURA, esforco: ESFORCO_LEITURA,
  };
  await deps.depoisDoPreparo?.();
  if (deps.abortado?.()) return 'ignorada';

  // (4) PORTÃO DO ENVIO (RN-100, RN-104, D4; Review Focus 4). Numa transação só, logo antes do primeiro contato com o
  // provedor, na ordem de travas da spec (§5.5): paciente FOR SHARE (serializa com o FOR UPDATE de
  // carregarPacienteParaEscrita em registrarRetiradaPelaNutri, atenderPedidoExclusao e excluirExame, e com o do job
  // ia-retirada) → exame FOR SHARE (o mesmo arquivo_path; serializa com o DELETE) → tenant FOR SHARE (serializa com
  // desativarIa, definirIaLiberada e a suspensão) → tarefa → ia_uso → plataforma. Reconfere tudo; grava `enviado_em`
  // (pode ter sido processado), `saiu_em` (registro conservador da primeira saída, nunca volta a nulo) e `destino`
  // (RN-109, Plano 14A) só se a tarefa ainda está "processando" e sem envio (RETURNING: sem linha, outra execução já
  // marcou ou a varredura encerrou → não chama); reduz a reserva ao teto das páginas; grava a auditoria "Laudo enviado
  // à IA" (exportar/ia, ator nulo, sem conteúdo). Só depois do commit o laudo sai.
  const teto = custoMaximoDoArquivo(pedido.modelo, pedido.geo, arquivo);
  const portao = await withTenant(
    ctx,
    async (tx): Promise<MotivoFalha | 'ignorada' | null> => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId)).for('share');
      const [e] = t.examId ? await tx.select({ arquivo: exams.arquivoPath }).from(exams).where(eq(exams.id, t.examId)).for('share') : [];
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa' || !deps.destino) return 'ia_desligada';
      // D6 (RN-109): a tarefa que já saiu para um destino (tentativa anterior) não sai para outro
      if (t.destino && t.destino !== deps.destino) return 'ia_desligada';
      if (!p) return 'paciente_indisponivel';
      // CS-105 / RN-108: a autorização relida com o paciente travado (FOR SHARE) — serializa com a retirada (FOR UPDATE)
      const doPaciente = motivoDoPaciente(p, await autorizacaoDoPaciente(tx, p.id, deps.destino), uso);
      if (doPaciente) return doPaciente;
      if (!e || e.arquivo !== lida.arquivo) return 'exame_indisponivel';
      const marcada = await tx
        .update(iaTarefas)
        .set({ enviadoEm: agora(), saiuEm: t.saiuEm ?? agora(), destino: t.destino ?? deps.destino, updatedAt: agora() })
        .where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'), isNull(iaTarefas.enviadoEm)))
        .returning({ id: iaTarefas.id });
      if (!marcada.length) return 'ignorada';
      await reduzirReserva(tx, t.id, teto, agora());
      await recordAudit(tx, { acao: 'exportar', entidade: 'ia', entidadeId: t.id, patientId: t.patientId });
      return null;
    },
    db,
  );
  if (portao === 'ignorada') return 'ignorada';
  if (portao) return falhar(portao);

  // (5) chama, uma vez (o SDK não repete: maxRetries 0)
  const inicio = Date.now();
  let r: RespostaLeitura;
  try {
    r = await deps.provedor.lerDocumento(pedido);
  } catch (e) {
    const tipo = e instanceof ErroProvedor ? e.tipo : 'incerto';
    logger.warn({ tarefaId: t.id, tenantId: d.tenantId, tipo, status: e instanceof ErroProvedor ? e.status : null, requestId: e instanceof ErroProvedor ? e.requestId : null }, 'provedor de IA recusou ou falhou');
    if (tipo === 'nao_enviado' || tipo === 'repetir') {
      // pode repetir: limpa só a marca de "pode ter sido processado"; saiu_em e a auditoria ficam (registro conservador)
      await withTenant(ctx, (tx) => tx.update(iaTarefas).set({ enviadoEm: null, updatedAt: agora() }).where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'))), db);
      if (deps.ultimaTentativa) return falhar('provedor_indisponivel');
      throw new RepetirIaError(`provedor: ${tipo}`);
    }
    const motivo: Record<Exclude<typeof tipo, 'nao_enviado' | 'repetir'>, MotivoFalha> = {
      incerto: 'resultado_incerto', credencial: 'credencial_invalida', limite_de_gasto: 'teto_plataforma', grande_demais: 'arquivo_invalido', pedido_invalido: 'resposta_invalida',
    };
    return falhar(motivo[tipo], tipo === 'incerto' ? 'manter' : 'estornar');
  }

  // (6) valida e grava, com o acerto, numa transação; confere de novo o que pode ter mudado durante a chamada: a tarefa
  // (varredura, cancelamento), a IA do consultório (desativada, bloqueada pela admin, tenant suspenso), o paciente e o
  // exame (excluído → sem linha, e exam_id nulo pelo SET NULL). Resultado que chega depois de qualquer mudança não é
  // gravado. Com as MESMAS travas do portão, na ordem da spec (§5.5): paciente FOR SHARE → exame FOR SHARE → tenant FOR
  // SHARE → tarefa FOR UPDATE → (acertar) ia_uso → plataforma. Sem elas, uma mudança ainda sem commit (a retirada,
  // excluirExame e a exclusão atendida travam o paciente; desativarIa, o tenant) não é vista aqui, e o cancelarTarefas
  // dela, que ainda vê "processando", pula a linha: ficaria uma "pronta" com o resultado (revisão da T11). Com elas, ou
  // este passo espera o commit e vê a mudança, ou a mudança espera e o cancelarTarefas dela encontra a "pronta" já gravada
  // e a esvazia. O bloqueio da admin (definirIaLiberada(false)) e a suspensão do consultório também gravam o tenant, mas
  // NÃO chamam cancelarTarefas: pela D19 (spec §5.6), só impedem novos pedidos e envios — se o commit deles vier antes,
  // este passo vê a mudança e termina com `ia_desligada`; se vier depois, a "pronta" gravada aqui segue aplicável até
  // vencer, como as que já estavam prontas antes do bloqueio (a admin não toca ia_tarefas, regra 1). A suspensão também
  // não as esvazia: a spec só esvazia na desativação, no "Não usar IA" e nas exclusões; com o consultório suspenso
  // ninguém entra no painel, e a varredura vence a sugestão em 7 dias.
  const custo = custoMicroUsd(pedido.modelo, pedido.geo, r.uso);
  const v = r.tipo === 'ok' ? validarRespostaLeitura(r.texto, arquivo.tipo === 'pdf' ? arquivo.paginas : 1) : null;
  const fim = await withTenant(
    ctx,
    async (tx): Promise<{ status: 'pronta' | 'falhou'; motivo: MotivoFalha | null }> => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId)).for('share');
      const [e] = t.examId ? await tx.select({ id: exams.id }).from(exams).where(eq(exams.id, t.examId)).for('share') : [];
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      const [atual] = await tx.select({ status: iaTarefas.status, examId: iaTarefas.examId }).from(iaTarefas).where(eq(iaTarefas.id, t.id)).for('update');
      // Plano 14A (RN-108): a retirada que chegou durante a chamada — o resultado não é gravado (o custo é)
      const doPaciente = p ? motivoDoPaciente(p, await autorizacaoDoPaciente(tx, p.id, deps.destino), uso) : 'paciente_indisponivel';
      let motivo: MotivoFalha | null = null;
      if (atual?.status !== 'processando') motivo = 'interrompida';
      else if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa') motivo = 'ia_desligada';
      else if (doPaciente) motivo = doPaciente;
      else if (!atual.examId || !e) motivo = 'exame_indisponivel';
      else if (r.tipo === 'recusa') motivo = 'recusa';
      else if (r.tipo === 'cortada' || !v || v.tipo === 'invalida') motivo = 'resposta_invalida';
      else if (v.tipo === 'nao_reconhecido') motivo = 'documento_nao_reconhecido';
      else if (v.tipo === 'vazio') motivo = 'nada_encontrado';
      const base = { custoMicroUsd: custo, concluidoEm: agora(), updatedAt: agora() };
      if (motivo === null && v?.tipo === 'ok') {
        await tx.update(iaTarefas).set({ ...base, status: 'pronta', resultado: v.resultado, expiraEm: new Date(agora().getTime() + PRAZO_SUGESTAO_DIAS * 86_400_000) }).where(eq(iaTarefas.id, t.id));
      } else if (atual?.status === 'processando') {
        await tx.update(iaTarefas).set({ ...base, status: 'falhou', erro: motivo, resultado: null }).where(eq(iaTarefas.id, t.id));
      }
      await acertar(tx, { tarefaId: t.id, custoMicroUsd: custo, uso: r.uso, recusaCategoria: r.tipo === 'recusa' ? r.categoria : null, requestId: r.requestId, agora: agora() });
      return motivo === null ? { status: 'pronta', motivo: null } : { status: 'falhou', motivo };
    },
    db,
  );
  logger.info(
    { tarefaId: t.id, tenantId: d.tenantId, modelo: pedido.modelo, promptVersao: t.promptVersao, tokensEntrada: r.uso.entrada, tokensSaida: r.uso.saida, custoMicroUsd: custo, duracaoMs: Date.now() - inicio, status: fim.status, motivo: fim.motivo, requestId: r.requestId },
    'leitura de laudo pela IA',
  );
  await avisarSeChegou80Ia(db, d.tenantId, agora(), deps.appUrl).catch((err: unknown) => logger.error({ tenantId: d.tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha no aviso de 80% da IA'));
  return fim.status;
}

const ATIVAS = ['na_fila', 'processando', 'pronta'] as const;

/**
 * A varredura de UM tenant (dentro do withTenant do worker). Separada para o teste não varrer os tenants de outros arquivos.
 * Trava de uma vez, por id, todas as tarefas que vai mudar (paradas, esquecidas e prontas vencidas) ANTES de qualquer
 * estorno: a ordem de cancelarTarefas (tarefas → ia_uso → plataforma). Travar as vencidas só depois do estorno fecharia
 * um ciclo com quem cancela (já travou a pronta e vai estornar na linha do mês da plataforma) — revisão final, Minor 11.
 * Plano 14A (D15, RN-108): também cancela as tarefas ativas de paciente SEM autorização vigente para o uso da tarefa
 * (rede de segurança do job ia-retirada): na fila → cancelada com estorno; processando → cancelada, com estorno se nada
 * saiu e a reserva mantida (incerta) se `enviado_em` está gravado; pronta → cancelada e esvaziada. A situação é lida
 * antes (sem trava) e a trava única por id continua antes de qualquer estorno.
 */
export async function expirarTarefasDoTenant(tx: Tx, agora: Date, destino: DestinoIA | null): Promise<{ interrompidas: number; expiradas: number; canceladas: number }> {
  const parada = and(eq(iaTarefas.status, 'processando'), lt(iaTarefas.iniciadoEm, new Date(agora.getTime() - PROCESSANDO_MAX_MS)));
  const esquecida = and(eq(iaTarefas.status, 'na_fila'), lt(iaTarefas.criadoEm, new Date(agora.getTime() - NA_FILA_MAX_MS)));
  const vencida = and(eq(iaTarefas.status, 'pronta'), isNotNull(iaTarefas.expiraEm), lt(iaTarefas.expiraEm, agora));
  const candidatas = await tx.select({ id: iaTarefas.id, patientId: iaTarefas.patientId, tipo: iaTarefas.tipo }).from(iaTarefas).where(inArray(iaTarefas.status, [...ATIVAS]));
  const situacoes = new Map<string, SituacaoAutorizacao>();
  const semAutorizacao = new Set<string>();
  for (const c of candidatas) {
    if (!situacoes.has(c.patientId)) situacoes.set(c.patientId, await autorizacaoDoPaciente(tx, c.patientId, destino));
    if (!vigentePara(situacoes.get(c.patientId)!, USO_DA_TAREFA[c.tipo as TipoTarefa])) semAutorizacao.add(c.id);
  }
  const alvo = await tx
    .select({ id: iaTarefas.id, status: iaTarefas.status, enviadoEm: iaTarefas.enviadoEm })
    .from(iaTarefas)
    .where(or(parada, esquecida, vencida, semAutorizacao.size ? inArray(iaTarefas.id, [...semAutorizacao]) : undefined))
    .orderBy(asc(iaTarefas.id))
    .for('update');
  let interrompidas = 0;
  let expiradas = 0;
  let canceladas = 0;
  for (const x of alvo) {
    if (semAutorizacao.has(x.id)) {
      if (!(ATIVAS as readonly string[]).includes(x.status)) continue; // mudou entre a leitura e a trava (aplicada, descartada…)
      await tx.update(iaTarefas).set({ status: 'cancelada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: null, updatedAt: agora }).where(eq(iaTarefas.id, x.id));
      if (x.status === 'processando' && x.enviadoEm) await marcarIncerto(tx, x.id, agora);
      else if (x.status !== 'pronta') await estornar(tx, x.id, agora);
      canceladas++;
      continue;
    }
    if (x.status === 'pronta') {
      await tx.update(iaTarefas).set({ status: 'expirada', resultado: null, parametros: null, updatedAt: agora }).where(eq(iaTarefas.id, x.id));
      expiradas++;
      continue;
    }
    await tx.update(iaTarefas).set({ status: 'falhou', erro: 'interrompida', resultado: null, parametros: null, concluidoEm: agora, updatedAt: agora }).where(eq(iaTarefas.id, x.id));
    if (x.enviadoEm) await marcarIncerto(tx, x.id, agora);
    else await estornar(tx, x.id, agora);
    interrompidas++;
  }
  return { interrompidas, expiradas, canceladas };
}

/**
 * Varredura (fila `expirar-ia`, de 15 em 15 min): worker que caiu, job perdido e sugestão vencida (RN-106); Plano 14A
 * (D15): tarefas de paciente sem autorização vigente (`destino` = o do provedor em uso). Um tenant com erro não para os
 * outros.
 */
export async function expirarTarefasIA(db: Db, agora: Date, destino: DestinoIA | null): Promise<{ interrompidas: number; expiradas: number; canceladas: number }> {
  let interrompidas = 0;
  let expiradas = 0;
  let canceladas = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    try {
      const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, agora, destino), db);
      interrompidas += r.interrompidas;
      expiradas += r.expiradas;
      canceladas += r.canceladas;
    } catch (err) {
      logger.error({ tenantId: t.id, err: err instanceof Error ? err.name : 'erro' }, 'falha na varredura das tarefas de IA');
    }
  }
  if (interrompidas || expiradas || canceladas) logger.info({ interrompidas, expiradas, canceladas }, 'varredura das tarefas de IA');
  return { interrompidas, expiradas, canceladas };
}
