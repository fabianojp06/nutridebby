import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { ANIVERSARIO_UM_POR_ANO, aniversarioAutorizacoes, FORMAS_ANIVERSARIO, notifications, patientCadastro, patients, tenants, type FormaAniversario } from '@/db/schema';
import { sessaoDePacienteComConta, withTenant, type TenantContext } from '@/db/tenant';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { lerLinkDeSaida } from './aniversario-link';
import { diaDoAniversario } from './calendario';
import { MSG_ANIVERSARIO, nomeDaNutricionista, type SituacaoAniversario } from './constantes';
import type { TenantAgenda } from './consultas';
import { paraInstante, partesNoFuso } from './fuso';
import { chaveDoLimite, consumirLimite } from './limite-ip';

export type { SituacaoAniversario };

/**
 * Plano 23 (US-412 a US-414, RN-431 a RN-435, AG-D31 a AG-D35): aniversariantes do mês, a mensagem de aniversário por
 * e-mail (uma por paciente por ano, às 9h do dia no fuso), a autorização própria (tabela de eventos só de inclusão) pelos
 * três canais — a nutricionista com a forma, o paciente no app e a retirada pelo link do e-mail — e o estado do link.
 *
 * - Leitura da agenda: a lista não chama `auditRead` (RN-414, AG-D30; US-412 "Sem trilha de leitura").
 * - Trava (RN-433): a autorização e a retirada travam o paciente (`FOR NO KEY UPDATE`) antes do INSERT, nos três canais,
 *   para o "último evento" ter ordem. O envio não trava (só a `KEY SHARE` da FK do INSERT): quem garante é a reconferência
 *   da RN-431 no envio (`motivoParaIgnorar`, `notificacoes/enviar.ts`).
 * - `semConta` (N7; este arquivo está em SEM_CONTA_PERMITIDOS) só na retirada pelo link e no estado dele.
 * - Nome da nutricionista: `nome_profissional`, ou o de exibição (`nomeDaNutricionista`); nunca da tabela `user`.
 * - Grafo de imports: nunca `notificacoes/enviar.ts`, `push.ts` nem `mensagens.ts` (teste em aniversarios.test.ts).
 * - Regra 3: nome, e-mail, token e texto nunca em log ou mensagem de erro; o token só como HMAC (`chaveDoLimite`).
 */

export type Aniversariante = {
  patientId: string;
  /** Nome de registro (C-408); a saudação do WhatsApp usa o primeiro nome social (AG-D35), em `whatsapp`. */
  nome: string;
  /** 'AAAA-MM-DD' no ano do mês da lista (29/02 → 28/02 no ano comum). */
  dia: string;
  faz: number;
  situacao: SituacaoAniversario;
  /** Instante (ISO) da autorização vigente que conta (registrada com 18 anos ou mais, CS-404); senão nulo. */
  autorizadoEm: string | null;
  telefone: boolean;
  /** O último evento é `autorizou` (mesmo a de antes dos 18, que não conta): "Retirar autorização". */
  podeRetirar: boolean;
  /** Ainda não fez 18 hoje: "Registrar autorização" desabilitado com "Menor de idade" (RN-431). */
  menorHoje: boolean;
  /**
   * "Abrir no WhatsApp" (RN-435): só com a autorização que conta e telefone. `nome`: o da saudação — o social, quando há
   * (AG-D35), senão o de registro; quem monta o link recorta o primeiro nome (`primeiroNome`, R11: um lugar só).
   */
  whatsapp: { telefone: string; nome: string } | null;
};

export class AniversarioError extends Error {
  override name = 'AniversarioError';
}

type Deps = { db?: Db; agora?: Date };
type Autorizacao = { evento: string; registradoEm: Date };
type PacienteDoAniversario = { status: string; anonimizadoEm: Date | null; dataNascimento: string | null };

