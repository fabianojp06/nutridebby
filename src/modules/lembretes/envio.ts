/**
 * Plano 17 (§5.2, §5.5, Tarefa 4): o job `lembretes-rotina` — a cada minuto, o slot devido de cada paciente sai por push,
 * no máximo uma vez. Só no worker (usa o envio aos dispositivos do push, R1).
 *
 * Por tenant `ativa`, no contexto `worker` (CLAUDE.md regra 1): uma transação de leitura em lote (pacientes que podem
 * receber, os lembretes deles sem o `texto`, as refeições do plano publicado, as marcas e o diário do dia), a escolha do
 * slot de cada paciente, uma transação curta que grava as marcas com upsert condicional (o que garante o "no máximo uma
 * vez", mesmo com duas execuções ao mesmo tempo ou o job expirado relançado pelo pg-boss com o antigo ainda rodando) e,
 * depois do commit, o envio. Nenhum dado de saúde, nome de suplemento, texto livre ou refeição digitada vai ao payload
 * ou ao log (regra 3): o worker nem lê `lembretes_rotina.texto` (minimização, LGPD art. 6º, III).
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { diaryEntries, lembretesRotina, lembretesRotinaEnvios, mealPlans, meals, patients, pushSubscriptions } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger, nomeDoErro } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { diaDaSemana, inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { enviarAosDispositivos, inscricoesDosPacientes, type InscricaoComId } from '@/modules/notificacoes/push-dispositivos';
import type { ProvedorPush } from '@/modules/notificacoes/push';
import { buscarTenant, getTenantStatus, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { refeicaoDoDiario, rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { telaDoPortal } from '@/modules/portal/link-portal';
import { validarConfig, type ConfigRefeicoes, type LembreteNovo } from './config';
import { TEXTOS_PUSH, TITULO_PUSH } from './constantes';
import { planoDoDia, type LembreteParaSlots, type RefeicaoDoPlano, type Slot } from './slots';

export type DepsLembretes = { db: Db; agora: () => Date; appUrl: string; push: ProvedorPush | null };

/** Envios em andamento ao mesmo tempo (fila de trabalho: quem termina pega o próximo). */
export const CONCORRENCIA_ENVIO = 10;
/** §5.2: slot com mais de 10 min de atraso é pulado (worker parado e de volta não manda o atrasado). */
const TOLERANCIA_MS = 10 * 60_000;
/** §5.2: depois de 30 min, o aviso perde o sentido — o serviço de push descarta o que não entregou. */
const TTL_PUSH_S = 1800;

type Resumo = { enviados: number; pulados: number; falhas: number };
type Lembrete = LembreteParaSlots & { patientId: string };
type Escolhido = { patientId: string; slot: Slot; antecedenciaMin: ConfigRefeicoes['antecedenciaMin'] };

/** Corpo e tela do push de um slot: só textos fixos; a refeição só com o rótulo da lista fechada (§4.4, NORMAS-DECISAO-1). */
function payloadDoSlot(e: Escolhido, tenantId: string, appUrl: string): string {
  let corpo: string;
  let tela: string;
  switch (e.slot.tipo) {
    case 'refeicao': {
      const rotulo = e.slot.refeicao === null ? 'Outro' : refeicaoDoDiario(e.slot.refeicao);
      const antes = e.antecedenciaMin > 0;
      if (rotulo === 'Outro') corpo = antes ? TEXTOS_PUSH.refeicaoAntesGenerica : TEXTOS_PUSH.refeicaoNaHoraGenerica;
      else corpo = antes ? TEXTOS_PUSH.refeicaoAntes(rotulo) : TEXTOS_PUSH.refeicaoNaHora(rotulo);
      tela = '/p/plano';
      break;
    }
    case 'diario':
      corpo = TEXTOS_PUSH.diario;
      tela = '/p/diario';
      break;
    case 'suplemento':
      corpo = TEXTOS_PUSH.suplemento;
      tela = '/p/perfil/lembretes';
      break;
    case 'livre':
      corpo = TEXTOS_PUSH.livre;
      tela = '/p/perfil/lembretes';
      break;
    case 'agua':
      corpo = TEXTOS_PUSH.agua;
      tela = '/p/inicio';
      break;
  }
  // a tela leva o consultório (`?v=`): com 2+ vínculos, o toque abre este, não o do cookie
  return JSON.stringify({ titulo: TITULO_PUSH, corpo, url: urlDoApp(appUrl, telaDoPortal(tela, tenantId)) });
}

type Leitura = {
  lembretes: Lembrete[];
  invalidos: number;
  refeicoes: Map<string, RefeicaoDoPlano[]>;
  marcas: Map<string, Date>;
  noDiario: Map<string, string[]>;
};

