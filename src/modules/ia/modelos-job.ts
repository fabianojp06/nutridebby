import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { anamnesisTemplates, iaGeracoesModelos, mealPlans, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { validarModelo, type Pergunta } from '@/modules/pacientes/anamnese-tipos';
import { gravarConteudoRascunhoTx } from '@/modules/plano-alimentar/rascunho';
import { buscarTenant, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { avisarCredencialInvalida, avisarTetoGlobal } from './alertas';
import { AREA_ROTULO, MAX_VOLTAS_MODELOS, PRAZO_LACO_MS, type AreaModelosIA, type ModeloIA, type MotivoFalha } from './constantes';
import { acertar, avisarSeChegou80Ia, estornar, marcarIncerto } from './cota';
import { buscaDoTenant, executarFerramenta, FERRAMENTAS_ALIMENTOS, novoCatalogo, type BuscaAlimentos, type CatalogoDaTarefa } from './ferramentas-alimentos';
import { ESFORCO_MODELOS, instrucaoModelos, SCHEMA_MODELOS, SISTEMA_MODELOS } from './instrucoes/modelos';
import { ErroNoLaco, rodarLaco, type FimDoLaco } from './laco-ferramentas';
import { RepetirIaError, type DepsJobIA, type FimDoJob } from './leitura-job';
import { estadoIaDoTenant } from './modo';
import { validarPlanoIa, type PlanoIa } from './plano-ia';
import { MAX_TOKENS_VOLTA } from './precos';
import type { TipoErroProvedor } from './provedor';

/**
 * Plano 14B (US-123, RN-124, D3–D6): o job do pacote de modelos, na fila `ia-assistente`. Só o worker importa (guarda de
 * grafo). Sem paciente: o "portão" grava só `enviado_em` (sem auditoria: não há prontuário). Ordem: (1) pega a geração →
 * (2) a IA do consultório, o provedor e o modelo → (3) portão (tenant FOR SHARE → geração) → (4) laço → (5) valida →
 * (6) grava os 3 modelos juntos, com o acerto, ou nenhum. Nada de conteúdo em log (RNF-104): só ids, números e motivo.
 */
export type DadosJobAssistente = { tenantId: string; tarefaId: string } | { tenantId: string; geracaoId: string };
export type DepsJobAssistente = Omit<DepsJobIA, 'dataDir'> & { modeloAssistente: ModeloIA; tetoRascunhoMicroUsd: number; buscar?: (tenantId: string) => BuscaAlimentos };

const PROCESSANDO_MAX_MS = 15 * 60_000;
const NA_FILA_MAX_MS = 30 * 60_000;
/** O que fazer com a reserva ao falhar: estornar (nada saiu), manter (incerto) ou acertar pelo que as voltas custaram. */
type Reserva = 'estornar' | 'manter' | { acertar: FimDoLaco | ErroNoLaco };

async function encerrar(deps: DepsJobAssistente, ctx: TenantContext, id: string, motivo: MotivoFalha, reserva: Reserva): Promise<FimDoJob> {
  const agora = (deps.agora ?? (() => new Date()))();
  const contas = typeof reserva === 'object' ? reserva.acertar : null;
  await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .update(iaGeracoesModelos)
        .set({ status: 'falhou', erro: motivo, concluidoEm: agora, updatedAt: agora, ...(contas ? { voltas: contas.voltas, custoMicroUsd: contas.custoMicroUsd } : {}) })
        .where(and(eq(iaGeracoesModelos.id, id), inArray(iaGeracoesModelos.status, ['na_fila', 'processando'])))
        .returning({ id: iaGeracoesModelos.id });
      if (!r.length) return;
      if (reserva === 'estornar') await estornar(tx, id, agora);
      else if (reserva === 'manter') await marcarIncerto(tx, id, agora);
      else {
        const a = reserva.acertar;
        const requestId = a instanceof ErroNoLaco ? a.erro.requestId : a.requestId;
        const recusaCategoria = a instanceof ErroNoLaco || a.tipo !== 'parou' ? null : a.recusaCategoria;
        await acertar(tx, { tarefaId: id, custoMicroUsd: a.custoMicroUsd, uso: a.uso, recusaCategoria, requestId, agora });
      }
    },
    deps.db,
  );
  logger.warn(
    { geracaoId: id, tenantId: ctx.tenantId, finalidade: 'modelos', motivo, voltas: contas?.voltas ?? 0, custoMicroUsd: contas?.custoMicroUsd ?? null },
    'modelos sugeridos pela IA não gerados',
  );
  const alertas = deps.alertas ?? { credencial: (a: Date) => avisarCredencialInvalida(deps.db, a, deps.appUrl), teto: (a: Date) => avisarTetoGlobal(deps.db, a, deps.appUrl) };
  if (motivo === 'credencial_invalida') await alertas.credencial(agora).catch(() => undefined);
  if (motivo === 'teto_plataforma') await alertas.teto(agora).catch(() => undefined);
  return 'falhou';
}