/** Teto de mensagens num envio (a lista de um mês; o "Selecionar todos" de um consultório grande). */
const MAX_POR_ENVIO = 1000;
/** RN-434: tentativas de retirada por token por hora (o POST de um clique vem dos IPs do provedor de e-mail: nunca por IP). */
export const LIMITE_SAIDA_POR_HORA = 10;
const MES = /^20\d{2}-(0[1-9]|1[0-2])$/;
/**
 * RN-432 / §9.8: o alvo e o predicado do `ON CONFLICT` do envio — cópia literal da expressão e do `WHERE` do índice
 * `notifications_aniversario_unique` (ANIVERSARIO_UM_POR_ANO, 0130). Exportados só para o teste que os compara com o
 * `indexdef` do banco (as duas cópias não podem divergir: com outro alvo, o Postgres não acha o índice e recusa com 42P10).
 */
export const ALVO_UM_POR_ANO = "(tenant_id, patient_id, (date_part('year', timezone('UTC', agendada_para))))";
export const ONDE_UM_POR_ANO = "tipo = 'aniversario'";

/** RN-400: só a sessão da nutricionista lê a lista e envia; conferido antes de abrir a transação. */
const exigirNutri = (ctx: TenantContext) => {
  if (ctx.role !== 'nutri') throw new Error('agenda: só a sessão nutri');
};
const horaNoFuso = (agora: Date, fuso: string) => Math.floor(partesNoFuso(agora, fuso).minutos / 60);
/** O dia em que faz 18 ('AAAA-MM-DD'; 29/02 → 28/02 no ano comum, como o aniversário). */
const maioridade = (nascimento: string) => diaDoAniversario(nascimento, Number(nascimento.slice(0, 4)) + 18);
/** A autorização que conta (CS-404): o último evento é `autorizou`, registrado quando o titular já tinha 18 anos. */
export function autorizacaoQueConta(nascimento: string, a: Autorizacao | null, fuso: string): boolean {
  return a?.evento === 'autorizou' && hojeNoFuso(fuso, a.registradoEm) >= maioridade(nascimento);
}

/**
 * RN-431 (puro): a situação de um aniversariante em `dia`, com `hoje` e a hora no fuso. Menor de 18 no dia → `menor`;
 * dia antes de hoje → `ja_passou`; hoje a partir das 21h (horário silencioso) → `passou_do_horario`; sem a autorização que
 * conta → `sem_autorizacao`. "Já enviada este ano" sai da tabela de mensagens (quem chama confere). Titular fora de
 * `ativo`, anonimizado ou sem data de nascimento não entra na lista; se chegar aqui, não recebe (`sem_autorizacao`).
 */
export function elegivel(p: PacienteDoAniversario, autorizacao: Autorizacao | null, dia: string, hoje: string, agoraNoFuso: { hora: number; fuso: string }): SituacaoAniversario {
  if (p.status !== 'ativo' || p.anonimizadoEm || !p.dataNascimento) return 'sem_autorizacao';
  if (dia < maioridade(p.dataNascimento)) return 'menor';
  if (dia < hoje) return 'ja_passou';
  if (dia === hoje && agoraNoFuso.hora >= 21) return 'passou_do_horario';
  if (!autorizacaoQueConta(p.dataNascimento, autorizacao, agoraNoFuso.fuso)) return 'sem_autorizacao';
  return 'pode_receber';
}

/** O último evento de cada paciente (estado = o último, RN-433). */
async function ultimasAutorizacoes(tx: Tx, ids: readonly string[]): Promise<Map<string, Autorizacao>> {
  if (!ids.length) return new Map();
  const rs = await tx
    .selectDistinctOn([aniversarioAutorizacoes.patientId], { patientId: aniversarioAutorizacoes.patientId, evento: aniversarioAutorizacoes.evento, registradoEm: aniversarioAutorizacoes.registradoEm })
    .from(aniversarioAutorizacoes)
    .where(inArray(aniversarioAutorizacoes.patientId, [...ids]))
    .orderBy(aniversarioAutorizacoes.patientId, desc(aniversarioAutorizacoes.registradoEm), desc(aniversarioAutorizacoes.id));
  return new Map(rs.map((r) => [r.patientId, { evento: r.evento, registradoEm: r.registradoEm }]));
}
const ultimaAutorizacao = async (tx: Tx, patientId: string) => (await ultimasAutorizacoes(tx, [patientId])).get(patientId) ?? null;

