import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaAutorizacoes, patients, tenants, type IaAutorizacaoRow, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { assinarLinkPedido, assinarLinkRetirada, codigoDeReferencia, emailHmac, urlDoLinkAutorizacao } from './autorizacao-token';
import { cancelarTarefas } from './cancelar';
import {
  DESTINO_ROTULO, JANELA_EMAIL_TROCADO_MS, MSG_AUTORIZACAO, MSG_FALHA, MSG_IA, TERMO_MAX_BYTES, VALIDADE_PEDIDO_MS,
  type CanalAutorizacao, type DestinoIA, type EventoAutorizacao, type MotivoFalha, type UsoIA,
} from './constantes';
import { estadoIaDoTenant, type ConfigIA, type ModoIA } from './modo';
import { AUTORIZACAO_IA_USOS, AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_DATA, AUTORIZACAO_IA_VERSAO_MIN, conferirTextoExibido, responsavelDoTenant, versaoAtende } from './textos-legais';

/**
 * Plano 14A (spec da IA v0.5.1, RN-107 a RN-109, A-D23 a A-D25): a autorização do paciente para o uso de IA. Esta é a parte
 * de LEITURA (a situação, a RN-100 do paciente), a retirada registrada pela nutricionista e, no fim do arquivo, a escrita
 * pelo app, pelo pedido por e-mail e pelo termo em papel e os dados das telas (T5). O link do e-mail fica em
 * `autorizacao-link.ts`. Cada linha de `ia_autorizacoes` é um evento, só de inclusão (0108).
 */
export type SituacaoAutorizacao =
  | { tipo: 'nunca' }
  | { tipo: 'vigente'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA; usos: UsoIA[] }
  | { tipo: 'retirada'; id: string; em: Date; canal: CanalAutorizacao }
  | { tipo: 'versao_antiga'; id: string; em: Date; canal: CanalAutorizacao; versao: string }
  | { tipo: 'outro_destino'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA };

export type EventoDeDecisao = Pick<IaAutorizacaoRow, 'id' | 'evento' | 'versao' | 'usos' | 'destino' | 'canal' | 'em' | 'registradoEm'>;

/**
 * RN-107 (D7): o último evento de decisão (`autorizou`/`retirou`) decide. Vigente = `autorizou`, versão ≥ o mínimo e o
 * destino do provedor em uso (RN-109); o uso é conferido por `vigentePara`. Com `destino` nulo (IA_PROVEDOR ausente), o
 * destino não é conferido — só a tela usa assim; a RN-100 nunca chega aqui sem provedor.
 */
export function situacaoDaAutorizacao(ultimo: EventoDeDecisao | null, destino: DestinoIA | null): SituacaoAutorizacao {
  if (!ultimo) return { tipo: 'nunca' };
  const base = { id: ultimo.id, em: ultimo.em, canal: ultimo.canal as CanalAutorizacao };
  if (ultimo.evento === 'retirou') return { tipo: 'retirada', ...base };
  const versao = ultimo.versao ?? '';
  if (!versaoAtende(versao, AUTORIZACAO_IA_VERSAO_MIN)) return { tipo: 'versao_antiga', ...base, versao };
  const doEvento = ultimo.destino as DestinoIA;
  if (destino !== null && doEvento !== destino) return { tipo: 'outro_destino', ...base, versao, destino: doEvento };
  return { tipo: 'vigente', ...base, versao, destino: doEvento, usos: (ultimo.usos ?? []) as UsoIA[] };
}

export const vigentePara = (s: SituacaoAutorizacao, uso: UsoIA): boolean => s.tipo === 'vigente' && s.usos.includes(uso);

/** O último `autorizou`/`retirou` do paciente (por `registrado_em`, o relógio do banco depois da trava; desempate pelo id). */
export async function ultimaDecisao(tx: Tx, patientId: string): Promise<EventoDeDecisao | null> {
  const [u] = await tx
    .select({ id: iaAutorizacoes.id, evento: iaAutorizacoes.evento, versao: iaAutorizacoes.versao, usos: iaAutorizacoes.usos, destino: iaAutorizacoes.destino, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm })
    .from(iaAutorizacoes)
    .where(and(eq(iaAutorizacoes.patientId, patientId), inArray(iaAutorizacoes.evento, ['autorizou', 'retirou'])))
    .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id))
    .limit(1);
  return u ?? null;
}

