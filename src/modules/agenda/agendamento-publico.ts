import { createHmac, hkdfSync, randomInt, randomUUID } from 'node:crypto';
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { deadlockDetectado, uniqueViolation } from '@/db/errors';
import { appointments, consents, patients, publicBookingRequests, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { encryptionKey, randomToken, safeEqual, sha256 } from '@/lib/crypto';
import { urlDoApp } from '@/lib/url-do-app';
import { normalizeEmail, normalizarTexto } from '@/lib/text';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO, type ResultadoTurnstile } from '@/lib/turnstile';
import { agendarLembretes, avisarPaciente, dispararEnvio } from '@/modules/notificacoes/agendar';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { normalizarTelefone } from '@/modules/pacientes/telefone';
import { TERMO_PACIENTE, TERMO_PACIENTE_VERSAO } from '@/modules/pacientes/termo-paciente';
import { MSG_TEXTO_ATUALIZADO } from '@/modules/plataforma/textos-versionados';
import { buscarTenantPorSlug, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import {
  conferirAguardando,
  escolherHorario,
  gravarConsultaDoPaciente,
  horariosParaPaciente,
  localRecusado,
  locaisDoAgendamento,
  semanaDaJanela,
  travarPedidosDoTenant,
  type HorarioEscolhido,
} from './agendamento-paciente';
import { avisarNutri, avisarNutriDaConsulta } from './aviso-nutri';
import { MAX_CONSULTAS_FUTURAS_PUBLICO, MSG_AGENDA, MSG_PUBLICO, MSG_SOLICITACOES } from './constantes';
import { ConsultaError, ehSobreposicao, type TenantAgenda } from './consultas';
import { inicioDoDia, quandoComFuso, somarDias } from './fuso';
import { horariosVisiveis, localInicial, type HorarioVisivel, type LocalVisivel, type Modalidade } from './horarios';
import { chaveDoLimite, consumirLimite } from './limite-ip';
import { PedidoMudouError } from './pedido-mudou';
import { prazoDoPedido, STATUS_OCUPA } from './status';

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

/** Plano 23 (US-403): "{nome} · Nutricionista · {crn}" — o nome profissional (ou o de exibição) e o CRN como gravado. */
export type CabecalhoPublico = { nome: string; crn: string | null };
export type PaginaPublica =
  | { estado: 'nao_encontrada' }
  | { estado: 'suspensa'; nome: string }
  | { estado: 'desativada'; nome: string }
  | {
      estado: 'ativa';
      tenantId: string;
      nome: string;
      cabecalho: CabecalhoPublico;
      /** Plano 23 (I-13): os locais com agendamento pelo paciente, sem a sala; `localInicial` vem de `?local=`. */
      locais: LocalVisivel[];
      /** Plano 23 (RN-429): a chave "Confirmar os pedidos antes de marcar" — a tela mostra a frase do ponto de coleta. */
      confirmarPedidos: boolean;
      localInicial: string | null;
      semana: string;
      primeira: string;
      ultima: string;
      horarios: HorarioVisivel[];
    };
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
/**
 * `horario_ocupado`: outro horário a escolher. `indisponivel` (Plano 23): o local deixou de aceitar agendamento entre a
 * escolha e a gravação — a tela diz "não está mais disponível" em vez de "acabou de ser ocupado". `pedido` (Plano 23,
 * RN-426): com a chave ligada, a mesma resposta para quem já é paciente (consulta `solicitada`) e para a pessoa nova
 * (pedido aguardando).
 */
export type ResultadoConfirmacao =
  | { estado: 'agendada'; quando: string }
  | { estado: 'pedido'; quando: string }
  | { estado: 'horario_ocupado'; horarios: HorarioVisivel[]; indisponivel?: true };

const CODIGO_VALIDADE_MS = 10 * 60_000;
/** Depois do código certo, o pedido ainda escolhe outro horário (se o dele foi ocupado) por 30 min, sem novo código. */
const VERIFICADO_VALIDADE_MS = 30 * 60_000;
const MAX_ERROS_CODIGO = 5;
const LIMITE_IP_HORA = 10;
const LIMITE_EMAIL_HORA = 5;
const INTERVALO_CODIGO_MS = 60_000;
/** Plano 23 (revisão da T7, M3): aberturas da página do link de desistência por IP e hora (balde próprio, não o do botão). */
const LIMITE_LINK_PEDIDO_HORA = 30;
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

/** Plano 23 (US-403): o nome profissional, ou o de exibição se ele faltar; o CRN como gravado (vazio = sem CRN). */
export function cabecalhoPublico(t: Pick<TenantRow, 'nomeExibicao' | 'nomeProfissional' | 'crn'>): CabecalhoPublico {
  return { nome: t.nomeProfissional?.trim() || t.nomeExibicao, crn: t.crn?.trim() || null };
}

/**
 * US-032: o que a página pública mostra — nome da nutricionista e horários livres de uma semana da janela (D11: só
 * intervalos). Plano 23 (US-403, I-13): o cabeçalho com o CRN e os locais com agendamento pelo paciente (sem a sala); cada
 * horário traz o local e a tela filtra; `?local=` é só o valor inicial.
 */
export async function carregarPaginaPublica(slug: string, opts: { semana?: unknown; local?: unknown; agora?: Date; db?: Db } = {}): Promise<PaginaPublica> {
  const db = opts.db ?? getDb();
  const agora = opts.agora ?? new Date();
  const t = await buscarTenantPorSlug(db, slug);
  if (!t) return { estado: 'nao_encontrada' };
  if (t.status !== 'ativa') return { estado: 'suspensa', nome: t.nomeExibicao }; // RN-15
  if (!t.agendamentoPublicoAtivo) return { estado: 'desativada', nome: t.nomeExibicao };
  const { semana, primeira, ultima } = semanaDaJanela(opts.semana, hojeNoFuso(t.fuso, agora));
  const locais = await locaisDoAgendamento(t, { db });
  const horarios = await horariosDaSemana(t, semana, agora, db);
  return {
    estado: 'ativa',
    tenantId: t.id,
    nome: t.nomeExibicao,
    cabecalho: cabecalhoPublico(t),
    locais,
    localInicial: localInicial(locais, horarios, opts.local),
    confirmarPedidos: t.agendaConfirmarPedidos,
    semana,
    primeira,
    ultima,
    horarios,
  };
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
  // P08-06: o pedido grava a versão em vigor; se a página foi aberta com outra (deploy no meio), o aceite seria de um texto
  // que a pessoa não leu → 422 no campo do termo (antes do Turnstile, que não é gasto), para recarregar a página
  else if (input.termoVersao !== TERMO_PACIENTE_VERSAO) erros.aceitouTermo = MSG_TEXTO_ATUALIZADO;
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
    h = await escolherHorario(tenant, input.inicio, input.localId, agora, { db }); // conexão própria: antes da transação
  } catch (e) {
    if (e instanceof ConsultaError) throw new PublicoError(409, { inicio: MSG_AGENDA.indisponivel });
    throw e;
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
      // code-review do PR #7: a cota de 5 códigos por hora conta só o código que sai — depois do "1 por minuto" e na mesma
      // transação (sob a trava do e-mail): o clique recusado pelo "aguarde", ou qualquer recusa que desfaça a transação,
      // não gasta a cota. Nada aqui olha `patients`: a resposta é a mesma para e-mail cadastrado ou não (D12)
      if (!(await consumirLimite(tx, chaveDoLimite('email-hora', `${tenant.id}:${v.email}`), LIMITE_EMAIL_HORA, 3600, agora))) {
        throw new PublicoError(429, { geral: MSG_PUBLICO.muitasTentativas });
      }
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
        localId: h.localId, // Plano 23: o local escolhido (a projeção não tem a sala; a cópia é do gatilho, no aceite)
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

/**
 * O código vale até VERIFICADO_VALIDADE_MS depois da verificação, inclusive (exatamente 30 min ainda vale). A mesma regra está
 * em app_pedido_aguardar (custom rls_agenda_2: `now() - verificado_em > interval '30 minutes'` é inválido): mudou aqui, muda lá.
 */
const verificadoValido = (p: PedidoRow, agora: Date) => !!p.verificadoEm && agora.getTime() - p.verificadoEm.getTime() <= VERIFICADO_VALIDADE_MS;
const tokenDoPedido = (v: unknown) => (typeof v === 'string' && TOKEN_PEDIDO.test(v) ? v : null);
const pedidoExpirado = () => new PublicoError(410, { geral: MSG_PUBLICO.codigoExpirado });

/** Plano 23: `app_pedido_aguardar` disse que o horário (`ocupado`) ou o local (`invalido`) mudou — a tela mostra outros horários. */
class HorarioDoPedidoMudou extends Error {
  override name = 'HorarioDoPedidoMudou';
  constructor(readonly indisponivel: boolean) {
    super('o horário do pedido mudou');
  }
}

/**
 * Grava, numa transação no contexto `publico`: o paciente (ou reaproveita o ativo do mesmo e-mail — ele provou o
 * e-mail), a consulta com lembretes e avisos (`gravarConsultaDoPaciente`), o aceite do termo (D13) e o pedido concluído.
 * O limite de 3 consultas futuras é conferido aqui, depois do código (D12). Travas: e-mail (advisory) → tenant (Plano 23,
 * AG-D65, classe própria) → pedido → consulta nova (EXCLUDE) → paciente (FOR KEY SHARE da FK, no fim do INSERT). O
 * `publico` não trava linha de `patients` com SELECT (FOR UPDATE/SHARE/KEY SHARE exigem a política de UPDATE, que ele não
 * tem: a linha some do resultado): a trava do e-mail serializa os pedidos públicos, e a corrida com a nutricionista no
 * mesmo paciente vira 40P01 (tratado em `concluir`). Fechamento (corrida com o pedido de exclusão): a trava do paciente é
 * a da FK da consulta nova (o gatilho da FK não passa pela RLS), e o status é relido logo depois, sob ela — ver
 * `reconferirPaciente`.
 *
 * Plano 23 (RN-424 a RN-426): sob a trava do tenant, o horário não pode cruzar um pedido de pessoa nova aguardando
 * (`conferirAguardando`). Com a chave "Confirmar os pedidos" ligada (lida no banco, na transação), o e-mail sem paciente
 * vira pedido aguardando por `app_pedido_aguardar`, **sem cadastro**; o e-mail de paciente grava a consulta, que o gatilho
 * faz `solicitada` (o status do RETURNING decide, AG-D53). Nos dois casos, a mesma tela ("pedido") e o mesmo "Recebemos seu
 * pedido de consulta" (por `enqueueEmail`, nesta transação); só a pessoa nova leva o link de desistência (o token do
 * próprio pedido, AG-D48).
 */
async function gravarPedido(tx: Tx, tenant: TenantRow, r: PedidoRow, token: string, h: HorarioEscolhido, deps: DepsPublico, agora: Date): Promise<ResultadoConfirmacao> {
  await travarEmail(tx, tenant.id, r.email);
  await travarPedidosDoTenant(tx, tenant.id); // AG-D65: e-mail → tenant → paciente → pedido/consulta
  const [atual] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.id, r.id)).for('update');
  if (!atual || atual.concluidoEm || atual.aguardandoDesde) throw pedidoExpirado(); // RN-424a
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  const quando = quandoComFuso(h.inicio, tenant.fuso);
  const [chave] = await tx.select({ ligada: tenants.agendaConfirmarPedidos }).from(tenants).where(eq(tenants.id, tenant.id));
  let [p] = await tx.select().from(patients).where(eq(patients.email, r.email));
  // RN-08 / US-018: arquivado, bloqueado ou anonimizado não marca por aqui (nunca 500 nem PacienteBloqueadoError)
  if (p && (p.status !== 'ativo' || p.anonimizadoEm)) throw new PublicoError(409, { geral: MSG_AGENDA.naoAgendavel });
  if (!p && chave?.ligada) return aguardar(tx, tenant, r, token, h, appUrl, quando);
  await conferirAguardando(tx, h); // RN-425 (ConsultaError → "não está mais disponível", em `concluir`)
  const novo = !p;
  if (!p) {
    const optin = r.whatsappOptin && r.telefoneE164 ? { whatsappOptinEm: agora, whatsappOptinOrigem: 'paciente' } : {};
    [p] = await tx
      .insert(patients)
      .values({ tenantId: tenant.id, nome: r.nome, email: r.email, telefoneE164: r.telefoneE164, origem: 'agendamento_publico', ...optin, createdAt: agora, updatedAt: agora })
      .returning();
  }
  // Plano 23 (§4.3): o pedido `solicitada` conta no teto (com a chave ligada, sem isso o paciente pediria sem limite)
  const [{ n }] = await tx
    .select({ n: count() })
    .from(appointments)
    .where(and(eq(appointments.patientId, p.id), inArray(appointments.status, STATUS_OCUPA), gt(appointments.inicio, agora)));
  if (n >= MAX_CONSULTAS_FUTURAS_PUBLICO) throw new PublicoError(409, { geral: MSG_AGENDA.limitePublico });
  const { id, status } = await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl, evento: novo ? 'novo_paciente_publico' : 'marcada' });
  if (!novo) await reconferirPaciente(tx, p.id);
  await tx.insert(consents).values({ patientId: p.id, tenantId: tenant.id, termoVersao: r.termoVersao, aceitoEm: agora, ip: r.ip }).onConflictDoNothing();
  await tx.update(publicBookingRequests).set({ concluidoEm: agora, appointmentId: id }).where(eq(publicBookingRequests.id, r.id));
  if (status === 'solicitada') {
    // RN-426: o mesmo e-mail da pessoa nova, sem o link de desistência (o paciente desiste pelo portal)
    await enqueueEmail({ tipo: 'pedido_recebido', para: r.email, quando, linkDesistir: null }, { tenantId: tenant.id, tx });
    return { estado: 'pedido', quando };
  }
  return { estado: 'agendada', quando };
}