/**
 * Refeições do plano publicado mais recente de cada paciente, na ordem do plano (o horário como o banco devolve), com os
 * dias de cada uma (Plano 19, RN-247 f: `planoDoDia` pula a refeição que não é do dia).
 */
async function refeicoesDosPlanos(tx: Tx, patientIds: string[]): Promise<Map<string, RefeicaoDoPlano[]>> {
  const porPaciente = new Map<string, RefeicaoDoPlano[]>();
  if (!patientIds.length) return porPaciente;
  const planos = await tx
    .select({ id: mealPlans.id, patientId: mealPlans.patientId, versao: mealPlans.versao })
    .from(mealPlans)
    .where(and(inArray(mealPlans.patientId, patientIds), eq(mealPlans.status, 'publicado')));
  const vigente = new Map<string, { id: string; versao: number }>();
  for (const p of planos) {
    const atual = vigente.get(p.patientId!);
    if (!atual || p.versao > atual.versao) vigente.set(p.patientId!, p);
  }
  if (!vigente.size) return porPaciente;
  const doPlano = new Map([...vigente].map(([patientId, p]) => [p.id, patientId]));
  const linhas = await tx
    .select({ planId: meals.planId, nome: meals.nome, horario: meals.horario, dias: meals.diasSemana })
    .from(meals)
    .where(inArray(meals.planId, [...doPlano.keys()]))
    .orderBy(asc(meals.ordem));
  for (const patientId of vigente.keys()) porPaciente.set(patientId, []);
  for (const r of linhas) porPaciente.get(doPlano.get(r.planId)!)!.push({ nome: r.nome, horario: r.horario, dias: r.dias });
  return porPaciente;
}

/**
 * §5.1/§5.2: refeição do plano já registrada hoje (no dia local do tenant, como `diaDe` do diário) — pela refeição do plano
 * escolhida no registro (`refeicao_slot`, gravado com ou sem resposta), pela cópia da resposta (`refeicao_do_plano`) ou,
 * quando o nome está na lista fechada, pela refeição do registro. Só as refeições de hoje (Plano 19: o rótulo de uma
 * refeição de outro dia, com o mesmo nome, não cala a de hoje). Conferência de estado do worker: nada volta a uma
 * usuária, então sem `auditRead`; só `patient_id`, `refeicao`, `refeicao_do_plano` e `refeicao_slot` (nunca `texto`).
 */
async function registradasNoDiario(tx: Tx, refeicoes: Map<string, RefeicaoDoPlano[]>, patientIds: string[], hoje: string, fuso: string): Promise<Map<string, string[]>> {
  const porPaciente = new Map<string, string[]>();
  const alvo = patientIds.filter((id) => refeicoes.get(id)?.length);
  if (!alvo.length) return porPaciente;
  const registros = await tx
    .select({ patientId: diaryEntries.patientId, refeicao: diaryEntries.refeicao, refeicaoDoPlano: diaryEntries.refeicaoDoPlano, refeicaoSlot: diaryEntries.refeicaoSlot })
    .from(diaryEntries)
    .where(and(inArray(diaryEntries.patientId, alvo), gte(diaryEntries.dataHora, inicioDoDia(hoje, fuso)), lt(diaryEntries.dataHora, inicioDoDia(somarDias(hoje, 1), fuso))));
  const dia = diaDaSemana(hoje);
  for (const patientId of alvo) {
    const doPaciente = registros.filter((r) => r.patientId === patientId);
    if (!doPaciente.length) continue;
    const registradas = refeicoes.get(patientId)!.filter((r) => {
      if (!r.horario || !r.dias.includes(dia)) return false; // sem horário ou de outro dia não há slot
      const rotulo = rotuloDaRefeicao(r.nome, r.horario.slice(0, 5));
      const daLista = refeicaoDoDiario(r.nome);
      return doPaciente.some((d) => d.refeicaoSlot === rotulo || d.refeicaoDoPlano === rotulo || (daLista !== 'Outro' && d.refeicao === daLista));
    });
    porPaciente.set(patientId, registradas.map((r) => r.nome));
  }
  return porPaciente;
}

