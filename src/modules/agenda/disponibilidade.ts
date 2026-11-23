import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { availabilityBlocks, availabilityRules } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { DURACAO_MAX, DURACAO_MIN, MAX_REGRAS, MSG_AGENDA } from './constantes';
import { dataDaAgendaValida, inicioDoDia, paraInstante, somarDias } from './fuso';
import { HORA_HHMM, minutosDe, textoAparado, type Intervalo, type ModalidadeRegra, type Regra } from './horarios';

export type RegraSalva = Regra & { id: string };
export type BloqueioSalvo = Intervalo & { id: string; motivo: string };

export class DisponibilidadeError extends Error {
  override name = 'DisponibilidadeError';
  constructor(readonly erros: Record<string, string>) {
    super('Disponibilidade inválida');
  }
}

type Deps = { db?: Db; now?: Date };
const MODALIDADES_REGRA: readonly string[] = ['presencial', 'online', 'ambas'];
const BLOQUEIO_MAX_MS = 366 * 86_400_000;

/** Regras do tenant, na transação já com o contexto: tela, aviso "fora do horário" e horários livres. */
export async function lerRegras(tx: Tx): Promise<RegraSalva[]> {
  const rs = await tx.select().from(availabilityRules).orderBy(asc(availabilityRules.diaSemana), asc(availabilityRules.inicio));
  return rs.map((r) => ({ id: r.id, diaSemana: r.diaSemana, inicio: r.inicio.slice(0, 5), fim: r.fim.slice(0, 5), duracaoMin: r.duracaoMin, modalidade: r.modalidade as ModalidadeRegra }));
}

/** Bloqueios que tocam [de, ate). */
export async function lerBloqueios(tx: Tx, de: Date, ate: Date): Promise<BloqueioSalvo[]> {
  const bs = await tx.select().from(availabilityBlocks).where(and(lt(availabilityBlocks.inicio, ate), gt(availabilityBlocks.fim, de))).orderBy(asc(availabilityBlocks.inicio));
  return bs.map((b) => ({ id: b.id, inicio: b.inicio, fim: b.fim, motivo: b.motivo }));
}

/**
 * AG-D47 na tela de horários do PR 1 (até a T3 refazê-la): o backfill da 0131 desdobra cada regra "ambas" em uma presencial
 * e uma online de mesmo dia, início, fim e duração. A tela mostra o par como UMA regra "ambas" (com o id da metade
 * presencial), o limite (MAX_REGRAS) conta o par como uma e `excluirRegra` apaga as duas metades. Fora do backfill esse par
 * não nasce: `criarRegra` recusa sobreposição entre modalidades. `gerarHorarios` já une os horários (horarios.ts).
 */
const chaveDoPar = (r: Regra) => `${r.diaSemana}|${r.inicio}|${r.fim}|${r.duracaoMin}`;
export function juntarPares(regras: RegraSalva[]): RegraSalva[] {
  const online = new Map<string, RegraSalva>();
  for (const r of regras) if (r.modalidade === 'online' && !online.has(chaveDoPar(r))) online.set(chaveDoPar(r), r);
  const metadeOnline = new Set<string>();
  const ambas = new Set<string>();
  for (const r of regras) {
    if (r.modalidade !== 'presencial') continue;
    const o = online.get(chaveDoPar(r));
    if (!o || metadeOnline.has(o.id)) continue;
    metadeOnline.add(o.id);
    ambas.add(r.id);
  }
  return regras.filter((r) => !metadeOnline.has(r.id)).map((r) => (ambas.has(r.id) ? { ...r, modalidade: 'ambas' as const } : r));
}

export function listarRegras(ctx: TenantContext, db: Db = getDb()): Promise<RegraSalva[]> {
  return withTenant(ctx, async (tx) => juntarPares(await lerRegras(tx)), db);
}

export function listarBloqueios(ctx: TenantContext, de: Date, ate: Date, db: Db = getDb()): Promise<BloqueioSalvo[]> {
  return withTenant(ctx, (tx) => lerBloqueios(tx, de, ate), db);
}

/** US-030 "Regra inválida" e demais limites; dia e números chegam como texto do formulário. */
export function validarRegra(input: Record<string, unknown>): Regra {
  const erros: Record<string, string> = {};
  const dia = String(input.diaSemana ?? '');
  if (!/^[0-6]$/.test(dia)) erros.diaSemana = MSG_AGENDA.diaSemana;
  const inicio = textoAparado(input.inicio);
  const fim = textoAparado(input.fim);
  if (!HORA_HHMM.test(inicio)) erros.inicio = MSG_AGENDA.horaInvalida;
  if (!HORA_HHMM.test(fim)) erros.fim = MSG_AGENDA.horaInvalida;
  else if (HORA_HHMM.test(inicio) && minutosDe(fim) <= minutosDe(inicio)) erros.fim = MSG_AGENDA.fimAntesDoInicio;
  const duracao = Number(textoAparado(String(input.duracaoMin ?? '')));
  if (!Number.isInteger(duracao) || duracao < DURACAO_MIN || duracao > DURACAO_MAX) erros.duracaoMin = MSG_AGENDA.duracao;
  else if (!erros.inicio && !erros.fim && minutosDe(fim) - minutosDe(inicio) < duracao) erros.duracaoMin = MSG_AGENDA.naoCabe;
  const modalidade = String(input.modalidade ?? '');
  if (!MODALIDADES_REGRA.includes(modalidade)) erros.modalidade = MSG_AGENDA.modalidade;
  if (Object.keys(erros).length) throw new DisponibilidadeError(erros);
  return { diaSemana: Number(dia), inicio, fim, duracaoMin: duracao, modalidade: modalidade as ModalidadeRegra };
}