/** RN-433: a trava do paciente antes do INSERT da autorização ou da retirada (o "último evento" tem ordem). */
async function travarPaciente(tx: Tx, patientId: string) {
  const [p] = await tx
    .select({ id: patients.id, status: patients.status, anonimizadoEm: patients.anonimizadoEm, dataNascimento: patients.dataNascimento })
    .from(patients)
    .where(eq(patients.id, patientId))
    .for('no key update');
  return p ?? null;
}
const fusoDoTenant = async (tx: Tx, tenantId: string) => (await tx.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.fuso ?? 'America/Sao_Paulo';
/** Quem já mandou a mensagem do ano (enviada, agendada ou ignorada: a linha ocupa o ano, RN-432). */
async function comMensagemNoAno(tx: Tx, ids: readonly string[], ano: number): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rs = await tx
    .select({ id: notifications.patientId })
    .from(notifications)
    .where(and(sql`${ANIVERSARIO_UM_POR_ANO.onde(notifications.tipo)}`, inArray(notifications.patientId, [...ids]), sql`${ANIVERSARIO_UM_POR_ANO.ano(notifications.agendadaPara)} = ${ano}`));
  return new Set(rs.map((r) => r.id));
}

/**
 * US-412: os pacientes ativos, não anonimizados, com data de nascimento e aniversário em `mes` ('AAAA-MM'; outro valor vira
 * o mês corrente no fuso): nome de registro, dia, idade que completa e a situação. `corrente`: só o mês de hoje envia;
 * os outros são só consulta. Uma consulta por tipo (pacientes, autorizações, mensagens), sem `auditRead`.
 */
export async function aniversariantesDoMes(ctx: TenantContext, tenant: Pick<TenantAgenda, 'fuso'>, mes: unknown, deps: Deps = {}): Promise<{ mes: string; corrente: boolean; lista: Aniversariante[] }> {
  exigirNutri(ctx);
  const agora = deps.agora ?? new Date();
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const m = typeof mes === 'string' && MES.test(mes) ? mes : hoje.slice(0, 7);
  const ano = Number(m.slice(0, 4));
  const hora = horaNoFuso(agora, tenant.fuso);
  return withTenant(
    ctx,
    async (tx) => {
      const ps = await tx
        .select({ id: patients.id, nome: patients.nome, nascimento: patients.dataNascimento, telefone: patients.telefoneE164, nomeSocial: patientCadastro.nomeSocial })
        .from(patients)
        // Plano 18 (D7): o nome social só por projeção, só para a saudação do WhatsApp (AG-D35); a lista mostra o de registro
        .leftJoin(patientCadastro, and(eq(patientCadastro.tenantId, patients.tenantId), eq(patientCadastro.patientId, patients.id)))
        .where(and(eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm), sql`${patients.dataNascimento} is not null`, sql`to_char(${patients.dataNascimento}, 'MM') = ${m.slice(5, 7)}`))
        .orderBy(asc(patients.nome));
      const ids = ps.map((p) => p.id);
      const aut = await ultimasAutorizacoes(tx, ids);
      const enviadas = await comMensagemNoAno(tx, ids, ano);
      const lista = ps.map((p): Aniversariante => {
        const nascimento = p.nascimento!;
        const dia = diaDoAniversario(nascimento, ano);
        const a = aut.get(p.id) ?? null;
        const conta = autorizacaoQueConta(nascimento, a, tenant.fuso);
        return {
          patientId: p.id,
          nome: p.nome,
          dia,
          faz: ano - Number(nascimento.slice(0, 4)),
          situacao: enviadas.has(p.id) ? 'ja_enviada' : elegivel({ status: 'ativo', anonimizadoEm: null, dataNascimento: nascimento }, a, dia, hoje, { hora, fuso: tenant.fuso }),
          autorizadoEm: conta ? a!.registradoEm.toISOString() : null,
          telefone: !!p.telefone,
          podeRetirar: a?.evento === 'autorizou',
          menorHoje: hoje < maioridade(nascimento),
          whatsapp: conta && p.telefone ? { telefone: p.telefone, nome: p.nomeSocial ?? p.nome } : null,
        };
      });
      lista.sort((x, y) => x.dia.localeCompare(y.dia) || x.nome.localeCompare(y.nome, 'pt-BR'));
      return { mes: m, corrente: m === hoje.slice(0, 7), lista };
    },
    deps.db ?? getDb(),
  );
}

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** US-412 "Início do painel": quantos pacientes ativos fazem aniversário hoje no fuso (29/02 conta em 28/02 no ano comum). */
export async function contarAniversariantesDeHojeNaTransacao(tx: Tx, fuso: string, agora: Date): Promise<number> {
  const hoje = hojeNoFuso(fuso, agora);
  const chaves = [hoje.slice(5)];
  if (chaves[0] === '02-28' && !bissexto(Number(hoje.slice(0, 4)))) chaves.push('02-29');
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(patients)
    .where(and(eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm), sql`${patients.dataNascimento} is not null`, sql`to_char(${patients.dataNascimento}, 'MM-DD') in (${sql.join(chaves.map((c) => sql`${c}`), sql`, `)})`));
  return Number(r?.n ?? 0);
}