/**
 * Plano 23 (RN-424, RN-425): a pessoa nova — `app_pedido_aguardar` grava o aguardando (tetos, sobreposição e a trava do
 * tenant, que esta transação já segura). `email` e `teto_tenant` só aparecem depois do código (RN-426); `ocupado` e
 * `invalido` (o local deixou de aceitar agendamento) voltam à escolha de outro horário. A nutricionista recebe "Novo pedido
 * de consulta" com "Nova pessoa: {nome}" (o link da fila).
 */
async function aguardar(tx: Tx, tenant: TenantRow, r: PedidoRow, token: string, h: HorarioEscolhido, appUrl: string, quando: string): Promise<ResultadoConfirmacao> {
  if (!h.localId) throw new HorarioDoPedidoMudou(true);
  const res = await tx.execute<{ r: string }>(sql`select app_pedido_aguardar(${r.id}, ${h.localId}, ${h.inicio}, ${h.fim}) as r`);
  const motivo = res.rows[0]?.r;
  if (motivo === 'email') throw new PublicoError(409, { geral: MSG_PUBLICO.pedidoAguardando });
  if (motivo === 'teto_tenant') throw new PublicoError(409, { geral: MSG_AGENDA.naoAgendavel });
  if (motivo === 'ocupado') throw new HorarioDoPedidoMudou(false);
  if (motivo !== 'ok') throw new HorarioDoPedidoMudou(true);
  await avisarNutriDaConsulta(tx, tenant, { id: r.id, inicio: h.inicio, paciente: MSG_SOLICITACOES.novaPessoa(r.nome) }, 'pedido', appUrl);
  const linkDesistir = urlDoApp(appUrl, `/n/${tenant.slug}/pedido/${token}`);
  await enqueueEmail({ tipo: 'pedido_recebido', para: r.email, quando, linkDesistir }, { tenantId: tenant.id, tx });
  return { estado: 'pedido', quando };
}