export async function criarRegra(ctx: TenantContext, input: Record<string, unknown>, deps: Deps = {}): Promise<string> {
  const r = validarRegra(input);
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      // Uma gravação de regra por vez no tenant: a checagem de sobreposição não pode correr com outra
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-regras'), hashtext(${ctx.tenantId}))`);
      const atuais = await lerRegras(tx);
      if (juntarPares(atuais).length >= MAX_REGRAS) throw new DisponibilidadeError({ geral: MSG_AGENDA.limiteRegras });
      const choca = atuais.some((x) => x.diaSemana === r.diaSemana && minutosDe(x.inicio) < minutosDe(r.fim) && minutosDe(r.inicio) < minutosDe(x.fim));
      if (choca) throw new DisponibilidadeError({ inicio: MSG_AGENDA.sobreposicao });
      const [n] = await tx.insert(availabilityRules).values({ tenantId: ctx.tenantId, ...r, createdAt: now, updatedAt: now }).returning({ id: availabilityRules.id });
      return n.id;
    },
    deps.db ?? getDb(),
  );
}

/** Exclui a regra e, se ela for metade de um par desdobrado pelo backfill (AG-D47, `juntarPares`), a outra metade junto. */
export async function excluirRegra(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(
    ctx,
    async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-regras'), hashtext(${ctx.tenantId}))`);
      const [r] = await tx.delete(availabilityRules).where(eq(availabilityRules.id, id)).returning();
      if (!r || (r.modalidade !== 'presencial' && r.modalidade !== 'online')) return;
      await tx
        .delete(availabilityRules)
        .where(
          and(
            eq(availabilityRules.diaSemana, r.diaSemana),
            eq(availabilityRules.inicio, r.inicio),
            eq(availabilityRules.fim, r.fim),
            eq(availabilityRules.duracaoMin, r.duracaoMin),
            eq(availabilityRules.modalidade, r.modalidade === 'presencial' ? 'online' : 'presencial'),
          ),
        );
    },
    db,
  );
}

/**
 * Sem hora: dias inteiros no fuso do tenant (00:00 do primeiro dia até 00:00 do dia seguinte ao último).
 * Com hora: o intervalo exato. Hora que não existe no dia (horário de verão) é recusada (D8).
 */
export async function criarBloqueio(ctx: TenantContext, tenant: { fuso: string }, input: Record<string, unknown>, deps: Deps = {}): Promise<string> {
  const erros: Record<string, string> = {};
  const dataInicio = textoAparado(input.dataInicio);
  const dataFimInformada = textoAparado(input.dataFim);
  const dataFim = dataFimInformada || dataInicio;
  const horaInicio = textoAparado(input.horaInicio);
  const horaFim = textoAparado(input.horaFim);
  const motivo = normalizarTexto(input.motivo);
  const now = deps.now ?? new Date();
  const hoje = hojeNoFuso(tenant.fuso, now);
  if (!dataDaAgendaValida(dataInicio, hoje)) erros.dataInicio = MSG_AGENDA.dataInvalida;
  if (dataFimInformada && !dataDaAgendaValida(dataFimInformada, hoje)) erros.dataFim = MSG_AGENDA.dataInvalida;
  if (horaInicio && !HORA_HHMM.test(horaInicio)) erros.horaInicio = MSG_AGENDA.horaInvalida;
  if (horaFim && !HORA_HHMM.test(horaFim)) erros.horaFim = MSG_AGENDA.horaInvalida;
  if (motivo.length > 120) erros.motivo = MSG_AGENDA.motivoLongo;
  let inicio: Date | null = null;
  let fim: Date | null = null;
  if (!erros.dataInicio && !erros.dataFim && !erros.horaInicio && !erros.horaFim) {
    inicio = horaInicio ? paraInstante(dataInicio, horaInicio, tenant.fuso) : inicioDoDia(dataInicio, tenant.fuso);
    fim = horaFim ? paraInstante(dataFim, horaFim, tenant.fuso) : inicioDoDia(somarDias(dataFim, 1), tenant.fuso);
    if (!inicio) erros.horaInicio = MSG_AGENDA.horaInexistente;
    if (!fim) erros.horaFim = MSG_AGENDA.horaInexistente;
    // revisão final: data final antes da inicial é erro da data; com as datas em ordem (mesmo dia), é a hora de fim
    if (inicio && fim && fim.getTime() <= inicio.getTime()) {
      if (dataFim < dataInicio) erros.dataFim = MSG_AGENDA.dataFinalAntes;
      else erros.horaFim = MSG_AGENDA.fimAntesDoInicio;
    } else if (inicio && fim && fim.getTime() - inicio.getTime() > BLOQUEIO_MAX_MS) erros.dataFim = MSG_AGENDA.bloqueioLongo;
  }
  if (Object.keys(erros).length) throw new DisponibilidadeError(erros);
  return withTenant(
    ctx,
    async (tx) => {
      const [b] = await tx.insert(availabilityBlocks).values({ tenantId: ctx.tenantId, inicio: inicio!, fim: fim!, motivo, createdAt: now }).returning({ id: availabilityBlocks.id });
      return b.id;
    },
    deps.db ?? getDb(),
  );
}

export async function excluirBloqueio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(ctx, (tx) => tx.delete(availabilityBlocks).where(eq(availabilityBlocks.id, id)), db);
}