/**
 * US-413 "Enviar mensagem" (RN-432): uma linha de `notifications` (tipo `aniversario`, canal `email`, sem consulta) por
 * paciente que ainda "Pode receber" no mês corrente — a RN-431 é conferida de novo aqui, na transação —, sempre às 9h do
 * dia no fuso; a do aniversariante de hoje marcada depois das 9h (e antes das 21h) já venceu e sai na próxima varredura. Uma por paciente por ano: o
 * `ON CONFLICT` repete a expressão e o predicado do índice `notifications_aniversario_unique` (ANIVERSARIO_UM_POR_ANO), e
 * a linha ignorada também ocupa o ano. Devolve quantas foram agendadas e quantas saem agora.
 */
export async function enviarMensagensDeAniversario(ctx: TenantContext, tenant: Pick<TenantAgenda, 'fuso'>, ids: readonly unknown[], deps: Deps = {}): Promise<{ agendadas: number; agora: number }> {
  exigirNutri(ctx);
  const alvo = [...new Set(ids.filter(idValido))].slice(0, MAX_POR_ENVIO);
  if (!alvo.length) return { agendadas: 0, agora: 0 };
  const agora = deps.agora ?? new Date();
  const fuso = tenant.fuso;
  const hoje = hojeNoFuso(fuso, agora);
  const ano = Number(hoje.slice(0, 4));
  const { minutos } = partesNoFuso(agora, fuso);
  return withTenant(
    ctx,
    async (tx) => {
      const ps = await tx
        .select({ id: patients.id, status: patients.status, anonimizadoEm: patients.anonimizadoEm, dataNascimento: patients.dataNascimento })
        .from(patients)
        .where(inArray(patients.id, alvo));
      const aut = await ultimasAutorizacoes(tx, ps.map((p) => p.id));
      let agendadas = 0;
      let jaSaem = 0;
      for (const p of ps) {
        if (!p.dataNascimento) continue;
        const dia = diaDoAniversario(p.dataNascimento, ano);
        if (dia.slice(0, 7) !== hoje.slice(0, 7)) continue; // outro mês: só consulta (RN-431)
        if (elegivel(p, aut.get(p.id) ?? null, dia, hoje, { hora: Math.floor(minutos / 60), fuso }) !== 'pode_receber') continue;
        // sempre as 9h do dia no fuso (revisão da T10, M1): o de hoje depois das 9h já venceu e sai na próxima varredura
        // (lte(agendadaPara, agora)); com "agora", o envio das 20h30 em Rio Branco (01h30 UTC do dia seguinte) cairia, em
        // 31/12, no balde do ano seguinte do índice (o ano é o de UTC)
        const para = paraInstante(dia, '09:00', fuso)!;
        const ja = para.getTime() <= agora.getTime();
        const r = await tx.execute<{ id: string }>(sql`
          insert into notifications (tenant_id, patient_id, tipo, canal, status, agendada_para, created_at, updated_at)
          values (${ctx.tenantId}, ${p.id}, 'aniversario', 'email', 'pendente', ${para.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz)
          on conflict ${sql.raw(ALVO_UM_POR_ANO)} where ${sql.raw(ONDE_UM_POR_ANO)} do nothing
          returning id`);
        if (r.rows.length) {
          agendadas++;
          if (ja) jaSaem++;
        }
      }
      return { agendadas, agora: jaSaem };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-414 "Pela nutricionista": o evento `autorizou` (origem `nutri`, em nome da própria usuária) com a forma (ônus da prova
 * do controlador, LGPD art. 8º, § 2º), com o paciente travado. Sem forma válida → recusado antes do banco; menor de 18
 * hoje → "Menor de idade"; titular fora de `ativo` → recusado (o gatilho também recusa). Já autorizado (com a autorização
 * que conta) → nada novo: cada mudança é uma linha, repetir não é mudança.
 */
export async function registrarAutorizacao(ctx: TenantContext, patientId: string, forma: FormaAniversario, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  if (!(FORMAS_ANIVERSARIO as readonly unknown[]).includes(forma)) throw new AniversarioError(MSG_ANIVERSARIO.formaObrigatoria);
  await autorizar(ctx, patientId, { origem: 'nutri', forma }, deps);
}

/** US-414 "Pelo paciente": o próprio paciente, no app, com a própria conta (origem `app`, sem forma). */
export async function autorizarPeloApp(ctx: TenantContext, deps: Deps = {}): Promise<void> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('aniversário: só a sessão de paciente com conta');
  await autorizar(ctx, ctx.patientId!, { origem: 'app', forma: null }, deps);
}

async function autorizar(ctx: TenantContext, patientId: string, o: { origem: 'nutri' | 'app'; forma: FormaAniversario | null }, deps: Deps): Promise<void> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await travarPaciente(tx, patientId);
      if (!p) throw new PacienteNaoEncontradoError();
      if (p.status !== 'ativo' || p.anonimizadoEm || !p.dataNascimento) throw new AniversarioError(MSG_ANIVERSARIO.naoPodeAutorizar);
      const fuso = await fusoDoTenant(tx, ctx.tenantId);
      if (hojeNoFuso(fuso, agora) < maioridade(p.dataNascimento)) throw new AniversarioError(MSG_ANIVERSARIO.menor);
      if (autorizacaoQueConta(p.dataNascimento, await ultimaAutorizacao(tx, p.id), fuso)) return;
      await tx.insert(aniversarioAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'autorizou', origem: o.origem, forma: o.forma, registradoPor: ctx.actorUserId! });
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-414 "Retirar autorização": a nutricionista (origem `nutri`, sem a forma, AG-D61) ou o próprio paciente no app (origem
 * `app`; só a própria). Com o paciente travado; sem autorização (o último evento não é `autorizou`), nada é gravado.
 */
export async function retirarAutorizacao(ctx: TenantContext, patientId: string, deps: Deps = {}): Promise<void> {
  const origem = ctx.role === 'nutri' ? 'nutri' : sessaoDePacienteComConta(ctx) ? 'app' : null;
  if (!origem) throw new Error('aniversário: só a sessão nutri ou a do próprio paciente');
  if (origem === 'app' && patientId !== ctx.patientId) throw new Error('aniversário: o paciente só retira a própria autorização');
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await travarPaciente(tx, patientId);
      if (!p) throw new PacienteNaoEncontradoError();
      if ((await ultimaAutorizacao(tx, p.id))?.evento !== 'autorizou') return;
      await tx.insert(aniversarioAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'retirou', origem, registradoPor: ctx.actorUserId! });
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-414 (portal): o bloco "Receber mensagem de aniversário da sua nutricionista" do próprio paciente com conta. Nulo sem
 * data de nascimento (não há aniversário para mandar). `menor`: ainda não fez 18 (o botão vem desabilitado).
 */
export async function aniversarioNoApp(ctx: TenantContext, tenant: Pick<TenantAgenda, 'fuso'>, deps: Deps = {}): Promise<{ situacao: 'autorizado' | 'nao_autorizado' | 'menor'; autorizadoEm: Date | null } | null> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('aniversário: só a sessão de paciente com conta');
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ nascimento: patients.dataNascimento }).from(patients).where(eq(patients.id, ctx.patientId!));
      if (!p?.nascimento) return null;
      if (hojeNoFuso(tenant.fuso, agora) < maioridade(p.nascimento)) return { situacao: 'menor', autorizadoEm: null };
      const a = await ultimaAutorizacao(tx, ctx.patientId!);
      return autorizacaoQueConta(p.nascimento, a, tenant.fuso) ? { situacao: 'autorizado', autorizadoEm: a!.registradoEm } : { situacao: 'nao_autorizado', autorizadoEm: null };
    },
    deps.db ?? getDb(),
  );
}

