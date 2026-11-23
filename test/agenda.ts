import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Db } from '@/db/client';
import { appointments, locaisAtendimento, type TipoDeLocal } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { TenantAgenda } from '@/modules/agenda/consultas';
import { paraInstante } from '@/modules/agenda/fuso';
import { garantirLocaisIniciais } from '@/modules/agenda/locais';
import type { TenantDeTeste } from './pacientes';

export const SP = 'America/Sao_Paulo';
export const em = (data: string, hora: string, fuso = SP) => paraInstante(data, hora, fuso)!;

/** Dados do tenant que a agenda lê (os mesmos padrões da tabela `tenants`). */
export const tenantAgenda = (T: TenantDeTeste, extra: Partial<TenantAgenda> = {}): TenantAgenda => ({
  id: T.tenantId,
  fuso: SP,
  nomeExibicao: T.tenant.nomeExibicao,
  linkOnlinePadrao: null,
  enderecoConsultorio: 'Rua das Flores, 10',
  antecedenciaMinH: 12,
  cancelamentoMinH: 24,
  status: 'ativa',
  agendamentoPublicoAtivo: true,
  ...extra,
});

/**
 * Plano 23 (AG-D45): o "Consultório" principal (presencial, com agendamento pelo paciente), como `garantirLocaisIniciais` o
 * cria na sessão `nutri`; devolve o id do principal ativo.
 */
export async function localPrincipal(db: Db, ctx: TenantContext): Promise<string> {
  return withTenant(
    ctx,
    async (tx) => {
      await garantirLocaisIniciais(tx, { id: ctx.tenantId, enderecoConsultorio: null });
      const [l] = await tx.select({ id: locaisAtendimento.id }).from(locaisAtendimento).where(and(eq(locaisAtendimento.principal, true), isNull(locaisAtendimento.arquivadoEm)));
      return l.id;
    },
    db,
  );
}

let locaisCriados = 0;
/** Plano 23: um local gravado direto. O online vem com sala e "Aceita agendamento pelo paciente"; o presencial, com agendamento. */
export async function novoLocal(
  db: Db,
  ctx: TenantContext,
  o: { nome?: string; tipo?: TipoDeLocal; linkSala?: string | null; agendamentoOnline?: boolean; principal?: boolean; arquivado?: boolean } = {},
): Promise<string> {
  const tipo = o.tipo ?? 'presencial';
  const linkSala = tipo === 'online' ? (o.linkSala === undefined ? 'https://sala.exemplo.test/fixa' : o.linkSala) : null;
  const agendamentoOnline = !o.arquivado && (o.agendamentoOnline ?? (tipo === 'presencial' || !!linkSala));
  const [l] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(locaisAtendimento)
        .values({ tenantId: ctx.tenantId, nome: o.nome ?? `Local ${++locaisCriados}`, tipo, linkSala, agendamentoOnline, principal: o.principal ?? false, arquivadoEm: o.arquivado ? new Date() : null })
        .returning({ id: locaisAtendimento.id }),
    db,
  );
  return l.id;
}

/**
 * Atende todos os dias, 08:00–20:00, consultas de 60 min, presencial ou online. Plano 23: as regras ficam sem local (como
 * a imagem anterior ao PR 2 as grava) e valem pela RN-410a; o consultório ganha antes o "Consultório" principal. Horário
 * online só com um local online ativo (`novoLocal(…, { tipo: 'online' })`).
 */