/** Dentro de withTenant. Quem decide algo com ela trava o paciente ANTES (a retirada trava o paciente FOR UPDATE). */
export async function autorizacaoDoPaciente(tx: Tx, patientId: string, destino: DestinoIA | null): Promise<SituacaoAutorizacao> {
  return situacaoDaAutorizacao(await ultimaDecisao(tx, patientId), destino);
}

/** A última `retirou` do paciente (por `registrado_em`, o relógio do banco depois da trava; desempate pelo id). */
export async function ultimaRetirada(tx: Tx, patientId: string): Promise<Pick<EventoDeDecisao, 'id' | 'canal' | 'em' | 'registradoEm'> | null> {
  const [r] = await tx
    .select({ id: iaAutorizacoes.id, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm })
    .from(iaAutorizacoes)
    .where(and(eq(iaAutorizacoes.patientId, patientId), eq(iaAutorizacoes.evento, 'retirou')))
    .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id))
    .limit(1);
  return r ?? null;
}

/**
 * RN-108 (D14) para uma tarefa JÁ pedida: "se o paciente autorizou de novo, cancela só as tarefas criadas antes da
 * retirada" — a mesma regra do `criadasAntesDe` do job ia-retirada. A tarefa criada antes da última retirada vale como
 * retirada mesmo com a reautorização vigente: não sai (portão), não é gravada (passo 6), não é aplicada e a varredura a
 * cancela. `criado_em` e `registrado_em` vêm do relógio do banco, os dois depois da trava do paciente (pedirLeituraExame,
 * gatilho ia_autorizacoes_regras): a ordem entre eles é a ordem real.
 */
export function situacaoParaTarefa(s: SituacaoAutorizacao, retirada: Pick<EventoDeDecisao, 'id' | 'canal' | 'em' | 'registradoEm'> | null, criadoEm: Date): SituacaoAutorizacao {
  if (s.tipo === 'vigente' && retirada && criadoEm < retirada.registradoEm) return { tipo: 'retirada', id: retirada.id, em: retirada.em, canal: retirada.canal as CanalAutorizacao };
  return s;
}

/** Dentro de withTenant, com o paciente travado: a situação da autorização para uma tarefa já pedida (RN-100 + RN-108/D14). */
export async function autorizacaoDaTarefa(tx: Tx, t: { patientId: string; criadoEm: Date }, destino: DestinoIA | null): Promise<SituacaoAutorizacao> {
  return situacaoParaTarefa(await autorizacaoDoPaciente(tx, t.patientId, destino), await ultimaRetirada(tx, t.patientId), t.criadoEm);
}

/** RN-100 (parte do paciente, D8): ativo e com a autorização vigente para o uso. No app, no worker e ao aplicar. */
export function motivoDoPaciente(p: Pick<PatientRow, 'status' | 'anonimizadoEm'>, s: SituacaoAutorizacao, uso: UsoIA): MotivoFalha | null {
  if (p.status !== 'ativo' || p.anonimizadoEm) return 'paciente_indisponivel';
  return vigentePara(s, uso) ? null : 'sem_autorizacao';
}

/** Para as telas (exames, exames recebidos): a situação, sem auditoria — não é dado de saúde (AUDIT_EXCEPTIONS). */
export async function situacaoIaDoPaciente(ctx: TenantContext, patientId: string, destino: DestinoIA | null, db: Db = getDb()): Promise<SituacaoAutorizacao> {
  if (!idValido(patientId)) return { tipo: 'nunca' };
  return withTenant(ctx, (tx) => autorizacaoDoPaciente(tx, patientId, destino), db);
}

/**
 * US-109 "Retirada a pedido, pela nutricionista" (RN-108): na MESMA transação, o evento `retirou` (canal `nutricionista`)
 * e o cancelamento da fila e das sugestões prontas do paciente — como o `definirRecusaIa` do Plano 11. Ordem de travas da
 * cota: paciente (carregarPacienteParaEscrita) → tenant (cancelarTarefas) → tarefas → ia_uso → plataforma. Funciona com a
 * IA bloqueada pela admin, desativada ou em emergência (a retirada é sempre possível, US-105). Sem nada a retirar → false.
 */
export async function registrarRetiradaPelaNutri(ctx: TenantContext, patientId: string, deps: { db?: Db; agora?: Date } = {}): Promise<boolean> {
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const s = await autorizacaoDoPaciente(tx, p.id, null);
      if (s.tipo === 'nunca' || s.tipo === 'retirada') return false;
      await tx.insert(iaAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'retirou', canal: 'nutricionista', registradoPor: ctx.actorUserId! });
      await cancelarTarefas(tx, { tenantId: ctx.tenantId, patientId: p.id, agora, por: ctx.actorUserId ?? null });
      return true;
    },
    deps.db ?? getDb(),
  );
}