/** O paciente do token, no contexto de paciente sem conta (a RLS limita ao paciente e ao tenant do token). */
const ctxDoLink = (l: { tenantId: string; patientId: string }): TenantContext => ({ tenantId: l.tenantId, role: 'paciente', patientId: l.patientId, semConta: true });

/**
 * RN-434 (página de saída, GET): mostra e não grava. `nutri` para "Você não quer mais receber mensagens de aniversário de
 * {nutricionista}?"; `vigente`: o último evento ainda é `autorizou` (depois da retirada, a página diz "Pronto."). Token que
 * não confere, titular que não existe mais ou anonimizado → inválido.
 */
export async function estadoDoLinkDeSaida(token: unknown, deps: Deps = {}): Promise<{ estado: 'ok'; nutri: string; vigente: boolean } | { estado: 'invalido' }> {
  const l = lerLinkDeSaida(token);
  if (!l) return { estado: 'invalido' };
  return withTenant(
    ctxDoLink(l),
    async (tx) => {
      const [p] = await tx.select({ id: patients.id, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, l.patientId));
      if (!p || p.anonimizadoEm) return { estado: 'invalido' as const };
      const [t] = await tx.select({ nomeExibicao: tenants.nomeExibicao, nomeProfissional: tenants.nomeProfissional }).from(tenants).where(eq(tenants.id, l.tenantId));
      if (!t) return { estado: 'invalido' as const };
      return { estado: 'ok' as const, nutri: nomeDaNutricionista(t), vigente: (await ultimaAutorizacao(tx, p.id))?.evento === 'autorizou' };
    },
    deps.db ?? getDb(),
  );
}