/**
 * Fechamento (corrida com o pedido de exclusão atendido, US-018): o paciente lido no começo pode ter sido bloqueado,
 * anonimizado ou arquivado por uma transação ainda sem COMMIT. O INSERT da consulta já segura o paciente (`FOR KEY SHARE`
 * da FK, que conflita com o `FOR UPDATE` de `carregarPacienteParaEscrita`): se a outra transação veio antes, a FK
 * esperou o COMMIT dela e esta leitura (READ COMMITTED: foto nova) vê o status novo → 409 e tudo é desfeito; se veio
 * depois, ela espera esta terminar e cancela a consulta nova junto com as outras futuras.
 */
async function reconferirPaciente(tx: Tx, patientId: string): Promise<void> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId));
  if (!p || p.status !== 'ativo' || p.anonimizadoEm) throw new PublicoError(409, { geral: MSG_AGENDA.naoAgendavel });
}

/** Confere o horário (antes da transação: uma conexão por vez) e grava; ocupado → outros horários da mesma semana. */
async function concluir(tenant: TenantRow, r: PedidoRow, token: string, escolha: { inicio: unknown; localId: unknown }, deps: DepsPublico, db: Db, agora: Date): Promise<ResultadoConfirmacao> {
  const outros = async (indisponivel = false): Promise<ResultadoConfirmacao> => {
    // a semana do horário pedido, presa à janela (o valor vem do visitante: nunca uma data sem teto)
    const ref = typeof escolha.inicio === 'string' ? Date.parse(escolha.inicio) : NaN;
    const { semana } = semanaDaJanela(Number.isFinite(ref) ? hojeNoFuso(tenant.fuso, new Date(ref)) : null, hojeNoFuso(tenant.fuso, agora));
    const horarios = await horariosDaSemana(tenant, semana, agora, db);
    return indisponivel ? { estado: 'horario_ocupado', horarios, indisponivel: true } : { estado: 'horario_ocupado', horarios };
  };
  for (let tentativa = 0; ; tentativa++) {
    let h: HorarioEscolhido;
    try {
      h = await escolherHorario(tenant, escolha.inicio, escolha.localId, agora, { db });
    } catch (e) {
      if (e instanceof ConsultaError) return outros();
      throw e;
    }
    try {
      return await withTenant(comoPublico(tenant, deps), (tx) => gravarPedido(tx, tenant, r, token, h, deps, agora), db);
    } catch (e) {
      if (ehSobreposicao(e)) return outros(); // RN-03 / D9: ocupado entre a checagem e a gravação — o EXCLUDE decide
      // Plano 23 (RN-425): um pedido de pessoa nova aguardando cruzou o horário (conferirAguardando) ou app_pedido_aguardar
      // achou o horário ocupado ou o local sem agendamento — outros horários
      if (e instanceof HorarioDoPedidoMudou) return outros(e.indisponivel);
      if (e instanceof ConsultaError) return outros(true);
      // a rede do índice único (1 aguardando por e-mail): a mesma mensagem do motivo `email`, só depois do código (RN-426)
      if (uniqueViolation(e) === 'public_booking_requests_aguardando_email_unique') throw new PublicoError(409, { geral: MSG_PUBLICO.pedidoAguardando });
      // Plano 23 (RN-406): o local foi arquivado ou deixou de aceitar agendamento entre a checagem e a gravação (42501 do
      // gatilho appointments_link_da_sala): "não está mais disponível", com os outros horários
      if (localRecusado(e)) return outros(true);
      // a nutricionista marcava o mesmo paciente (travado, FOR UPDATE) num horário que se sobrepõe a este: a FK da consulta
      // nova esperou por ela e ela, pelo EXCLUDE desta. O `publico` não trava o paciente antes (não tem a política de
      // UPDATE); o Postgres desfaz uma das duas (40P01). Se for esta, o horário fica com a nutricionista; se for a dela,
      // ela repete (repetirSeDeadlock) e recebe o conflito, e o horário fica com o paciente.
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
      // RN-424a: o aguardando nem aparece ao publico (aguardando_fora_do_publico); a regra fica aqui também
      if (!p || p.concluidoEm || p.aguardandoDesde) return { erro: pedidoExpirado() };
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
  const localId = r.pedido.localId ?? (await localDoPedidoSemLocal(tenant, r.pedido, agora, db));
  return concluir(tenant, r.pedido, token, { inicio: r.pedido.inicio.toISOString(), localId }, deps, db, agora);
}

/**
 * Code-review do PR 2 (Plano 23): o pedido gravado pela imagem anterior não tem `local_id`. O local é o que gera agora o
 * horário do pedido na modalidade dele, entre os ativos com agendamento pelo paciente (`horariosParaPaciente`, RN-410a); só
 * com exatamente um. Sem nenhum (ou com mais de um), `null`: `escolherHorario` recusa e a pessoa recebe o "horário ocupado"
 * de sempre, com os outros horários.
 */
async function localDoPedidoSemLocal(tenant: TenantRow, p: PedidoRow, agora: Date, db: Db): Promise<string | null> {
  const t = p.inicio.getTime();
  const hs = await horariosParaPaciente(tenant, agora, { db, de: p.inicio, ate: new Date(t + 60_000) });
  const locais = new Set(hs.filter((h) => h.inicio.getTime() === t && h.modalidades.includes(p.modalidade as Modalidade)).map((h) => h.localId));
  return locais.size === 1 ? [...locais][0] : null;
}

/** Depois de "horário ocupado": o pedido já verificado escolhe outro horário sem novo código (até 30 min). */
export async function escolherOutroHorario(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<ResultadoConfirmacao> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const token = tokenDoPedido(input.pedido);
  if (!token) throw pedidoExpirado();
  const [p] = await withTenant(comoPublico(tenant, deps), (tx) => tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.tokenHash, sha256(token))), db);
  if (!p || p.concluidoEm || p.aguardandoDesde || !verificadoValido(p, agora)) throw pedidoExpirado(); // RN-424a
  return concluir(tenant, p, token, { inicio: input.inicio, localId: input.localId }, deps, db, agora);
}