/** Passo 1: tudo numa transação, sem consulta por paciente. */
async function ler(tx: Tx, hoje: string, fuso: string): Promise<Leitura> {
  const linhas = await tx
    .select({ id: lembretesRotina.id, patientId: lembretesRotina.patientId, tipo: lembretesRotina.tipo, config: lembretesRotina.config, updatedAt: lembretesRotina.updatedAt })
    .from(lembretesRotina)
    .innerJoin(patients, and(eq(patients.tenantId, lembretesRotina.tenantId), eq(patients.id, lembretesRotina.patientId)))
    .where(
      and(
        eq(lembretesRotina.ligado, true),
        isNull(lembretesRotina.desligadoPeloPacienteEm),
        eq(patients.status, 'ativo'),
        isNull(patients.anonimizadoEm),
        isNotNull(patients.userId),
        isNull(patients.lembretesPausadosEm),
        sql`exists (select 1 from ${pushSubscriptions} s where s.tenant_id = ${patients.tenantId} and s.patient_id = ${patients.id})`,
      ),
    )
    .orderBy(asc(lembretesRotina.patientId), asc(lembretesRotina.id));
  const lembretes: Lembrete[] = [];
  let invalidos = 0;
  for (const l of linhas) {
    const v = validarConfig(l.tipo as LembreteNovo['tipo'], l.config);
    if (!v.ok) {
      invalidos++;
      continue;
    }
    // o envio não mexe no `updated_at` do lembrete (a marca fica em lembretes_rotina_envios): slot anterior à edição não sai
    lembretes.push({ id: l.id, patientId: l.patientId, ativo: true, validoDesde: l.updatedAt, ...v.valor } as Lembrete);
  }
  const comRefeicoes = [...new Set(lembretes.filter((l) => l.tipo === 'refeicoes').map((l) => l.patientId))];
  const refeicoes = await refeicoesDosPlanos(tx, comRefeicoes);
  const comDiario = [...new Set(lembretes.filter((l) => l.tipo === 'refeicoes' && l.config.diarioDepoisMin !== null).map((l) => l.patientId))];
  const noDiario = await registradasNoDiario(tx, refeicoes, comDiario, hoje, fuso);
  const ids = lembretes.map((l) => l.id);
  const marcas = new Map<string, Date>();
  if (ids.length) {
    const ms = await tx.select({ lembreteId: lembretesRotinaEnvios.lembreteId, ultimoSlotEm: lembretesRotinaEnvios.ultimoSlotEm }).from(lembretesRotinaEnvios).where(inArray(lembretesRotinaEnvios.lembreteId, ids));
    for (const m of ms) marcas.set(m.lembreteId, m.ultimoSlotEm);
  }
  return { lembretes, invalidos, refeicoes, marcas, noDiario };
}

/**
 * Passo 3: por paciente, o slot mais antigo ainda não enviado com `agora − 10 min < em ≤ agora` e `em` depois da marca de
 * todos os seus lembretes. Um push por paciente por execução; o seguinte sai na execução do minuto seguinte, se ainda
 * estiver na janela.
 */
function escolher(l: Leitura, hoje: string, fuso: string, agora: Date): Escolhido[] {
  const porPaciente = new Map<string, Lembrete[]>();
  for (const x of l.lembretes) porPaciente.set(x.patientId, [...(porPaciente.get(x.patientId) ?? []), x]);
  const desde = agora.getTime() - TOLERANCIA_MS;
  const escolhidos: Escolhido[] = [];
  for (const [patientId, lembretes] of porPaciente) {
    const { slots } = planoDoDia({ lembretes, refeicoes: l.refeicoes.get(patientId) ?? [], data: hoje, fuso, refeicoesNoDiario: l.noDiario.get(patientId) ?? [] });
    const slot = slots.find((s) => {
      const t = s.em.getTime();
      return t > desde && t <= agora.getTime() && s.lembreteIds.every((id) => (l.marcas.get(id)?.getTime() ?? -Infinity) < t);
    });
    if (!slot) continue;
    const r = lembretes.find((x) => x.tipo === 'refeicoes');
    escolhidos.push({ patientId, slot, antecedenciaMin: r?.tipo === 'refeicoes' ? r.config.antecedenciaMin : 0 });
  }
  return escolhidos;
}

/**
 * Passo 4: sob a trava do tenant e com o status relido (RN-15), grava a marca de cada slot com upsert condicional — só
 * avança, nunca repete. Sai o slot cujos lembretes voltaram todos no RETURNING (a escrita condicional é o que garante o
 * no máximo uma vez; a trava só serializa). Na mesma transação, as inscrições de quem vai receber.
 */