/** Erros com o texto pronto para a tela, por campo (`geral`, `arquivo`, `data`, `confirmacao`). */
export class AutorizacaoError extends Error {
  override name = 'AutorizacaoError';
  constructor(readonly erros: Record<string, string>) {
    super(Object.values(erros)[0] ?? 'autorização de IA recusada');
  }
}

export type DepsAutorizacao = {
  ia: ConfigIA;
  appUrl: string;
  db?: Db;
  agora?: Date;
  boss?: PgBoss;
  dataDir?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Só nos testes (RNF-111 f): falha depois de gravar a linha do termo, dentro da transação do arquivo. */
  depoisDaLinha?: (tx: Tx) => Promise<unknown>;
};
const userAgent = (s: string | null | undefined) => (s ? s.slice(0, 300) : null);

/** D10: pedir e decidir só com a IA ativa no consultório (a retenção zero não é exigida aqui) e com o perfil completo (desvio 7). */
function destinoParaPedir(t: TenantRow | undefined, ia: ConfigIA): DestinoIA {
  if (!t || estadoIaDoTenant(t, ia.modo) !== 'ativa' || !ia.destino) throw new AutorizacaoError({ geral: MSG_IA.indisponivel });
  if (!responsavelDoTenant(t)) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.perfilIncompleto });
  return ia.destino;
}

/**
 * US-107 / US-108 / US-106: o e-mail "Você autorizou o uso de inteligência artificial" com o link de RETIRADA (D11), na
 * transação da autorização (o job vai cifrado). Sem e-mail no cadastro, nada (o papel sem e-mail tem a forma de retirar própria).
 */
export async function enfileirarConfirmacao(
  tx: Tx,
  o: { tenantId: string; patientId: string; autorizacaoId: string; para: string | null; consultorio: string; destino: DestinoIA; appUrl: string },
): Promise<void> {
  if (!o.para) return;
  const link = urlDoLinkAutorizacao(o.appUrl, assinarLinkRetirada({ tenantId: o.tenantId, patientId: o.patientId, autorizacaoId: o.autorizacaoId }));
  await enqueueEmail({ tipo: 'autorizacao_ia_confirmada', para: o.para, consultorio: o.consultorio, destino: DESTINO_ROTULO[o.destino], versao: AUTORIZACAO_IA_VERSAO, link }, { tenantId: o.tenantId, tx });
}

/** A sessão de paciente sem conta (o link) já é recusada pelo assertContext com ator (tenant.ts): basta exigir o ator. */
const sessaoDePacienteComConta = (ctx: TenantContext) => ctx.role === 'paciente' && !!ctx.patientId && !!ctx.actorUserId;

/**
 * US-106 "Autorizo o envio para fora do Brasil" no app: sessão de paciente com conta; o paciente travado (FOR UPDATE,
 * PACIENTE_ESCREVE.patients) antes de ler a situação e gravar — a política paciente_autorizacao_propria confere a conta.
 * Já vigente (clique duplo, outra aba) → nada novo. `exibido` é o texto que a tela mostrou (`textoExibido(destino)`:
 * versão, usos e destino, vindos do cliente): diferente do de agora (deploy entre a leitura e o toque) → "O texto da
 * autorização mudou. Leia e decida de novo." e nada gravado (RN-107, revisão da T6).
 */
export async function autorizarNoApp(ctx: TenantContext, exibido: unknown, deps: DepsAutorizacao): Promise<'registrada' | 'ja_vigente'> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('autorizarNoApp: só a sessão de paciente com conta');
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, ctx.patientId!)).for('update');
      if (!p || p.status !== 'ativo' || p.anonimizadoEm) throw new AutorizacaoError({ geral: MSG_IA.indisponivel });
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      const destino = destinoParaPedir(t, deps.ia);
      if (!conferirTextoExibido(exibido, destino)) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.textoMudou });
      if ((await autorizacaoDoPaciente(tx, p.id, destino)).tipo === 'vigente') return 'ja_vigente';
      const [a] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: [...AUTORIZACAO_IA_USOS], destino, canal: 'app', registradoPor: ctx.actorUserId!, ip: deps.ip ?? null, userAgent: userAgent(deps.userAgent) })
        .returning({ id: iaAutorizacoes.id });
      await enfileirarConfirmacao(tx, { tenantId: ctx.tenantId, patientId: p.id, autorizacaoId: a.id, para: p.email, consultorio: t!.nomeExibicao, destino, appUrl: deps.appUrl });
      return 'registrada';
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-109 "Retirar autorização" no app (RN-108): o evento `retirou` (canal app) e o job `ia-retirada` NA MESMA transação
 * (`boss.send` com a transação, como enqueueEmail) — a sessão de paciente não alcança ia_tarefas. Funciona com a IA
 * desativada, bloqueada ou em emergência ("Retirar sempre possível"). Sem autorização a retirar → nada.
 */