/**
 * Diário (agenda-limpeza, 04:30): LGPD (minimização). Plano 23 (RN-429, AG-D21): o pedido sem aguardar (sem código, ou o
 * concluído na hora) some 24 h depois da criação, como antes; o da pessoa nova, 24 h depois da resposta (`resolvido_em`:
 * aceito, recusado, vencido ou desistido); o aguardando nunca pelas 24 h da criação. Rede (revisão da T7): o aguardando
 * nunca resolvido cujo horário passou há mais de 24 h também sai — a frase do ponto de coleta vale mesmo se o vencimento
 * (`vencerSolicitacoes`) falhar sempre.
 */
export async function limparPedidosPublicos(db: Db, agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - 86_400_000);
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const r = await withTenant(
      { tenantId: t.id, role: 'worker' },
      (tx) =>
        tx
          .delete(publicBookingRequests)
          .where(
            or(
              and(isNull(publicBookingRequests.aguardandoDesde), lt(publicBookingRequests.createdAt, limite)),
              and(isNotNull(publicBookingRequests.resolvidoEm), lt(publicBookingRequests.resolvidoEm, limite)),
              and(isNotNull(publicBookingRequests.aguardandoDesde), isNull(publicBookingRequests.resolvidoEm), lt(publicBookingRequests.inicio, limite)),
            ),
          )
          .returning({ id: publicBookingRequests.id }),
      db,
    );
    n += r.length;
  }
  return n;
}

