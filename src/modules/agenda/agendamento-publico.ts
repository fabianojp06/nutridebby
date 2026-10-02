import { createHmac, hkdfSync, randomInt, randomUUID } from 'node:crypto';
import { and, count, eq, gt, inArray, lt, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { deadlockDetectado, uniqueViolation } from '@/db/errors';
import { appointments, consents, patients, publicBookingRequests, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { encryptionKey, randomToken, safeEqual, sha256 } from '@/lib/crypto';
import { normalizeEmail, normalizarTexto } from '@/lib/text';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO, type ResultadoTurnstile } from '@/lib/turnstile';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { normalizarTelefone } from '@/modules/pacientes/telefone';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { buscarTenantPorSlug, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { escolherHorario, gravarConsultaDoPaciente, horariosParaPaciente, semanaDaJanela, type HorarioEscolhido } from './agendamento-paciente';
import { MAX_CONSULTAS_FUTURAS_PUBLICO, MSG_AGENDA, MSG_PUBLICO } from './constantes';
import { ConsultaError, ehSobreposicao, STATUS_ATIVOS } from './consultas';
import { inicioDoDia, quandoComFuso, somarDias } from './fuso';
import { horariosVisiveis, type HorarioVisivel } from './horarios';
import { chaveDoLimite, consumirLimite } from './limite-ip';

export { MSG_PUBLICO };

/** `status` = o HTTP que a rota devolve; `erros` = { campo: texto } (o campo `geral` é a mensagem do formulário). */
export class PublicoError extends Error {
  override name = 'PublicoError';
  constructor(
    readonly status: number,
    readonly erros: Record<string, string>,
  ) {
    super('Agendamento público recusado');
  }
}

export type PaginaPublica =
  | { estado: 'nao_encontrada' }
  | { estado: 'suspensa'; nome: string }
  | { estado: 'desativada'; nome: string }
  | { estado: 'ativa'; nome: string; temOnline: boolean; semana: string; primeira: string; ultima: string; horarios: HorarioVisivel[] };
/**
 * `ip`: o de quem pediu (auditoria, aceite do termo, Turnstile). `ipDoLimite`: o balde do limite por IP — a rota passa
 * o `clientIpDoLimite` (IPv6: o /64); sem ele, conta pelo próprio `ip`.
 */
export type DepsPublico = {
  db?: Db;
  agora?: Date;
  ip: string | null;
  ipDoLimite?: string | null;
  verificarTurnstile: (token: string | null) => Promise<ResultadoTurnstile>;
  appUrl?: string;
};
export type ResultadoConfirmacao = { estado: 'agendada'; quando: string } | { estado: 'horario_ocupado'; horarios: HorarioVisivel[] };

const CODIGO_VALIDADE_MS = 10 * 60_000;
/** Depois do código certo, o pedido ainda escolhe outro horário (se o dele foi ocupado) por 30 min, sem novo código. */
const VERIFICADO_VALIDADE_MS = 30 * 60_000;
const MAX_ERROS_CODIGO = 5;
const LIMITE_IP_HORA = 10;
const LIMITE_EMAIL_HORA = 5;
const INTERVALO_CODIGO_MS = 60_000;
/** O token do pedido é `randomToken()` (32 bytes em base64url). */
const TOKEN_PEDIDO = /^[A-Za-z0-9_-]{43}$/;

let chaveCodigos: Buffer | undefined;
/** HMAC do código amarrado ao pedido: o banco nunca tem o código, e o de um pedido não confere em outro. */
const hashDoCodigo = (pedidoId: string, codigo: string) =>
  createHmac('sha256', (chaveCodigos ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:codigo-agendamento:v1', 32))))
    .update(`${pedidoId}:${codigo}`)
    .digest('base64url');

/** D11: o contexto sem login, com o IP de quem pediu (vai para a auditoria do paciente e da consulta). */
const comoPublico = (tenant: TenantRow, deps: DepsPublico): TenantContext => ({ tenantId: tenant.id, role: 'publico', ip: deps.ip });

/** Um pedido por vez por e-mail no tenant: o "1 código por minuto" e as 3 consultas futuras não correm entre si. */
const travarEmail = (tx: Tx, tenantId: string, email: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-publico'), hashtext(${`${tenantId}:${email}`}))`);

async function horariosDaSemana(tenant: TenantRow, semana: string, agora: Date, db: Db): Promise<HorarioVisivel[]> {
  const hs = await horariosParaPaciente(tenant, agora, { db, de: inicioDoDia(semana, tenant.fuso), ate: inicioDoDia(somarDias(semana, 7), tenant.fuso) });
  return horariosVisiveis(hs, tenant.fuso);
}

/** US-032: o que a página pública mostra — nome da nutricionista e horários livres de uma semana da janela (D11: só intervalos). */
export async function carregarPaginaPublica(slug: string, opts: { semana?: unknown; agora?: Date; db?: Db } = {}): Promise<PaginaPublica> {
  const db = opts.db ?? getDb();
  const agora = opts.agora ?? new Date();
  const t = await buscarTenantPorSlug(db, slug);
  if (!t) return { estado: 'nao_encontrada' };
  if (t.status !== 'ativa') return { estado: 'suspensa', nome: t.nomeExibicao }; // RN-15
  if (!t.agendamentoPublicoAtivo) return { estado: 'desativada', nome: t.nomeExibicao };
  const { semana, primeira, ultima } = semanaDaJanela(opts.semana, hojeNoFuso(t.fuso, agora));
  return { estado: 'ativa', nome: t.nomeExibicao, temOnline: !!t.linkOnlinePadrao, semana, primeira, ultima, horarios: await horariosDaSemana(t, semana, agora, db) };
}

type DadosDoPedido = { nome: string; email: string; telefone: string | null; whatsapp: boolean };

function validarPedido(input: Record<string, unknown>): DadosDoPedido {
  const erros: Record<string, string> = {};
  const nome = normalizarTexto(input.nome);
  if (nome.length < 2 || nome.length > 120) erros.nome = MSG_PUBLICO.nome;
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
  if (email.length > 254 || !z.email().safeParse(email).success) erros.email = MSG_PUBLICO.email;
  const telTxt = typeof input.telefone === 'string' ? input.telefone.trim() : '';
  const telefone = telTxt ? normalizarTelefone(telTxt) : null;
  if (telTxt && !telefone) erros.telefone = MSG_PUBLICO.telefone;
  const whatsapp = input.whatsapp === true;
  if (whatsapp && !telefone && !erros.telefone) erros.telefone = MSG_PUBLICO.telefoneWhatsapp;
  if (input.maiorDeIdade !== true) erros.maiorDeIdade = MSG_PUBLICO.maioridade; // RN-17
  if (input.aceitouTermo !== true) erros.aceitouTermo = MSG_PUBLICO.termo;
  if (Object.keys(erros).length) throw new PublicoError(422, erros);
  return { nome, email, telefone, whatsapp };
}

/**
 * Entrada das três ações. RN-16: 10 tentativas por IP (IPv6: o /64) por hora — o contador é a única escrita antes do
 * Turnstile (D12) e vale para qualquer slug, inclusive o que não existe. Conta suspensa ou página desligada → 404.
 */
async function abrir(slug: string, deps: DepsPublico): Promise<{ db: Db; agora: Date; tenant: TenantRow }> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const balde = deps.ipDoLimite ?? deps.ip ?? 'desconhecido'; // sem IP (não acontece atrás do proxy): um balde só
  if (!(await consumirLimite(db, chaveDoLimite('ip', balde), LIMITE_IP_HORA, 3600, agora))) throw new PublicoError(429, { geral: MSG_PUBLICO.muitasTentativas });
  const tenant = await buscarTenantPorSlug(db, slug);
  if (!tenant || tenant.status !== 'ativa' || !tenant.agendamentoPublicoAtivo) throw new PublicoError(404, { geral: MSG_PUBLICO.indisponivel });
  return { db, agora, tenant };
}

/**
 * RN-16 passo 1: valida, confere o Turnstile (antes de qualquer escrita de negócio), confere o horário e manda o código
 * de 6 dígitos (10 min). D12: a resposta é a mesma para e-mail cadastrado ou não — nada aqui olha `patients`.
 */
export async function solicitarCodigo(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<{ pedido: string }> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const v = validarPedido(input);
  const t = await deps.verificarTurnstile(typeof input.turnstileToken === 'string' ? input.turnstileToken : null);
  if (t === 'indisponivel') throw new PublicoError(503, { geral: MSG_TURNSTILE_FORA });
  if (t !== 'ok') throw new PublicoError(403, { geral: MSG_TURNSTILE_INVALIDO });
  let h: HorarioEscolhido;
  try {
    h = await escolherHorario(tenant, input.inicio, input.modalidade, agora, { db }); // conexão própria: antes da transação
  } catch (e) {
    if (e instanceof ConsultaError) throw new PublicoError(409, { inicio: MSG_AGENDA.indisponivel });
    throw e;
  }
  if (!(await consumirLimite(db, chaveDoLimite('email-hora', `${tenant.id}:${v.email}`), LIMITE_EMAIL_HORA, 3600, agora))) {
    throw new PublicoError(429, { geral: MSG_PUBLICO.muitasTentativas });
  }
  const pedido = randomToken();
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = randomUUID();
  await withTenant(
    comoPublico(tenant, deps),
    async (tx) => {
      await travarEmail(tx, tenant.id, v.email);
      const [u] = await tx.select({ em: max(publicBookingRequests.createdAt) }).from(publicBookingRequests).where(eq(publicBookingRequests.email, v.email));
      if (u?.em && agora.getTime() - u.em.getTime() < INTERVALO_CODIGO_MS) throw new PublicoError(429, { geral: MSG_PUBLICO.aguarde });
      await tx.insert(publicBookingRequests).values({
        id,
        tenantId: tenant.id,
        tokenHash: sha256(pedido),
        codigoHash: hashDoCodigo(id, codigo),
        email: v.email,
        nome: v.nome,
        telefoneE164: v.telefone,
        whatsappOptin: v.whatsapp,
        inicio: h.inicio,
        modalidade: h.modalidade,
        termoVersao: TERMO_PACIENTE,
        ip: deps.ip,
        expiraEm: new Date(agora.getTime() + CODIGO_VALIDADE_MS),
        createdAt: agora,
      });
      // o código só sai junto com o pedido gravado (mesma transação)
      await enqueueEmail({ tipo: 'codigo_agendamento', para: v.email, nutri: tenant.nomeExibicao, codigo }, { tenantId: tenant.id, tx });
    },
    db,
  );
  return { pedido };
}

type PedidoRow = typeof publicBookingRequests.$inferSelect;

const verificadoValido = (p: PedidoRow, agora: Date) => !!p.verificadoEm && agora.getTime() - p.verificadoEm.getTime() <= VERIFICADO_VALIDADE_MS;
const tokenDoPedido = (v: unknown) => (typeof v === 'string' && TOKEN_PEDIDO.test(v) ? v : null);
const pedidoExpirado = () => new PublicoError(410, { geral: MSG_PUBLICO.codigoExpirado });

/**
 * Grava, numa transação no contexto `publico`: o paciente (ou reaproveita o ativo do mesmo e-mail — ele provou o
 * e-mail), a consulta com lembretes e avisos (`gravarConsultaDoPaciente`), o aceite do termo (D13) e o pedido concluído.
 * O limite de 3 consultas futuras é conferido aqui, depois do código (D12). Travas: e-mail (advisory) → pedido →
 * consulta nova (EXCLUDE) → paciente (FOR KEY SHARE da FK, no fim do INSERT). O `publico` não trava linha de `patients`
 * (FOR UPDATE/SHARE exigem a política de UPDATE, que ele não tem): a trava do e-mail serializa os pedidos públicos, e a
 * corrida com a nutricionista no mesmo paciente vira 40P01 (tratado em `concluir`).
 */
async function gravarPedido(tx: Tx, tenant: TenantRow, r: PedidoRow, h: HorarioEscolhido, deps: DepsPublico, agora: Date): Promise<ResultadoConfirmacao> {
  await travarEmail(tx, tenant.id, r.email);
  const [atual] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.id, r.id)).for('update');
  if (!atual || atual.concluidoEm) throw pedidoExpirado();
  let [p] = await tx.select().from(patients).where(eq(patients.email, r.email));
  // RN-08 / US-018: arquivado, bloqueado ou anonimizado não marca por aqui (nunca 500 nem PacienteBloqueadoError)
  if (p && (p.status !== 'ativo' || p.anonimizadoEm)) throw new PublicoError(409, { geral: MSG_AGENDA.naoAgendavel });
  const novo = !p;
  if (!p) {
    const optin = r.whatsappOptin && r.telefoneE164 ? { whatsappOptinEm: agora, whatsappOptinOrigem: 'paciente' } : {};
    [p] = await tx
      .insert(patients)
      .values({ tenantId: tenant.id, nome: r.nome, email: r.email, telefoneE164: r.telefoneE164, origem: 'agendamento_publico', ...optin, createdAt: agora, updatedAt: agora })
      .returning();
  }
  const [{ n }] = await tx
    .select({ n: count() })
    .from(appointments)
    .where(and(eq(appointments.patientId, p.id), inArray(appointments.status, STATUS_ATIVOS), gt(appointments.inicio, agora)));
  if (n >= MAX_CONSULTAS_FUTURAS_PUBLICO) throw new PublicoError(409, { geral: MSG_AGENDA.limitePublico });
  const id = await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: novo ? 'novo_paciente_publico' : 'marcada' });
  await tx.insert(consents).values({ patientId: p.id, tenantId: tenant.id, termoVersao: r.termoVersao, aceitoEm: agora, ip: r.ip }).onConflictDoNothing();
  await tx.update(publicBookingRequests).set({ concluidoEm: agora, appointmentId: id }).where(eq(publicBookingRequests.id, r.id));
  return { estado: 'agendada', quando: quandoComFuso(h.inicio, tenant.fuso) };
}