export async function retirarNoApp(ctx: TenantContext, deps: Pick<DepsAutorizacao, 'db' | 'boss' | 'ip' | 'userAgent'>): Promise<'retirada' | 'nada_a_retirar'> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('retirarNoApp: só a sessão de paciente com conta');
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, ctx.patientId!)).for('update');
      if (!p) return 'nada_a_retirar';
      const s = await autorizacaoDoPaciente(tx, p.id, null);
      if (s.tipo === 'nunca' || s.tipo === 'retirada') return 'nada_a_retirar';
      const [r] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'retirou', canal: 'app', registradoPor: ctx.actorUserId!, ip: deps.ip ?? null, userAgent: userAgent(deps.userAgent) })
        .returning({ id: iaAutorizacoes.id });
      const job = await boss.send('ia-retirada', { tenantId: ctx.tenantId, patientId: p.id, retiradaId: r.id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a retirada da autorização de IA');
      return 'retirada';
    },
    deps.db ?? getDb(),
  );
}

/** D13: o pedido aberto é o último `pedido_email` com menos de 7 dias e para o e-mail ATUAL (mesmo HMAC). */
function fimDoPedidoAberto(ultimo: { registradoEm: Date; emailHmac: string | null } | undefined, hmacAtual: string | null): Date | null {
  return ultimo && hmacAtual && ultimo.emailHmac === hmacAtual ? new Date(ultimo.registradoEm.getTime() + VALIDADE_PEDIDO_MS) : null;
}

/**
 * US-105 "Enviar pedido de autorização por e-mail": o evento `pedido_email` (canal link, quem pediu, HMAC do e-mail) e o
 * e-mail com o link de 7 dias (US-107), na mesma transação, com o paciente travado (dois cliques se enfileiram). Um pedido
 * aberto por vez (D13). Paciente bloqueado → PacienteBloqueadoError; arquivado → indisponível; sem e-mail → o texto da US-105.
 */
export async function enviarPedidoPorEmail(ctx: TenantContext, patientId: string, deps: DepsAutorizacao): Promise<{ validoAte: Date }> {
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.status !== 'ativo') throw new AutorizacaoError({ geral: MSG_FALHA.paciente_indisponivel });
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      destinoParaPedir(t, deps.ia);
      if (!p.email) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.semEmail });
      const hmac = emailHmac(p.email);
      const [ultimo] = await tx
        .select({ registradoEm: iaAutorizacoes.registradoEm, emailHmac: iaAutorizacoes.emailHmac })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.patientId, p.id), eq(iaAutorizacoes.evento, 'pedido_email')))
        .orderBy(desc(iaAutorizacoes.registradoEm))
        .limit(1);
      const aberto = fimDoPedidoAberto(ultimo, hmac);
      if (aberto && aberto > agora) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.pedidoAberto(formatarDataNoFuso(aberto, t!.fuso)) });
      await tx.insert(iaAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'pedido_email', versao: AUTORIZACAO_IA_VERSAO, canal: 'link', registradoPor: ctx.actorUserId!, emailHmac: hmac });
      const token = assinarLinkPedido({ tenantId: ctx.tenantId, patientId: p.id, emitidoEm: agora, email: p.email });
      await enqueueEmail({ tipo: 'autorizacao_ia', para: p.email, consultorio: t!.nomeExibicao, link: urlDoLinkAutorizacao(deps.appUrl, token) }, { tenantId: ctx.tenantId, tx });
      return { validoAte: new Date(agora.getTime() + VALIDADE_PEDIDO_MS) };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-108 "Guardar o termo assinado" (RN-107, regra 9): o arquivo pelo salvarArquivo (tipo ia_autorizacao_termo, do paciente,
 * conta na cota), com o paciente travado no `antesDaReserva` e a linha `autorizou` (canal papel, em = início do dia
 * informado, D16) no `registrar` — ordem paciente → tenant → linha; tudo ou nada (RNF-111 f). Recusa o termo com uma
 * retirada no dia da assinatura ou depois (desvio 12). Com e-mail, a confirmação
 * com o link de retirada. Devolve o id da autorização.
 */