/**
 * Plano 23 (RN-424, US-409 "Aceitar pessoa nova"): na sessão `nutri`, na transação de `aceitarSolicitacao`. Travas: tenant
 * → linha do pedido (`FOR UPDATE`) → paciente do e-mail (`FOR NO KEY UPDATE`), AG-D65. Pedido que não aguarda mais, ou fora
 * do prazo (`início − antecedência ≤ agora`) → `PedidoMudouError`. E-mail de paciente ativo: a consulta vai para ele (o
 * opt-in dele não muda); arquivado, bloqueado ou anonimizado → "Este e-mail é de um paciente arquivado ou bloqueado…".
 * Senão nasce o cadastro (origem `agendamento_publico`; opt-in do WhatsApp do pedido com a data da verificação do código),
 * o aceite do termo (versão, momento da verificação e IP do pedido; CLAUDE.md regra 1) e a consulta `agendada` (origem
 * `paciente`; num local online, o gatilho appointments_link_da_sala copia a sala). Horário tomado no meio (23P01) →
 * "Esse horário já está ocupado…" (tudo desfeito). O pedido fica concluído e `aceito` (RN-429: some 24 h depois).
 * O aceite do termo (D13) vale também para o e-mail que já é de paciente ativo: quem provou o código aceitou o termo na
 * página (revisão da T7, M1); o opt-in do WhatsApp do pedido só entra no cadastro novo.
 * Revisão da T7 (M4): confere no banco o papel da sessão (`nutri`, senão erro antes de qualquer trava) e usa o consultório
 * da sessão (`app_current_tenant()`) para a trava e as gravações; `tenant` de outro consultório é recusado.
 */