/** RN-105 / D4 para o laço: o que fazer com o erro do provedor, sabendo quantas voltas já saíram. */
export function motivoDoErro(e: ErroNoLaco): { motivo: MotivoFalha; reserva: Reserva } | 'repetir' {
  const t: TipoErroProvedor = e.erro.tipo;
  if (e.voltas === 0 && (t === 'nao_enviado' || t === 'repetir')) return 'repetir';
  if (t === 'incerto') return { motivo: 'resultado_incerto', reserva: 'manter' };
  const motivo: MotivoFalha =
    t === 'credencial' ? 'credencial_invalida' : t === 'limite_de_gasto' ? 'teto_plataforma' : t === 'nao_enviado' || t === 'repetir' ? 'provedor_indisponivel' : 'resposta_invalida';
  return { motivo, reserva: e.voltas === 0 ? 'estornar' : { acertar: e } };
}

export async function processarGeracaoModelos(d: { tenantId: string; geracaoId: string }, deps: DepsJobAssistente): Promise<FimDoJob> {
  const agora = deps.agora ?? (() => new Date());
  const ctx: TenantContext = { tenantId: d.tenantId, role: 'worker' };
  const falhar = (m: MotivoFalha, r: Reserva = 'estornar') => encerrar(deps, ctx, d.geracaoId, m, r);

  // (1) pega a geração: "na_fila", ou "processando" sem envio (nova tentativa de antes do envio)
  const g = await withTenant(
    ctx,
    async (tx) => {
      const [x] = await tx.select().from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, d.geracaoId)).for('update');
      if (!x || (x.status !== 'na_fila' && x.status !== 'processando')) return null;
      if (x.enviadoEm) return { x, jaEnviada: true as const };
      await tx.update(iaGeracoesModelos).set({ status: 'processando', iniciadoEm: x.iniciadoEm ?? agora(), updatedAt: agora() }).where(eq(iaGeracoesModelos.id, x.id));
      return { x, jaEnviada: false as const };
    },
    deps.db,
  );
  if (!g) return 'ignorada';
  if (g.jaEnviada) return falhar('resultado_incerto', 'manter'); // D4: nunca reenviar o que pode ter sido processado

  // (2) a parte do consultório da RN-100 (sem a retenção nem paciente, A-D22 (c)); conferência barata, o portão relê
  const tenant = await buscarTenant(deps.db, d.tenantId);
  if (!tenant || estadoIaDoTenant(tenant, deps.modo) !== 'ativa') return falhar('ia_desligada');
  if (!deps.provedor) return falhar(deps.modo === 'anthropic' || deps.modo === 'bedrock-eu' ? 'credencial_invalida' : 'ia_desligada');
  // D3/D5 (Plano 14A): o provedor deste worker tem de atender, na região dele, o modelo gravado pelo app
  const modelo = g.x.modelo as ModeloIA;
  if (!deps.provedor.aceita(modelo, deps.geo)) {
    logger.warn({ geracaoId: d.geracaoId, tenantId: d.tenantId, modelo, provedor: deps.provedor.nome, geo: deps.geo }, 'provedor de IA do worker não atende o modelo da geração');
    return falhar('ia_desligada');
  }
  if (deps.abortado?.()) return 'ignorada';

  // (3) portão: a IA ainda ativa e a geração ainda "processando" e sem envio (RETURNING: outra execução não envia de novo)
  const portao = await withTenant(
    ctx,
    async (tx): Promise<MotivoFalha | 'ignorada' | null> => {
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      if (!tn || estadoIaDoTenant(tn, deps.modo) !== 'ativa') return 'ia_desligada';
      const r = await tx
        .update(iaGeracoesModelos)
        .set({ enviadoEm: agora(), updatedAt: agora() })
        .where(and(eq(iaGeracoesModelos.id, d.geracaoId), eq(iaGeracoesModelos.status, 'processando'), isNull(iaGeracoesModelos.enviadoEm)))
        .returning({ id: iaGeracoesModelos.id });
      return r.length ? null : 'ignorada';
    },
    deps.db,
  );
  if (portao === 'ignorada') return 'ignorada';
  if (portao) return falhar(portao);

  // (4) o laço (D5/D6): até 24 voltas, 12 min e o teto da reserva (US$ 1,00) para o pacote inteiro
  const area = g.x.area as AreaModelosIA;
  const cat = novoCatalogo();
  const buscar = (deps.buscar ?? ((t: string) => buscaDoTenant(t, deps.db)))(d.tenantId);
  const inicio = Date.now();
  let fim: FimDoLaco;
  try {
    fim = await rodarLaco({
      provedor: deps.provedor,
      pedido: { finalidade: 'modelos', modelo, geo: deps.geo, sistema: SISTEMA_MODELOS, ferramentas: FERRAMENTAS_ALIMENTOS, schema: SCHEMA_MODELOS, maxTokens: MAX_TOKENS_VOLTA, esforco: ESFORCO_MODELOS },
      inicio: instrucaoModelos(area),
      executar: (c) => executarFerramenta(c, cat, buscar),
      limites: { voltas: MAX_VOLTAS_MODELOS, tetoMicroUsd: g.x.reservaMicroUsd, prazoMs: PRAZO_LACO_MS },
    });
  } catch (e) {
    if (!(e instanceof ErroNoLaco)) throw e;
    logger.warn({ geracaoId: d.geracaoId, tenantId: d.tenantId, finalidade: 'modelos', tipo: e.erro.tipo, status: e.erro.status, voltas: e.voltas, requestId: e.erro.requestId }, 'provedor de IA recusou ou falhou');
    const m = motivoDoErro(e);
    if (m === 'repetir') {
      // nada saiu (1ª volta): limpa o envio e o início — R14: a varredura conta os 15 min a partir da nova tentativa
      // (o passo (1) dela grava o início; até lá, conta do relançamento, `updated_at`)
      await withTenant(
        ctx,
        (tx) =>
          tx
            .update(iaGeracoesModelos)
            .set({ enviadoEm: null, iniciadoEm: null, updatedAt: agora() })
            .where(and(eq(iaGeracoesModelos.id, d.geracaoId), eq(iaGeracoesModelos.status, 'processando'))),
        deps.db,
      );
      if (deps.ultimaTentativa) return falhar('provedor_indisponivel');
      throw new RepetirIaError(`provedor: ${e.erro.tipo}`);
    }
    return falhar(m.motivo, m.reserva);
  }
  const numeros = { geracaoId: d.geracaoId, tenantId: d.tenantId, finalidade: 'modelos', voltas: fim.voltas, tokensEntrada: fim.uso.entrada, tokensSaida: fim.uso.saida, custoMicroUsd: fim.custoMicroUsd, duracaoMs: Date.now() - inicio, requestId: fim.requestId };
  // parou antes de passar do limite (voltas, prazo, custo), recusa ou resposta cortada; sem nenhuma volta, nada saiu
  if (fim.tipo === 'parou') return falhar(fim.motivo, fim.voltas === 0 ? 'estornar' : { acertar: fim });

  // (5) valida os três modelos; qualquer um fora do formato → nenhum é gravado
  const pacote = lerPacote(fim.texto, cat);
  if (!pacote) return falhar('resposta_invalida', { acertar: fim });

  // (6) grava juntos, numa transação, com a IA ainda ativa e a geração ainda "processando". Travas: tenant FOR SHARE
  // (serializa com desativarIa, a admin e a suspensão) → geração FOR UPDATE (com a varredura) → ia_uso → plataforma.
  const gravou = await withTenant(
    ctx,
    async (tx): Promise<'pronta' | 'interrompida' | 'ia_desligada'> => {
      const [tn] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      const [atual] = await tx.select({ status: iaGeracoesModelos.status }).from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, d.geracaoId)).for('update');
      if (atual?.status !== 'processando') return 'interrompida';
      if (!tn || estadoIaDoTenant(tn, deps.modo) !== 'ativa') return 'ia_desligada';
      let descartados = pacote.descartados;
      for (const p of pacote.planos) {
        const [m] = await tx
          .insert(mealPlans)
          .values({ tenantId: d.tenantId, isTemplate: true, titulo: `${AREA_ROTULO[area]}: ${p.titulo}`.slice(0, 120), metaKcal: p.metaKcal, orientacoes: p.orientacoes, iaGeracaoId: d.geracaoId })
          .returning({ id: mealPlans.id });
        descartados += (await gravarConteudoRascunhoTx(tx, d.tenantId, null, m.id, p.refeicoes)).foraDoCatalogo;
      }
      await tx.insert(anamnesisTemplates).values({
        tenantId: d.tenantId, nome: `${AREA_ROTULO[area]}: ${pacote.anamnese.nome}`.slice(0, 80), schema: { perguntas: pacote.anamnese.perguntas }, iaGeracaoId: d.geracaoId,
      });
      await tx
        .update(iaGeracoesModelos)
        .set({ status: 'pronta', itensDescartados: descartados, voltas: fim.voltas, custoMicroUsd: fim.custoMicroUsd, concluidoEm: agora(), updatedAt: agora() })
        .where(eq(iaGeracoesModelos.id, d.geracaoId));
      await acertar(tx, { tarefaId: d.geracaoId, custoMicroUsd: fim.custoMicroUsd, uso: fim.uso, recusaCategoria: null, requestId: fim.requestId, agora: agora() });
      return 'pronta';
    },
    deps.db,
  );
  if (gravou === 'ia_desligada') return falhar('ia_desligada', { acertar: fim });
  if (gravou === 'interrompida') {
    // a varredura (ou outra execução) já encerrou a geração e cuidou da reserva: o resultado não é gravado
    logger.warn({ ...numeros, motivo: 'interrompida' }, 'modelos sugeridos pela IA não gerados');
    return 'ignorada';
  }
  logger.info(numeros, 'modelos sugeridos pela IA');
  await avisarSeChegou80Ia(deps.db, d.tenantId, agora(), deps.appUrl).catch((err: unknown) => logger.error({ tenantId: d.tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha no aviso de 80% da IA'));
  return 'pronta';
}

type PacoteValido = { planos: PlanoIa[]; anamnese: { nome: string; perguntas: Pergunta[] }; descartados: number };

/**
 * Os três modelos do pacote, revalidados (planos por validarPlanoIa; anamnese por validarModelo, a do editor). Fora do
 * formato, sem os 2 planos, plano sem refeição válida ou anamnese inválida → `null` (nenhum é gravado). Da pergunta só
 * passam os campos do editor (o id é sempre novo).
 */
function lerPacote(texto: string, cat: CatalogoDaTarefa): PacoteValido | null {
  let obj: unknown;
  try {
    obj = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as { planos?: unknown; anamnese?: unknown };
  if (!Array.isArray(o.planos) || o.planos.length !== 2 || !o.anamnese || typeof o.anamnese !== 'object') return null;
  const planos: PlanoIa[] = [];
  for (const bruto of o.planos) {
    const p = validarPlanoIa(bruto, cat);
    if (!p || !p.refeicoes.length) return null;
    planos.push(p);
  }
  const an = o.anamnese as { nome?: unknown; perguntas?: unknown };
  const perguntas = Array.isArray(an.perguntas)
    ? an.perguntas.map((q) => {
        const x = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
        return { tipo: x.tipo, rotulo: x.rotulo, obrigatoria: x.obrigatoria, unidade: x.unidade, opcoes: x.opcoes };
      })
    : an.perguntas;
  const a = validarModelo({ nome: an.nome, perguntas });
  if (!a.ok) return null;
  return { planos, anamnese: { nome: a.nome, perguntas: a.perguntas }, descartados: planos.reduce((n, p) => n + p.descartados, 0) };
}

/**
 * D20: a varredura das gerações de UM tenant (dentro do withTenant worker). Separada para o teste não varrer os tenants
 * de outros arquivos. `processando` há mais de 15 min (contados do início desta tentativa; na relançada ainda sem início,
 * do relançamento — R14) e `na_fila` há mais de 30 min → `falhou` (`interrompida`): estorno se nada saiu, reserva incerta
 * se `enviado_em` está gravado. Trava todas de uma vez, por id, antes de qualquer estorno (a ordem de cancelarGeracoes).
 */
export async function expirarGeracoesDoTenant(tx: Tx, agora: Date): Promise<{ interrompidas: number }> {
  const limiteProcessando = new Date(agora.getTime() - PROCESSANDO_MAX_MS);
  const alvo = await tx
    .select({ id: iaGeracoesModelos.id, enviadoEm: iaGeracoesModelos.enviadoEm })
    .from(iaGeracoesModelos)
    .where(
      or(
        and(eq(iaGeracoesModelos.status, 'processando'), lt(sql`coalesce(${iaGeracoesModelos.iniciadoEm}, ${iaGeracoesModelos.updatedAt})`, limiteProcessando)),
        and(eq(iaGeracoesModelos.status, 'na_fila'), lt(iaGeracoesModelos.criadoEm, new Date(agora.getTime() - NA_FILA_MAX_MS))),
      ),
    )
    .orderBy(asc(iaGeracoesModelos.id))
    .for('update');
  for (const x of alvo) {
    await tx.update(iaGeracoesModelos).set({ status: 'falhou', erro: 'interrompida', concluidoEm: agora, updatedAt: agora }).where(eq(iaGeracoesModelos.id, x.id));
    if (x.enviadoEm) await marcarIncerto(tx, x.id, agora);
    else await estornar(tx, x.id, agora);
  }
  return { interrompidas: alvo.length };
}

/**
 * Varredura das gerações (fila `expirar-ia`, de 15 em 15 min, ao lado de expirarTarefasIA). Fica aqui, e não em
 * leitura-job.ts, para não criar import circular entre os dois jobs (R9). Um tenant com erro não para os outros.
 */
export async function expirarGeracoesIA(db: Db, agora: Date): Promise<{ interrompidas: number }> {
  let interrompidas = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    try {
      interrompidas += (await withTenant({ tenantId: t.id, role: 'worker' }, (tx) => expirarGeracoesDoTenant(tx, agora), db)).interrompidas;
    } catch (err) {
      logger.error({ tenantId: t.id, err: err instanceof Error ? err.name : 'erro' }, 'falha na varredura das gerações de modelos da IA');
    }
  }
  if (interrompidas) logger.info({ interrompidas }, 'varredura das gerações de modelos da IA');
  return { interrompidas };
}