export async function registrarTermoEmPapel(
  ctx: TenantContext,
  patientId: string,
  input: { data: unknown; confirmacao: boolean; arquivo: Buffer | null },
  deps: DepsAutorizacao,
): Promise<string> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
  const erros: Record<string, string> = {};
  if (!input.arquivo?.length) erros.arquivo = MSG_AUTORIZACAO.faltouArquivo;
  else if (input.arquivo.length > TERMO_MAX_BYTES) erros.arquivo = MSG_AUTORIZACAO.arquivoInvalido;
  if (!input.confirmacao) erros.confirmacao = MSG_AUTORIZACAO.faltouConfirmacao;
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!t || !dataValida(data) || data > hojeNoFuso(t.fuso, agora) || data < AUTORIZACAO_IA_VERSAO_DATA) erros.data = MSG_AUTORIZACAO.dataInvalida;
  if (Object.keys(erros).length) throw new AutorizacaoError(erros);
  const destino = destinoParaPedir(t, deps.ia);
  let id = '';
  let email: string | null = null;
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'ia_autorizacao_termo',
        conteudo: input.arquivo!,
        permitidos: ['pdf', 'jpg', 'png'],
        patientId,
        antesDaReserva: async (tx) => {
          const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
          if (p.status !== 'ativo') throw new AutorizacaoError({ geral: MSG_FALHA.paciente_indisponivel });
          // Desvio 12: a decisão mais recente é a de registrado_em (D7), e o termo nasce com o registrado_em do upload. Um
          // termo assinado antes de uma retirada (ou no mesmo dia: critério conservador, a favor do titular) desfaria a
          // retirada; com o paciente travado, nenhuma retirada nova entra entre esta leitura e a linha.
          const r = await ultimaRetirada(tx, patientId);
          if (r && r.em >= inicioDoDia(data, t!.fuso)) throw new AutorizacaoError({ data: MSG_AUTORIZACAO.retiradaDepoisDaData });
          email = p.email;
        },
        registrar: async (tx, a) => {
          const [r] = await tx
            .insert(iaAutorizacoes)
            .values({ tenantId: ctx.tenantId, patientId, evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: [...AUTORIZACAO_IA_USOS], destino, canal: 'papel', em: inicioDoDia(data, t!.fuso), registradoPor: ctx.actorUserId!, arquivoPath: a.caminho })
            .returning({ id: iaAutorizacoes.id });
          id = r.id;
          await deps.depoisDaLinha?.(tx);
          await enfileirarConfirmacao(tx, { tenantId: ctx.tenantId, patientId, autorizacaoId: r.id, para: email, consultorio: t!.nomeExibicao, destino, appUrl: deps.appUrl });
        },
      },
      { db, dataDir: deps.dataDir },
    );
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new AutorizacaoError({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    if (e instanceof CotaEsgotadaError) throw new AutorizacaoError({ geral: MSG_COTA_ESGOTADA });
    throw e;
  }
  return id;
}

/** US-108 "Ver termo assinado": o caminho do arquivo (a rota assina a URL de 5 min), com auditRead (entidade ia_autorizacao, RN-107). */
export async function caminhoDoTermo(ctx: TenantContext, patientId: string, autorizacaoId: string, db: Db = getDb()): Promise<string | null> {
  if (!idValido(patientId) || !idValido(autorizacaoId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx
        .select({ caminho: iaAutorizacoes.arquivoPath })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.id, autorizacaoId), eq(iaAutorizacoes.patientId, patientId), eq(iaAutorizacoes.canal, 'papel')));
      if (!a?.caminho) return null;
      await auditRead(tx, { entidade: 'ia_autorizacao', entidadeId: autorizacaoId, patientId });
      return a.caminho;
    },
    db,
  );
}

export type EventoNaTela = { id: string; evento: EventoAutorizacao; canal: CanalAutorizacao; versao: string | null; destino: DestinoIA | null; em: Date; temTermo: boolean };
export type PainelAutorizacao = { situacao: SituacaoAutorizacao; eventos: EventoNaTela[]; pedidoAbertoAte: Date | null; alertaEmailTrocado: boolean; codigoDeReferencia: string; temRegistro: boolean };