/** Confere o horário (antes da transação: uma conexão por vez) e grava; ocupado → outros horários da mesma semana. */
async function concluir(tenant: TenantRow, r: PedidoRow, escolha: { inicio: unknown; modalidade: unknown }, deps: DepsPublico, db: Db, agora: Date): Promise<ResultadoConfirmacao> {
  const outros = async (): Promise<ResultadoConfirmacao> => {
    // a semana do horário pedido, presa à janela (o valor vem do visitante: nunca uma data sem teto)
    const ref = typeof escolha.inicio === 'string' ? Date.parse(escolha.inicio) : NaN;
    const { semana } = semanaDaJanela(Number.isFinite(ref) ? hojeNoFuso(tenant.fuso, new Date(ref)) : null, hojeNoFuso(tenant.fuso, agora));
    return { estado: 'horario_ocupado', horarios: await horariosDaSemana(tenant, semana, agora, db) };
  };
  for (let tentativa = 0; ; tentativa++) {
    let h: HorarioEscolhido;
    try {
      h = await escolherHorario(tenant, escolha.inicio, escolha.modalidade, agora, { db });
    } catch (e) {
      if (e instanceof ConsultaError) return outros();
      throw e;
    }
    try {
      return await withTenant(comoPublico(tenant, deps), (tx) => gravarPedido(tx, tenant, r, h, deps, agora), db);
    } catch (e) {
      if (ehSobreposicao(e)) return outros(); // RN-03 / D9: ocupado entre a checagem e a gravação — o EXCLUDE decide
      // a nutricionista marcava o mesmo paciente (travado, FOR UPDATE) num horário que se sobrepõe a este: a FK da consulta
      // nova esperou por ela e ela, pelo EXCLUDE desta. O `publico` não trava o paciente antes (não tem a política de
      // UPDATE); o Postgres desfaz esta transação (40P01) e o horário fica com a nutricionista.
      if (deadlockDetectado(e)) return outros();
      // a nutricionista cadastrou o mesmo e-mail ao mesmo tempo: de novo, agora o paciente existe (uma vez só)
      if (tentativa === 0 && uniqueViolation(e) === 'patients_tenant_email_unique') continue;
      throw e;
    }
  }
}