/**
 * RN-434 (POST de um clique e "Confirmar" da página): o evento `retirou` de origem `link`, sem conta (`semConta`), com o
 * paciente travado. Idempotente: sem autorização, `ja_retirada` sem linha nova. Limite por token (só o HMAC dele no
 * banco), não por IP; o token que não confere nem chega ao banco.
 */
export async function retirarPeloLink(token: unknown, deps: Deps = {}): Promise<'retirada' | 'ja_retirada' | 'invalido' | 'limite'> {
  const l = lerLinkDeSaida(token);
  if (!l) return 'invalido';
  const db = deps.db ?? getDb();
  if (!(await consumirLimite(db, chaveDoLimite('aniversario-sair', token as string), LIMITE_SAIDA_POR_HORA, 3600, deps.agora ?? new Date()))) return 'limite';
  return withTenant(
    ctxDoLink(l),
    async (tx) => {
      const p = await travarPaciente(tx, l.patientId);
      if (!p || p.anonimizadoEm) return 'invalido' as const;
      if ((await ultimaAutorizacao(tx, p.id))?.evento !== 'autorizou') return 'ja_retirada' as const;
      await tx.insert(aniversarioAutorizacoes).values({ tenantId: l.tenantId, patientId: p.id, evento: 'retirou', origem: 'link' });
      return 'retirada' as const;
    },
    db,
  );
}