async function marcar(tx: Tx, tenantId: string, escolhidos: Escolhido[], agora: Date): Promise<{ saem: Escolhido[]; inscricoes: Map<string, InscricaoComId[]> }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lembretes-rotina'), hashtext(${tenantId}))`);
  if ((await getTenantStatus(tx, tenantId, { aguardarSuspensao: true })) !== 'ativa') return { saem: [], inscricoes: new Map() };
  const saem: Escolhido[] = [];
  for (const e of escolhidos) {
    const ids = [...e.slot.lembreteIds].sort();
    const valores = sql.join(
      ids.map((id) => sql`(${id}::uuid, ${tenantId}::uuid, ${e.patientId}::uuid, ${e.slot.em.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz)`),
      sql`, `,
    );
    const { rows } = await tx.execute<{ lembrete_id: string }>(sql`
      INSERT INTO lembretes_rotina_envios (lembrete_id, tenant_id, patient_id, ultimo_slot_em, updated_at)
      VALUES ${valores}
      ON CONFLICT (lembrete_id) DO UPDATE SET ultimo_slot_em = excluded.ultimo_slot_em, updated_at = excluded.updated_at
      WHERE lembretes_rotina_envios.ultimo_slot_em < excluded.ultimo_slot_em
      RETURNING lembrete_id`);
    // um lembrete cuja marca já cobria este minuto (o mesmo slot saiu por outra execução) segura o slot inteiro
    if (rows.length === ids.length) saem.push(e);
  }
  const inscricoes = await inscricoesDosPacientes(tx, saem.map((e) => e.patientId));
  return { saem, inscricoes };
}

/** Passo 5: no máximo CONCORRENCIA_ENVIO em andamento; quem termina pega o próximo (não em lotes fechados). */
async function enviarTodos(itens: (() => Promise<void>)[]): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) await itens[proximo++]();
  };
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA_ENVIO, itens.length) }, trabalhador));
}

async function processarTenant(tenantId: string, deps: DepsLembretes, push: ProvedorPush, agora: Date): Promise<Resumo> {
  const resumo: Resumo = { enviados: 0, pulados: 0, falhas: 0 };
  const tenant = await buscarTenant(deps.db, tenantId);
  if (!tenant || tenant.status !== 'ativa') return resumo;
  const ctx: TenantContext = { tenantId, role: 'worker' };
  const hoje = partesNoFuso(agora, tenant.fuso).data;
  const leitura = await withTenant(ctx, (tx) => ler(tx, hoje, tenant.fuso), deps.db);
  if (leitura.invalidos) {
    resumo.pulados += leitura.invalidos;
    logger.warn({ tenantId, invalidos: leitura.invalidos }, 'lembretes de rotina com configuração inválida');
  }
  const escolhidos = escolher(leitura, hoje, tenant.fuso, agora);
  if (!escolhidos.length) return resumo; // sem slot devido, a transação da marca nem abre
  const { saem, inscricoes } = await withTenant(ctx, (tx) => marcar(tx, tenantId, escolhidos, agora), deps.db);
  await enviarTodos(
    saem.map((e) => async () => {
      const lista = inscricoes.get(e.patientId) ?? [];
      if (!lista.length) {
        resumo.pulados++; // o aparelho saiu entre a leitura e a marca
        return;
      }
      try {
        const r = await enviarAosDispositivos({ db: deps.db, tenantId, inscricoes: lista, push, payload: payloadDoSlot(e, tenantId, deps.appUrl), ttlS: TTL_PUSH_S, logCtx: { job: 'lembretes-rotina' } });
        if (r.resultado === 'enviada') resumo.enviados++;
        else if (r.resultado === 'sem_inscricao') resumo.pulados++;
        else resumo.falhas++; // no máximo uma vez: a marca já foi gravada, não há nova tentativa
      } catch (err) {
        resumo.falhas++;
        logger.warn({ tenantId, err: nomeDoErro(err) }, 'falha no envio do lembrete de rotina');
      }
    }),
  );
  logger.info({ tenantId, ...resumo }, 'lembretes de rotina processados');
  return resumo;
}

/**
 * Cron de 1 min (`lembretes-rotina`): todos os tenants, ou só um (`tenantId`, testes). Sem VAPID (`push` nulo), nada
 * sai e nenhuma marca é gravada. `enviados`: algum aparelho recebeu; `pulados`: lembrete com configuração inválida ou
 * paciente sem aparelho válido na hora do envio; `falhas`: nenhum aparelho recebeu (sem nova tentativa) ou o tenant falhou.
 */
export async function processarLembretes(deps: DepsLembretes, opts: { tenantId?: string } = {}): Promise<Resumo> {
  const total: Resumo = { enviados: 0, pulados: 0, falhas: 0 };
  const push = deps.push;
  if (!push) return total;
  const agora = deps.agora();
  const alvos = opts.tenantId ? [opts.tenantId] : (await listarTenantsParaVarredura(deps.db)).map((t) => t.id).sort();
  for (const tenantId of alvos) {
    try {
      const r = await processarTenant(tenantId, deps, push, agora);
      total.enviados += r.enviados;
      total.pulados += r.pulados;
      total.falhas += r.falhas;
    } catch (err) {
      // um tenant com problema não para os outros; a marca só existe se o commit dela aconteceu
      total.falhas++;
      logger.error({ tenantId, err: nomeDoErro(err) }, 'falha ao processar os lembretes de rotina do tenant');
    }
  }
  return total;
}