/** RN-16 passo 2: o código certo marca o pedido como verificado (30 min para escolher outro horário, se preciso) e conclui. */
export async function confirmarCodigo(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<ResultadoConfirmacao> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const token = tokenDoPedido(input.pedido);
  if (!token) throw pedidoExpirado();
  const r = await withTenant(
    comoPublico(tenant, deps),
    async (tx): Promise<{ pedido: PedidoRow } | { erro: PublicoError }> => {
      const [p] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.tokenHash, sha256(token))).for('update');
      if (!p || p.concluidoEm) return { erro: pedidoExpirado() };
      if (p.verificadoEm) return verificadoValido(p, agora) ? { pedido: p } : { erro: pedidoExpirado() };
      if (p.tentativas >= MAX_ERROS_CODIGO) return { erro: new PublicoError(410, { geral: MSG_PUBLICO.codigoBloqueado }) };
      if (p.expiraEm.getTime() <= agora.getTime()) return { erro: pedidoExpirado() };
      // "123 456" colado do e-mail vale; o que não tem 6 dígitos não pode ser o código e não gasta tentativa
      const codigo = typeof input.codigo === 'string' ? input.codigo.replace(/\D/g, '') : '';
      if (!/^\d{6}$/.test(codigo)) return { erro: new PublicoError(422, { codigo: MSG_PUBLICO.codigoIncorreto }) };
      if (!safeEqual(hashDoCodigo(p.id, codigo), p.codigoHash)) {
        // o erro é gravado (commit) antes de responder: 5 erros invalidam o pedido
        await tx.update(publicBookingRequests).set({ tentativas: p.tentativas + 1 }).where(eq(publicBookingRequests.id, p.id));
        return { erro: new PublicoError(422, { codigo: MSG_PUBLICO.codigoIncorreto }) };
      }
      const [v] = await tx.update(publicBookingRequests).set({ verificadoEm: agora }).where(eq(publicBookingRequests.id, p.id)).returning();
      return { pedido: v };
    },
    db,
  );
  if ('erro' in r) throw r.erro;
  return concluir(tenant, r.pedido, { inicio: r.pedido.inicio.toISOString(), modalidade: r.pedido.modalidade }, deps, db, agora);
}

/** Depois de "horário ocupado": o pedido já verificado escolhe outro horário sem novo código (até 30 min). */
export async function escolherOutroHorario(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<ResultadoConfirmacao> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const token = tokenDoPedido(input.pedido);
  if (!token) throw pedidoExpirado();
  const [p] = await withTenant(comoPublico(tenant, deps), (tx) => tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.tokenHash, sha256(token))), db);
  if (!p || p.concluidoEm || !verificadoValido(p, agora)) throw pedidoExpirado();
  return concluir(tenant, p, { inicio: input.inicio, modalidade: input.modalidade }, deps, db, agora);
}

/** Diário (agenda-limpeza): pedidos com mais de 24 h somem (LGPD: minimização). */
export async function limparPedidosPublicos(db: Db, agora: Date): Promise<number> {
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const r = await withTenant(
      { tenantId: t.id, role: 'worker' },
      (tx) => tx.delete(publicBookingRequests).where(lt(publicBookingRequests.createdAt, new Date(agora.getTime() - 86_400_000))).returning({ id: publicBookingRequests.id }),
      db,
    );
    n += r.length;
  }
  return n;
}
