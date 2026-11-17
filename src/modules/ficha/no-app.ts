import { and, count, countDistinct, desc, eq, gte, isNull, max, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { accessEvents, contents, diaryEntries, foods, iaNutriParticipacoes, lembretesRotina, mealItems, mealPlans, meals, patients, pushSubscriptions, tenants } from '@/db/schema';
import { TenantContextError, withTenant, type TenantContext } from '@/db/tenant';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { situacaoDoAcesso } from '@/modules/pacientes/convite-paciente';
import { formatarDataHora, hojeNoFuso } from '@/modules/pacientes/datas';
import { SECOES_DA_FICHA } from './secoes';
import { MSG_NO_APP } from './textos';
import type { TxDePaciente } from './tipos';

export type EstadoNoApp = 'ativo' | 'pendente' | 'expirado' | 'sem_convite' | 'arquivado' | 'bloqueado';

export type NoApp = {
  acesso: { estado: EstadoNoApp; ultimoAcesso: string | null /* AAAA-MM-DD no fuso */; textoDoConvite: string | null };
  notificacoes: { aparelhos: number; whatsapp: boolean };
  plano: { publicadoEm: string | null /* AAAA-MM-DD no fuso */; listaDeCompras: boolean };
  /** Plano 17, contado no contexto `nutri`; null sem lembrete configurado. */
  lembretes: { ligados: number; desligadosPeloPaciente: number; pausados: boolean } | null;
  pesoOculto: boolean;
  gorduraNoApp: boolean;
  /** null sem a IA Nutri ativada no consultório. */
  iaNutri: 'ligada' | 'desligada' | null;
  /** Por id de seção (as que têm `noApp`) + 'conteudos' e 'diario30d'; null sem acesso ativo. */
  contagens: Record<string, number> | null;
  /** Receitas sugeridas no plano publicado, contadas no contexto `nutri` (D24); null sem plano publicado. */
  receitasSugeridas: number | null;
  /** Por seção, os ids pedidos que o paciente vê (o selo "No app", RN-279). */
  visiveis: Record<string, string[]>;
};

/** RN-281: os registros do diário contados na página ("nos últimos 30 dias"). */
const DIAS_DO_DIARIO = 30;

/**
 * D16, RN-281: o contexto do paciente SEM login (`semConta`), só para contar o que o app mostra — a RLS do paciente (a
 * audiência do conteúdo, `paciente_so_emitidos`, `paciente_sem_rascunho`) decide, não um filtro reproduzido na sessão
 * `nutri`. Não exportado. Confere na própria transação que o banco está mesmo no papel de paciente, deste paciente, e só
 * então marca a transação como `TxDePaciente` (o único lugar que cria o tipo). Quem chama só conta e lê ids.
 */
async function comoPaciente<T>(db: Db, tenantId: string, patientId: string, fn: (tx: TxDePaciente) => Promise<T>): Promise<T> {
  return withTenant(
    { tenantId, role: 'paciente', patientId, semConta: true },
    async (tx) => {
      const r = await tx.execute(sql`select current_setting('app.role', true) as papel, current_setting('app.patient_id', true) as paciente`);
      const { papel, paciente } = r.rows[0] as { papel: string | null; paciente: string | null };
      if (papel !== 'paciente' || paciente !== patientId) throw new TenantContextError('a contagem do No app só roda no contexto do paciente');
      return fn(tx as TxDePaciente);
    },
    db,
  );
}

/**
 * Arquivado, bloqueado ou anonimizado: o paciente não vê nada no app e a página só mostra a linha do acesso — o resto vai
 * neutro, sem ter sido lido (minimização, LGPD art. 6º, III).
 */
function semAcesso(estado: 'arquivado' | 'bloqueado'): NoApp {
  return {
    acesso: { estado, ultimoAcesso: null, textoDoConvite: null },
    notificacoes: { aparelhos: 0, whatsapp: false },
    plano: { publicadoEm: null, listaDeCompras: false },
    lembretes: null,
    pesoOculto: false,
    gorduraNoApp: false,
    iaNutri: null,
    contagens: null,
    receitasSugeridas: null,
    visiveis: {},
  };
}

/**
 * Plano 18 (D16, D24, RN-279, RN-281): "No app do paciente" — o que o paciente vê hoje no app, pela nutricionista.
 * (0) Arquivado, bloqueado ou anonimizado: só a situação (`semAcesso`), sem ler mais nada. (1) Na sessão `nutri` (depois de
 * conferir que o paciente é deste consultório): situação e acesso, último dia de acesso,
 * aparelhos com notificação (a regra de `aparelhosComNotificacao` do Plano 17), WhatsApp, peso oculto, % de gordura, IA
 * Nutri, a data do plano publicado e a lista de compras (a regra de `listaDoPlano`), os lembretes (sem texto nem config)
 * e as receitas sugeridas no plano publicado (D24: a contagem não liga a liberação das receitas do plano, que só o
 * "Meu plano" do portal liga). (2) Só com o paciente ativo, não anonimizado e com conta: no contexto do paciente sem login,
 * reconferida ali a situação (arquivado, bloqueado ou anonimizado entre as transações → `semAcesso`), as contagens e os
 * ids visíveis de cada seção com `noApp`, os conteúdos da biblioteca e o diário dos últimos 30 dias.
 * Só contagens e ids; nenhuma leitura de dado de saúde é registrada (nada é devolvido além de números e ids).
 */
export async function noAppDoPaciente(
  ctx: TenantContext,
  patientId: string,
  itens: Record<string, string[]> = {},
  deps: { db?: Db; agora?: Date } = {},
): Promise<NoApp> {
  if (ctx.role !== 'nutri') throw new TenantContextError('o No app do paciente é só da sessão da nutricionista');
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();

  const doPainel = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ id: patients.id, userId: patients.userId, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
        .from(patients)
        .where(eq(patients.id, patientId));
      if (!p) throw new PacienteNaoEncontradoError();
      // minimização: arquivado, bloqueado e anonimizado só mostram a linha do acesso — nada mais é lido nem calculado
      if (p.status === 'arquivado' || p.status === 'bloqueado' || p.anonimizadoEm) return { fechado: p.status === 'arquivado' ? ('arquivado' as const) : ('bloqueado' as const) };
      const [m] = await tx
        .select({
          pesoOcultoNoAppEm: patients.pesoOcultoNoAppEm,
          whatsappOptinEm: patients.whatsappOptinEm,
          whatsappOptoutEm: patients.whatsappOptoutEm,
          lembretesPausadosEm: patients.lembretesPausadosEm,
        })
        .from(patients)
        .where(eq(patients.id, p.id));
      const [t] = await tx
        .select({ fuso: tenants.fuso, gordura: tenants.mostrarPercGorduraPaciente, iaNutriAtivadaEm: tenants.iaNutriAtivadaEm })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));
      const [ultimo] = await tx.select({ dia: max(accessEvents.dia) }).from(accessEvents).where(eq(accessEvents.patientId, p.id));
      const [push] = await tx.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.patientId, p.id));
      const [ia] = await tx
        .select({ liberadaEm: iaNutriParticipacoes.liberadaEm, bloqueadaEm: iaNutriParticipacoes.bloqueadaEm })
        .from(iaNutriParticipacoes)
        .where(eq(iaNutriParticipacoes.patientId, p.id));
      // RN-01: no máximo um publicado por paciente; a ordem só desempata por defesa
      const [plano] = await tx
        .select({ id: mealPlans.id, publicadoEm: mealPlans.publicadoEm })
        .from(mealPlans)
        .where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'publicado')))
        .orderBy(desc(mealPlans.versao))
        .limit(1);
      let listaDeCompras = false;
      let receitas: number | null = null;
      if (plano) {
        // a regra de `listaDoPlano`: algum item principal (sem `substitui_item_id`) com o alimento
        const [item] = await tx
          .select({ id: mealItems.id })
          .from(mealItems)
          .innerJoin(foods, eq(foods.id, mealItems.foodId))
          .where(and(eq(mealItems.planId, plano.id), isNull(mealItems.substituiItemId)))
          .limit(1);
        listaDeCompras = Boolean(item);
        // D24: as receitas das refeições do plano publicado cujo conteúdo está publicado (o `disponivel` de carregar.ts)
        const [r] = await tx
          .select({ n: countDistinct(meals.recipeContentId) })
          .from(meals)
          .innerJoin(contents, eq(contents.id, meals.recipeContentId))
          .where(and(eq(meals.planId, plano.id), eq(contents.status, 'publicado')));
        receitas = r?.n ?? 0;
      }
      // Plano 17: só as marcas (ligado pela equipe, desligado pelo paciente), nunca o texto nem a configuração
      const lembretes = await tx
        .select({ ligado: lembretesRotina.ligado, desligadoPeloPacienteEm: lembretesRotina.desligadoPeloPacienteEm })
        .from(lembretesRotina)
        .where(eq(lembretesRotina.patientId, p.id));
      return { fechado: null, p: { ...p, ...m }, t, ultimo: ultimo?.dia ?? null, aparelhos: push?.n ?? 0, ia, plano, listaDeCompras, receitas, lembretes };
    },
    db,
  );

  if (doPainel.fechado) return semAcesso(doPainel.fechado);

  const { p, t } = doPainel;
  const fuso = t?.fuso ?? 'America/Sao_Paulo';
  const situacao = await situacaoDoAcesso(ctx, p, db, agora);
  const estado: EstadoNoApp = situacao.estado;
  const textoDoConvite =
    situacao.estado === 'pendente'
      ? MSG_NO_APP.acesso.conviteAte(formatarDataHora(situacao.expiraEm, fuso))
      : situacao.estado === 'expirado'
        ? MSG_NO_APP.acesso.conviteExpirado
        : null;

  const comAcesso = p.status === 'ativo' && Boolean(p.userId);
  const doApp = comAcesso
    ? await comoPaciente(db, ctx.tenantId, p.id, async (tx) => {
        // a situação pode ter mudado entre as duas transações: reconferida aqui, antes de qualquer contagem
        const [agoraP] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, p.id));
        if (!agoraP || agoraP.status !== 'ativo' || agoraP.anonimizadoEm) return { fechado: agoraP?.status === 'arquivado' ? ('arquivado' as const) : ('bloqueado' as const) };
        const contagens: Record<string, number> = {};
        const visiveis: Record<string, string[]> = {};
        for (const s of SECOES_DA_FICHA) {
          if (!s.noApp) continue;
          contagens[s.id] = await s.noApp.contar(tx, p.id);
          const pedidos = itens[s.id];
          if (pedidos?.length) visiveis[s.id] = await s.noApp.visiveis(tx, p.id, pedidos);
        }
        // a audiência (política RESTRICTIVE paciente_conteudo_visivel e a etiqueta) é do banco; o feed só filtra o publicado
        const [c] = await tx.select({ n: count() }).from(contents).where(eq(contents.status, 'publicado'));
        contagens.conteudos = c?.n ?? 0;
        const desde = new Date(agora.getTime() - DIAS_DO_DIARIO * 24 * 60 * 60 * 1000);
        const [d] = await tx.select({ n: count() }).from(diaryEntries).where(and(eq(diaryEntries.patientId, p.id), gte(diaryEntries.dataHora, desde)));
        contagens.diario30d = d?.n ?? 0;
        return { fechado: null, contagens, visiveis };
      })
    : null;
  if (doApp?.fechado) return semAcesso(doApp.fechado);

  const ls = doPainel.lembretes;
  return {
    acesso: { estado, ultimoAcesso: doPainel.ultimo, textoDoConvite },
    notificacoes: { aparelhos: doPainel.aparelhos, whatsapp: Boolean(p.whatsappOptinEm) && !p.whatsappOptoutEm },
    plano: { publicadoEm: doPainel.plano?.publicadoEm ? hojeNoFuso(fuso, doPainel.plano.publicadoEm) : null, listaDeCompras: doPainel.listaDeCompras },
    lembretes: ls.length
      ? {
          ligados: ls.filter((l) => l.ligado && l.desligadoPeloPacienteEm === null).length,
          desligadosPeloPaciente: ls.filter((l) => l.desligadoPeloPacienteEm !== null).length,
          pausados: p.lembretesPausadosEm !== null,
        }
      : null,
    pesoOculto: p.pesoOcultoNoAppEm !== null,
    gorduraNoApp: Boolean(t?.gordura),
    iaNutri: t?.iaNutriAtivadaEm ? (doPainel.ia?.liberadaEm && !doPainel.ia.bloqueadaEm ? 'ligada' : 'desligada') : null,
    contagens: doApp?.contagens ?? null,
    receitasSugeridas: doPainel.receitas,
    visiveis: doApp?.visiveis ?? {},
  };
}