/**
 * US-105: os dados da seção "Uso de IA" (sem auditoria: não é dado de saúde, AUDIT_EXCEPTIONS). Eventos do mais recente ao
 * mais antigo; o pedido aberto (D13); o alerta "e-mail mudou pouco antes" — a autorização vigente pelo link com o HMAC
 * diferente do de algum pedido dos 30 dias anteriores (adaptação da §18.4); o código de referência do termo impresso.
 */
export async function painelDaAutorizacao(ctx: TenantContext, paciente: Pick<PatientRow, 'id' | 'email'>, destino: DestinoIA | null, o: { db?: Db; agora?: Date } = {}): Promise<PainelAutorizacao> {
  const agora = o.agora ?? new Date();
  const linhas = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: iaAutorizacoes.id, evento: iaAutorizacoes.evento, versao: iaAutorizacoes.versao, usos: iaAutorizacoes.usos, destino: iaAutorizacoes.destino, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm, emailHmac: iaAutorizacoes.emailHmac, arquivoPath: iaAutorizacoes.arquivoPath })
        .from(iaAutorizacoes)
        .where(eq(iaAutorizacoes.patientId, paciente.id))
        .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id)),
    o.db ?? getDb(),
  );
  const decisao = linhas.find((l) => l.evento !== 'pedido_email') ?? null;
  const situacao = situacaoDaAutorizacao(decisao, destino);
  const fim = fimDoPedidoAberto(linhas.find((l) => l.evento === 'pedido_email'), paciente.email ? emailHmac(paciente.email) : null);
  const alertaEmailTrocado =
    situacao.tipo === 'vigente' && decisao!.canal === 'link' &&
    linhas.some((l) => l.evento === 'pedido_email' && l.registradoEm < decisao!.registradoEm && l.registradoEm.getTime() >= decisao!.registradoEm.getTime() - JANELA_EMAIL_TROCADO_MS && l.emailHmac !== decisao!.emailHmac);
  return {
    situacao,
    eventos: linhas.map((l) => ({ id: l.id, evento: l.evento as EventoAutorizacao, canal: l.canal as CanalAutorizacao, versao: l.versao, destino: l.destino as DestinoIA | null, em: l.em, temTermo: !!l.arquivoPath })),
    pedidoAbertoAte: fim && fim > agora ? fim : null,
    alertaEmailTrocado,
    codigoDeReferencia: codigoDeReferencia(ctx.tenantId, paciente.id, AUTORIZACAO_IA_VERSAO),
    temRegistro: linhas.length > 0,
  };
}

/** US-105 "Quando a seção aparece": com IA_PROVEDOR, se a admin liberou, se o consultório já ativou alguma vez, ou com registro do paciente. */
export function secaoIaVisivel(modo: ModoIA, tenant: Pick<TenantRow, 'iaLiberada' | 'iaAditivoVersao'>, temRegistro: boolean): boolean {
  if (modo === 'ausente') return false;
  return tenant.iaLiberada || tenant.iaAditivoVersao !== null || temRegistro;
}

export type BlocoIaApp = { situacao: SituacaoAutorizacao; podeDecidir: boolean };

/**
 * US-106 (desvio 8): o bloco em Eu › Privacidade — some sem IA_PROVEDOR; aparece com a IA ativa no consultório (e o perfil
 * completo, D10) ou com algum registro do paciente; "Ler e decidir" só com a IA ativa. A situação é a do vínculo aberto
 * (o ctx do paciente é o do consultório escolhido, US-106 "Mais de um consultório").
 */
export async function blocoIaDoApp(ctx: TenantContext, tenant: TenantRow, ia: ConfigIA, db: Db = getDb()): Promise<BlocoIaApp | null> {
  if (ia.modo === 'ausente' || !ctx.patientId) return null;
  const podeDecidir = estadoIaDoTenant(tenant, ia.modo) === 'ativa' && !!ia.destino && !!responsavelDoTenant(tenant);
  const { situacao, temRegistro } = await withTenant(
    ctx,
    async (tx) => {
      const ultimo = await ultimaDecisao(tx, ctx.patientId!);
      const [algum] = ultimo ? [ultimo] : await tx.select({ id: iaAutorizacoes.id }).from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, ctx.patientId!)).limit(1);
      return { situacao: situacaoDaAutorizacao(ultimo, ia.destino), temRegistro: !!algum };
    },
    db,
  );
  if (!podeDecidir && !temRegistro) return null;
  return { situacao, podeDecidir };
}