export async function aceitarPedidoPublico(tx: Tx, tenant: TenantAgenda, pedidoId: string, o: { agora: Date; appUrl: string }): Promise<{ appointmentId: string }> {
  const [sessao] = (await tx.execute<{ papel: string | null; tenant: string | null }>(sql`select app_current_role() as papel, app_current_tenant()::text as tenant`)).rows;
  if (sessao?.papel !== 'nutri' || !sessao.tenant) throw new Error('agenda: só a sessão nutri');
  if (sessao.tenant !== tenant.id) throw new Error('agenda: consultório diferente do da sessão');
  const tenantId = sessao.tenant;
  if (!idValido(pedidoId)) throw new PedidoMudouError();
  await travarPedidosDoTenant(tx, tenantId);
  const [r] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.id, pedidoId)).for('update');
  if (!r || !r.aguardandoDesde || r.resolvidoEm || !r.fim || !r.localId || !r.verificadoEm) throw new PedidoMudouError();
  if (prazoDoPedido(r.inicio, tenant).getTime() <= o.agora.getTime()) throw new PedidoMudouError();
  let [p] = await tx.select().from(patients).where(eq(patients.email, r.email)).for('no key update');
  if (p && (p.status !== 'ativo' || p.anonimizadoEm)) throw new ConsultaError({ geral: MSG_SOLICITACOES.emailInativo });
  if (!p) {
    const optin = r.whatsappOptin && r.telefoneE164 ? { whatsappOptinEm: r.verificadoEm, whatsappOptinOrigem: 'paciente' } : {};
    [p] = await tx
      .insert(patients)
      .values({ tenantId, nome: r.nome, email: r.email, telefoneE164: r.telefoneE164, origem: 'agendamento_publico', ...optin, createdAt: o.agora, updatedAt: o.agora })
      .returning();
  }
  await tx.insert(consents).values({ patientId: p.id, tenantId, termoVersao: r.termoVersao, aceitoEm: r.verificadoEm, ip: r.ip }).onConflictDoNothing();
  let c: { id: string };
  try {
    [c] = await tx
      .insert(appointments)
      .values({
        tenantId,
        patientId: p.id,
        inicio: r.inicio,
        fim: r.fim,
        modalidade: r.modalidade,
        localId: r.localId,
        linkOnline: null, // a sala do local online vem do gatilho appointments_link_da_sala (origem paciente)
        status: 'agendada',
        origem: 'paciente',
        createdAt: o.agora,
        updatedAt: o.agora,
      })
      .returning({ id: appointments.id });
  } catch (e) {
    if (ehSobreposicao(e)) throw new ConsultaError({ geral: MSG_SOLICITACOES.horarioOcupado }); // R-408
    throw e;
  }
  const aviso = { tenantId, patientId: p.id, appointmentId: c.id, inicio: r.inicio };
  await agendarLembretes(tx, aviso, tenant.fuso, o.agora);
  await avisarPaciente(tx, aviso, 'consulta_marcada', o.agora);
  await tx.update(publicBookingRequests).set({ concluidoEm: o.agora, appointmentId: c.id, resolvidoEm: o.agora, resolucao: 'aceito' }).where(eq(publicBookingRequests.id, r.id));
  await dispararEnvio(tx, tenantId);
  return { appointmentId: c.id };
}