export async function semanaToda(db: Db, ctx: TenantContext, extra: { duracaoMin?: number; modalidade?: string } = {}) {
  await localPrincipal(db, ctx);
  await withTenant(ctx, (tx) =>
    tx.execute(sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade)
      select ${ctx.tenantId}, d, '08:00', '20:00', ${extra.duracaoMin ?? 60}, ${extra.modalidade ?? 'ambas'} from generate_series(0, 6) d`), db);
}

/** Consulta gravada direto (sem regra, sem lembrete): para preparar cenários. */
export async function consultaDireta(db: Db, ctx: TenantContext, patientId: string, inicio: Date, minutos = 60, extra: Partial<typeof appointments.$inferInsert> = {}): Promise<string> {
  const [c] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(appointments)
        .values({ tenantId: ctx.tenantId, patientId, inicio, fim: new Date(inicio.getTime() + minutos * 60_000), modalidade: 'presencial', origem: 'nutri', ...extra })
        .returning({ id: appointments.id }),
    db,
  );
  return c.id;
}

/**
 * Corrida perdida no banco, sem depender do relógio: outra transação grava a consulta e segura o `commit`;
 * `acao` checa (não vê a linha ainda não confirmada), grava e fica presa no EXCLUDE; só então a outra confirma.
 * Devolve o erro de `acao` (ou null). `pools.owner` só lê `pg_stat_activity` para saber que a gravação ficou presa.
 */
export async function perdeCorridaNoBanco(pools: { app: Pool; owner: Pool }, T: TenantDeTeste, patientId: string, inicio: Date, acao: () => Promise<unknown>): Promise<unknown> {
  const outra = await pools.app.connect();
  let confirmada = false;
  try {
    await outra.query('begin');
    await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
    await outra.query(`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values ($1, $2, $3, $4, 'presencial', 'nutri')`, [
      T.tenantId, patientId, inicio, new Date(inicio.getTime() + 3_600_000),
    ]);
    const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
    const resultado = acao().then(
      () => null,
      (e: unknown) => e,
    );
    for (let i = 0; ; i++) {
      const presa = await pools.owner.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid]);
      if (presa.rowCount) break;
      if (i > 200) throw new Error('a gravação não ficou presa no EXCLUDE');
      await new Promise((r) => setTimeout(r, 10));
    }
    await outra.query('commit');
    confirmada = true;
    return await resultado;
  } finally {
    if (!confirmada) await outra.query('rollback').catch(() => undefined); // não devolve ao pool com transação aberta
    outra.release();
  }
}

/** Espera até alguma conexão ficar presa numa trava de `pid` (true) ou `feito` ser resolvida antes (false). */
async function esperarPresaPor(owner: Pool, pid: number, feito: { pronto: boolean }, oQue: string): Promise<boolean> {
  for (let i = 0; ; i++) {
    if ((await owner.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) return true;
    if (feito.pronto) return false;
    if (i > 500) throw new Error(`${oQue} não ficou presa no EXCLUDE`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Revisão final (Important 1): duas gravações de faixas que se sobrepõem ao mesmo tempo podem dar 40P01 em vez de 23P01 —
 * o Postgres põe a tupla no índice GiST e só depois procura conflitos (execIndexing.c), então cada uma pode esperar a
 * outra. Sem depender do relógio: a `outra` grava `primeira` (cruza a faixa de `acao`) e segura o `commit`; `acao` grava
 * e fica presa esperando a outra; a outra grava `segunda`, que só cruza a faixa de `acao` → espera `acao`: ciclo. Quem o
 * detector desfaz é quem roda a checagem primeiro, e no PG16 cada espera a roda uma vez só, depois do próprio
 * deadlock_timeout (sem ciclo naquele instante, não confere de novo). A `outra` leva 10 s (local à transação; GRANT só no
 * global-setup) e `acao` 1 s: a vítima é `acao` desde que a `outra` comece a esperar (feche o ciclo) dentro de 1 s
 * contado de quando `acao` ficou presa. Os 10 s tiram a corrida entre as duas checagens, que era o flake do P15-04; um
 * atraso de mais de 1 s no fechamento do ciclo ainda faria a checagem de `acao` passar em branco e a vítima ser a `outra`
 * (o teste falha, não passa errado). A outra só confirma depois que a nova tentativa de `acao` fica presa de novo (ou que
 * `acao` termina, sem nova tentativa). Devolve o erro de `acao` (ou null).
 */
export async function perdeDeadlockNoBanco(
  pools: { app: Pool; owner: Pool },
  T: TenantDeTeste,
  patientId: string,
  faixas: [{ inicio: Date; minutos: number }, { inicio: Date; minutos: number }],
  acao: () => Promise<unknown>,
): Promise<unknown> {
  const outra = await pools.app.connect();
  let encerrada = false;
  const gravar = (f: { inicio: Date; minutos: number }) =>
    outra.query(`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values ($1, $2, $3, $4, 'presencial', 'nutri')`, [
      T.tenantId, patientId, f.inicio, new Date(f.inicio.getTime() + f.minutos * 60_000),
    ]);
  try {
    await outra.query('begin');
    await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
    await outra.query(`select set_config('deadlock_timeout', '10s', true)`); // a vítima do ciclo é `acao` (P15-04)
    await gravar(faixas[0]);
    const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
    const feito = { pronto: false };
    const resultado = acao().then(
      () => null,
      (e: unknown) => e,
    ).finally(() => {
      feito.pronto = true;
    });
    if (!(await esperarPresaPor(pools.owner, pid, feito, 'a gravação'))) throw new Error('a gravação terminou sem esperar a outra transação');
    // fecha o ciclo: só termina quando o Postgres desfaz `acao` (40P01); se desfizer esta, o teste não exercitou nada
    await gravar(faixas[1]).catch((e: unknown) => {
      throw new Error(`o deadlock desfez a outra transação, não a gravação (${(e as { code?: string }).code ?? 'sem código'})`);
    });
    await esperarPresaPor(pools.owner, pid, feito, 'a nova tentativa');
    await outra.query('commit');
    encerrada = true;
    return await resultado;
  } finally {
    if (!encerrada) await outra.query('rollback').catch(() => undefined);
    outra.release();
  }
}