export type EstadoDaDesistencia = { estado: 'aguardando' | 'cancelado'; quando: string } | { estado: 'invalido' | 'limite'; quando?: undefined };

/**
 * Plano 23 (AG-D42, AG-D48, AG-D49, AG-D63): a pessoa nova desiste do pedido aguardando pelo link do e-mail, no contexto
 * `publico` (que não lê a linha: tudo por `app_pedido_publico_desistir`, com o hash do token). `confirmar` falso (GET da
 * página) só mostra, com um limite por IP próprio (`pedido-link-ip`, revisão da T7, M3: leitores de link não gastam o balde
 * do botão); verdadeiro (o POST do botão) grava `desistido`, conta no limite por IP da página
 * pública (`ip` = o balde, IPv6 /64) e avisa a nutricionista só quando a função diz que gravou agora ("Nova pessoa: {primeiro
 * nome}"): F5, duplo clique e o leitor de link que reabre não repetem o aviso. Token fora do formato, consultório que não
 * existe ou pedido que não aguarda (aceito, recusado, vencido) → `invalido`; POST além do limite por IP → `limite` (nada gravado).
 */
export async function desistirDoPedidoPublico(
  slug: string,
  token: string,
  o: { confirmar: boolean; ip: string | null; agora?: Date; db?: Db; appUrl?: string },
): Promise<EstadoDaDesistencia> {
  const db = o.db ?? getDb();
  const agora = o.agora ?? new Date();
  const balde = o.confirmar ? chaveDoLimite('ip', o.ip ?? 'desconhecido') : chaveDoLimite('pedido-link-ip', o.ip ?? 'desconhecido');
  if (!(await consumirLimite(db, balde, o.confirmar ? LIMITE_IP_HORA : LIMITE_LINK_PEDIDO_HORA, 3600, agora))) return { estado: 'limite' };
  const t = tokenDoPedido(token);
  if (!t) return { estado: 'invalido' };
  const tenant = await buscarTenantPorSlug(db, slug);
  if (!tenant) return { estado: 'invalido' };
  return withTenant(
    { tenantId: tenant.id, role: 'publico', ip: o.ip },
    async (tx): Promise<EstadoDaDesistencia> => {
      const res = await tx.execute<{ estado: string; inicio: Date | string | null; gravou: boolean | null; primeiro_nome: string | null }>(
        sql`select estado, inicio, gravou, primeiro_nome from app_pedido_publico_desistir(${sha256(t)}, ${o.confirmar})`,
      );
      const row = res.rows[0];
      if (!row?.inicio || (row.estado !== 'aguardando' && row.estado !== 'cancelado')) return { estado: 'invalido' };
      const inicio = new Date(row.inicio);
      const quando = quandoComFuso(inicio, tenant.fuso);
      const nome = row.primeiro_nome;
      if (row.gravou && nome) {
        const link = urlDoApp(o.appUrl ?? getEnv().APP_URL, '/painel/agenda');
        await avisarNutri(tx, tenant.id, (para) => ({ tipo: 'aviso_agenda', para, evento: 'pedido_desistido', paciente: MSG_SOLICITACOES.novaPessoa(nome), quando, link }));
      }
      return { estado: row.estado, quando };
    },
    db,
  );
}
