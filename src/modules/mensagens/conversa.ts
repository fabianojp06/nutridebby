/**
 * Plano 25 (US-440, US-450; RN-441, RN-442, RN-447, RN-453, RN-465, RN-475; CH-D39): a conversa da nutricionista com o
 * paciente — liberar (com o registro do TCLE de telenutrição), pausar, retomar e o estado que as telas mostram. O gatilho
 * chat_conversas_regras (0133) é a rede: liberação, pausa e retomada só pela sessão `nutri`, em nome da usuária, de titular
 * ativo e com o carimbo do consultório. O módulo confere antes e devolve os códigos da interface.
 *
 * Auditoria (RN-453, CH-D39): o gatilho da linha grava a entidade neutra `chat_conversa` (fora da tela: o recado também
 * cria conversas, e a pausa é um UPDATE como a liberação de uma conversa nascida de recado); o ato vai por recordAudit
 * (`chat_liberacao`, `chat_pausa`, `chat_retomada`), na mesma transação.
 *
 * Travas (RN-447): paciente → conversa → mensagem. Liberar trava o paciente FOR SHARE (o gatilho lê a situação do titular
 * sem trava e correria com um arquivar concorrente); pausar e retomar o travam FOR UPDATE (o envio do paciente também, e a
 * pausa não pode passar por um envio que já viu a conversa aberta) e só então a conversa, FOR NO KEY UPDATE.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { chatConversas, chatMensagens, FORMAS_TCLE, patients, tenants, type FormaTcle, type LadoLeitura, type RiscoChat, type StatusAnexo, type TipoAnexo } from '@/db/schema';
import { sessaoDePacienteComConta, withTenant, type TenantContext } from '@/db/tenant';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { auditRead, recordAudit } from '@/modules/plataforma/audit';
import { MENSAGENS_POR_PAGINA } from './constantes';
import { dentroDoHorario, horarioParaPaciente, resumoDoHorario, type Faixa } from './horario';
import { exigirNutri, exigirPacienteComConta } from './sessao';

export type SituacaoDoTitular = 'ativo' | 'arquivado' | 'bloqueado' | 'anonimizado';
export type EstadoDaConversa = {
  existe: boolean;
  liberadaEm: Date | null;
  formaDoTcle: FormaTcle | null;
  pausada: boolean;
  titular: SituacaoDoTitular;
  temConta: boolean;
  carimbo: boolean;
};

type Titular = { id: string; status: string; anonimizadoEm: Date | null };
const situacaoDoTitular = (p: Titular): SituacaoDoTitular => (p.anonimizadoEm ? 'anonimizado' : (p.status as SituacaoDoTitular));
const ativo = (p: Titular) => situacaoDoTitular(p) === 'ativo';

/** O titular travado (paciente → conversa, RN-447). Fora do consultório (a RLS esconde) ou id inválido → não encontrado. */
async function travarTitular(tx: Tx, patientId: string, modo: 'share' | 'update'): Promise<Titular> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const [p] = await tx
    .select({ id: patients.id, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
    .from(patients)
    .where(eq(patients.id, patientId))
    .for(modo);
  if (!p) throw new PacienteNaoEncontradoError();
  return p;
}

const daConversa = (tenantId: string, patientId: string) => and(eq(chatConversas.tenantId, tenantId), eq(chatConversas.patientId, patientId));

/** RN-475: o consultório tem nome profissional e CRN (o carimbo de cada mensagem da nutricionista). Nada lê a tabela `user`. */
async function temCarimbo(tx: Tx, tenantId: string): Promise<boolean> {
  const [t] = await tx.select({ nome: tenants.nomeProfissional, crn: tenants.crn }).from(tenants).where(eq(tenants.id, tenantId));
  return !!t?.nome && !!t.crn;
}

/**
 * O estado da conversa (liberada, forma do TCLE, pausa, titular, conta e carimbo; nenhum texto) e o id do paciente lido do
 * banco (o auditRead grava o paciente da linha lida, nunca o da URL). Paciente fora do consultório (ou de outra sessão de
 * paciente) ou id inválido → PacienteNaoEncontradoError.
 */
async function lerEstado(tx: Tx, patientId: string): Promise<{ patientId: string; nome: string; fuso: string; estado: EstadoDaConversa }> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const [r] = await tx
    .select({
      id: patients.id,
      nome: patients.nome,
      fuso: tenants.fuso,
      status: patients.status,
      anonimizadoEm: patients.anonimizadoEm,
      temConta: sql<boolean>`${patients.userId} is not null`,
      carimbo: sql<boolean>`${tenants.nomeProfissional} is not null and ${tenants.crn} is not null`,
      conversaId: chatConversas.id,
      liberadaEm: chatConversas.liberadaEm,
      tcleForma: chatConversas.tcleForma,
      pausadaEm: chatConversas.pausadaEm,
    })
    .from(patients)
    .innerJoin(tenants, eq(tenants.id, patients.tenantId))
    .leftJoin(chatConversas, and(eq(chatConversas.tenantId, patients.tenantId), eq(chatConversas.patientId, patients.id)))
    .where(eq(patients.id, patientId));
  if (!r) throw new PacienteNaoEncontradoError();
  return { patientId: r.id, nome: r.nome, fuso: r.fuso, estado: {
    existe: r.conversaId !== null,
    liberadaEm: r.liberadaEm,
    formaDoTcle: r.tcleForma as FormaTcle | null,
    pausada: r.pausadaEm !== null,
    titular: r.anonimizadoEm ? 'anonimizado' : (r.status as SituacaoDoTitular),
    temConta: r.temConta,
    carimbo: r.carimbo,
  } };
}

/**
 * US-440 e RN-441: libera a conversa com o registro do TCLE de telenutrição (`termo_assinado` ou `aceite_escrito`; sem a
 * forma verbal, CH-D3). A conversa pode já existir sem liberação (nascida de um recado): aí é um UPDATE da mesma linha.
 * Conferências, nesta ordem: titular ativo e não anonimizado (`titular_inativo`), conversa já liberada (`ja_liberada`) e o
 * carimbo do consultório (`sem_carimbo`); nada é gravado nesses casos. Duas liberações ao mesmo tempo: a segunda encontra a
 * linha já liberada no ON CONFLICT e devolve `ja_liberada`. A forma e a confirmação vêm validadas da tela; fora disso, Error.
 */
export async function liberarConversa(
  ctx: TenantContext,
  patientId: string,
  i: { forma: FormaTcle; confirmou: true },
  db: Db = getDb(),
): Promise<'ok' | 'ja_liberada' | 'titular_inativo' | 'sem_carimbo'> {
  exigirNutri(ctx);
  if (!i || !(FORMAS_TCLE as readonly unknown[]).includes(i.forma) || i.confirmou !== true) throw new Error('mensagens: forma do TCLE ou confirmação inválida');
  return withTenant(
    ctx,
    async (tx) => {
      const p = await travarTitular(tx, patientId, 'share');
      if (!ativo(p)) return 'titular_inativo';
      const [c] = await tx.select({ liberadaEm: chatConversas.liberadaEm }).from(chatConversas).where(daConversa(ctx.tenantId, p.id));
      if (c?.liberadaEm) return 'ja_liberada';
      if (!(await temCarimbo(tx, ctx.tenantId))) return 'sem_carimbo';
      // liberada_em: o gatilho grava clock_timestamp(); liberada_por: o gatilho confere = app_current_user()
      const r = await tx.execute<{ id: string }>(sql`
        insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma)
        values (${ctx.tenantId}, ${p.id}, now(), ${ctx.actorUserId}, ${i.forma})
        on conflict (tenant_id, patient_id) do update
          set liberada_em = excluded.liberada_em, liberada_por = excluded.liberada_por, tcle_forma = excluded.tcle_forma, updated_at = now()
          where chat_conversas.liberada_em is null
        returning id`);
      const id = r.rows[0]?.id;
      if (!id) return 'ja_liberada';
      await recordAudit(tx, { acao: 'criar', entidade: 'chat_liberacao', entidadeId: id, patientId: p.id });
      return 'ok';
    },
    db,
  );
}

/** O titular (FOR UPDATE) e depois a conversa (FOR NO KEY UPDATE), na ordem da RN-447. */
async function travarParaPausa(tx: Tx, ctx: TenantContext, patientId: string) {
  const p = await travarTitular(tx, patientId, 'update');
  if (!ativo(p)) return { p, c: null, inativo: true as const };
  const [c] = await tx
    .select({ id: chatConversas.id, liberadaEm: chatConversas.liberadaEm, pausadaEm: chatConversas.pausadaEm })
    .from(chatConversas)
    .where(daConversa(ctx.tenantId, p.id))
    .for('no key update');
  return { p, c: c ?? null, inativo: false as const };
}

/**
 * US-450 e RN-442: pausa a conversa — nem paciente nem nutricionista enviam mensagem individual; recados continuam. A
 * liberação não se desfaz. Titular arquivado, bloqueado ou anonimizado: a conversa é só para consulta (`titular_inativo`).
 * CH-D74: a linha guarda o nome e o CRN do momento (gatilho); sem o carimbo do consultório, `sem_carimbo`.
 */
export async function pausarConversa(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
): Promise<'ok' | 'nao_liberada' | 'ja_pausada' | 'titular_inativo' | 'sem_carimbo'> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const { p, c, inativo } = await travarParaPausa(tx, ctx, patientId);
      if (inativo) return 'titular_inativo';
      if (!c?.liberadaEm) return 'nao_liberada';
      if (c.pausadaEm) return 'ja_pausada';
      // CH-D74: a pausa grava o nome e o CRN do momento (gatilho); sem o carimbo do consultório, o gatilho recusa
      if (!(await temCarimbo(tx, ctx.tenantId))) return 'sem_carimbo';
      // pausada_em, pausada_nome e pausada_crn: o gatilho grava; pausada_por: o gatilho confere = app_current_user()
      await tx.update(chatConversas).set({ pausadaEm: sql`now()`, pausadaPor: ctx.actorUserId!, updatedAt: sql`now()` }).where(eq(chatConversas.id, c.id));
      await recordAudit(tx, { acao: 'criar', entidade: 'chat_pausa', entidadeId: c.id, patientId: p.id });
      return 'ok';
    },
    db,
  );
}

/** US-450 e RN-442: retoma a conversa pausada, sem pedir o TCLE de novo. Titular inativo: `titular_inativo`. */
export async function retomarConversa(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<'ok' | 'nao_pausada' | 'titular_inativo'> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const { p, c, inativo } = await travarParaPausa(tx, ctx, patientId);
      if (inativo) return 'titular_inativo';
      if (!c?.pausadaEm) return 'nao_pausada';
      await tx.update(chatConversas).set({ pausadaEm: null, pausadaPor: null, updatedAt: sql`now()` }).where(eq(chatConversas.id, c.id));
      await recordAudit(tx, { acao: 'criar', entidade: 'chat_retomada', entidadeId: c.id, patientId: p.id });
      return 'ok';
    },
    db,
  );
}

// ——— T3: leitura, marcador de leitura e situação (RN-446, RN-448, RN-452, RN-453; CH-D40, CH-D72) ———

export type AnexoNaTela = { tipo: TipoAnexo; status: Exclude<StatusAnexo, 'sem_anexo'>; nome: string | null; bytes: number | null };
/** Uma mensagem como as telas a mostram. Nunca o caminho do arquivo (RN-454): o download é por id, na T8. */
export type MensagemNaTela = {
  id: string;
  autor: 'nutri' | 'paciente';
  /** Painel: escrita pela usuária da sessão ("Você"); portal: escrita pelo paciente. */
  minha: boolean;
  autorNome: string | null;
  autorCrn: string | null;
  texto: string | null;
  recado: boolean;
  duvidaEm: Date | null;
  risco: RiscoChat | null;
  anexo: AnexoNaTela | null;
  criadaEm: Date;
  /**
   * RN-448 (/code-review do PR 2, I1): a própria mensagem (`minha`) que o outro lado já passou — `criada_em` até o `lida_ate`
   * do marcador dele, comparado no SQL (CH-D40, nunca um `Date` do JS). Falso nas mensagens que não são da sessão.
   */
  lida: boolean;
};
export type HorarioNoPortal = { horarioAtivo: boolean; faixas: Faixa[]; resumo: string; foraDoHorario: boolean };

/** O lado que lê → o autor das mensagens do outro lado (as que ele marca como lidas). */
const OUTRO_AUTOR: Record<LadoLeitura, 'nutri' | 'paciente'> = { consultorio: 'paciente', paciente: 'nutri' };
/** O lado que lê → o lado cujo marcador diz se as mensagens dele já foram lidas ("Lida"). */
const OUTRO_LADO: Record<LadoLeitura, LadoLeitura> = { consultorio: 'paciente', paciente: 'consultorio' };

/**
 * CH-D40 e CH-D72: avança o marcador do `lado` até a `criada_em` da mensagem `ultimaId` — lida no SQL a partir do id, com o
 * tenant, o paciente da conversa aberta e o autor do OUTRO lado (a própria mensagem nunca move o marcador, e a mensagem de
 * outra conversa também não: nada é gravado). Nunca volta (`greatest`; o gatilho também segura) e nunca passa do relógio do
 * banco (gatilho). Chamar na transação da leitura, depois do auditRead.
 */
export async function marcarLida(tx: Tx, lado: LadoLeitura, patientId: string, ultimaId: string): Promise<void> {
  if (!idValido(patientId) || !idValido(ultimaId)) return;
  await tx.execute(sql`
    insert into chat_leituras (tenant_id, patient_id, lado, lida_ate, updated_at)
    select m.tenant_id, m.patient_id, ${lado}, m.criada_em, now()
      from chat_mensagens m
     where m.id = ${ultimaId} and m.tenant_id = app_current_tenant() and m.patient_id = ${patientId} and m.autor = ${OUTRO_AUTOR[lado]}
    on conflict (tenant_id, patient_id, lado) do update
      set lida_ate = greatest(chat_leituras.lida_ate, excluded.lida_ate), updated_at = now()`);
}

/** A mensagem `id` desta conversa como cursor `(criada_em, id)`, resolvida no SQL; id de outra conversa → NULL (nada passa). */
const cursor = (patientId: string, id: string) =>
  sql`(select c.criada_em, c.id from chat_mensagens c where c.id = ${id} and c.tenant_id = app_current_tenant() and c.patient_id = ${patientId})`;

/**
 * As últimas 50 (ou as 50 antes de `antes`), em ordem de `(criada_em, id)`. `antes` que não é uuid → lista vazia. `lida`:
 * a `criada_em` até o `lida_ate` do outro lado (sem marcador, falso), no SQL — o "Lida" sai da ordem, não de um id que
 * precisa estar na tela (/code-review do PR 2, I1: duas nutricionistas e a página `?antes=`).
 */
async function pagina(tx: Tx, lado: LadoLeitura, patientId: string, antes: string | undefined, minha: (m: { autor: string; autorUserId: string }) => boolean) {
  if (antes !== undefined && !idValido(antes)) return { mensagens: [] as MensagemNaTela[], haAnteriores: false };
  const linhas = await tx
    .select({
      id: chatMensagens.id,
      autor: chatMensagens.autor,
      autorUserId: chatMensagens.autorUserId,
      autorNome: chatMensagens.autorNome,
      autorCrn: chatMensagens.autorCrn,
      texto: chatMensagens.texto,
      recadoId: chatMensagens.recadoId,
      duvidaEm: chatMensagens.duvidaEm,
      risco: chatMensagens.risco,
      anexoStatus: chatMensagens.anexoStatus,
      anexoTipo: chatMensagens.anexoTipo,
      anexoNome: chatMensagens.anexoNome,
      anexoBytes: chatMensagens.anexoBytes,
      criadaEm: chatMensagens.criadaEm,
      lida: sql<boolean>`coalesce(${chatMensagens.criadaEm} <= (select l.lida_ate from chat_leituras l
        where l.tenant_id = ${chatMensagens.tenantId} and l.patient_id = ${chatMensagens.patientId} and l.lado = ${OUTRO_LADO[lado]}), false)`,
    })
    .from(chatMensagens)
    .where(
      and(
        sql`${chatMensagens.tenantId} = app_current_tenant()`,
        eq(chatMensagens.patientId, patientId),
        antes === undefined ? undefined : sql`(${chatMensagens.criadaEm}, ${chatMensagens.id}) < ${cursor(patientId, antes)}`,
      ),
    )
    .orderBy(sql`${chatMensagens.criadaEm} desc, ${chatMensagens.id} desc`)
    .limit(MENSAGENS_POR_PAGINA + 1);
  const haAnteriores = linhas.length > MENSAGENS_POR_PAGINA;
  const mensagens = linhas
    .slice(0, MENSAGENS_POR_PAGINA)
    .reverse()
    .map(
      (m): MensagemNaTela => ({
        id: m.id,
        autor: m.autor as MensagemNaTela['autor'],
        minha: minha(m),
        autorNome: m.autorNome,
        autorCrn: m.autorCrn,
        texto: m.texto,
        recado: m.recadoId !== null,
        duvidaEm: m.duvidaEm,
        risco: m.risco as RiscoChat | null,
        anexo:
          m.anexoStatus === 'sem_anexo'
            ? null
            : { tipo: m.anexoTipo as TipoAnexo, status: m.anexoStatus as AnexoNaTela['status'], nome: m.anexoNome, bytes: m.anexoBytes },
        criadaEm: m.criadaEm,
        lida: minha(m) && m.lida === true,
      }),
    );
  return { mensagens, haAnteriores };
}

/** "Lida" no render (RN-448): a última mensagem da sessão, entre as da tela, que o outro lado já passou (`lida`, no SQL). */
const ultimaLidaNaTela = (mensagens: readonly MensagemNaTela[]): string | null => mensagens.findLast((m) => m.minha && m.lida)?.id ?? null;

/**
 * Leitura auditada (uma por render) e, depois, o marcador até a última mensagem do outro lado que a tela carregou. Titular
 * anonimizado: a conversa já não existe (a anonimização a apaga), e não há leitura a registrar — nem auditRead, nem marcador.
 */
async function registrarLeitura(tx: Tx, lado: LadoLeitura, estado: EstadoDaConversa, patientId: string, mensagens: MensagemNaTela[]) {
  if (estado.titular === 'anonimizado') return;
  await auditRead(tx, { entidade: 'chat', entidadeId: null, patientId });
  const ultimaDoOutro = mensagens.findLast((m) => m.autor === OUTRO_AUTOR[lado]);
  if (ultimaDoOutro) await marcarLida(tx, lado, patientId, ultimaDoOutro.id);
}

/**
 * US-441 (painel): a conversa com o paciente — o estado, as últimas 50 mensagens (ou as 50 antes de `antes`, um id resolvido
 * no SQL; id de outra conversa → lista vazia) e o "Lida". Lê com auditRead (entidade `chat`, o paciente da linha lida) e
 * avança o marcador do consultório até a última mensagem do paciente carregada (CH-D72). Paciente fora do consultório →
 * PacienteNaoEncontradoError. `nome`: o nome de registro (Plano 18 D7), para o h1 da tela (T6b).
 */
export async function conversaNoPainel(
  ctx: TenantContext,
  patientId: string,
  o: { antes?: string },
  db: Db = getDb(),
): Promise<{ nome: string; estado: EstadoDaConversa; mensagens: MensagemNaTela[]; haAnteriores: boolean; ultimaLida: string | null }> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const lido = await lerEstado(tx, patientId);
      const { mensagens, haAnteriores } = await pagina(tx, 'consultorio', lido.patientId, o.antes, (m) => m.autor === 'nutri' && m.autorUserId === ctx.actorUserId);
      await registrarLeitura(tx, 'consultorio', lido.estado, lido.patientId, mensagens);
      return { nome: lido.nome, estado: lido.estado, mensagens, haAnteriores, ultimaLida: ultimaLidaNaTela(mensagens) };
    },
    db,
  );
}

/**
 * US-443 (portal): a conversa do paciente da sessão — o estado, o horário (sem nada do aviso à nutricionista, CH-D70), as
 * mensagens (inclusive as cópias de recado, mesmo sem a conversa liberada) e o "Lida". Lê com auditRead e avança o marcador
 * do paciente até a última mensagem da nutricionista carregada (CH-D72). Só a sessão de paciente com conta (RN-440).
 * `temRecado`: há cópia de recado na conversa (a tela, sem a conversa liberada e sem recado, volta para Hoje — a regra do
 * link da faixa, `mensagensNaFaixa`).
 */
export async function minhaConversa(
  ctx: TenantContext,
  o: { antes?: string },
  db: Db = getDb(),
): Promise<{ estado: EstadoDaConversa; horario: HorarioNoPortal; mensagens: MensagemNaTela[]; haAnteriores: boolean; ultimaLida: string | null; temRecado: boolean }> {
  exigirPacienteComConta(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const lido = await lerEstado(tx, ctx.patientId!);
      const h = await horarioParaPaciente(tx);
      const horario: HorarioNoPortal = {
        horarioAtivo: h.horarioAtivo,
        faixas: h.faixas,
        resumo: resumoDoHorario(h.faixas),
        foraDoHorario: h.horarioAtivo && h.faixas.length > 0 && !dentroDoHorario(h.faixas, lido.fuso, new Date()),
      };
      const { mensagens, haAnteriores } = await pagina(tx, 'paciente', lido.patientId, o.antes, (m) => m.autor === 'paciente');
      await registrarLeitura(tx, 'paciente', lido.estado, lido.patientId, mensagens);
      // a regra do link da faixa (`mensagensNaFaixa`): sem a conversa liberada e sem recado, a tela não tem o que mostrar
      const rec = await tx.execute<{ tem: boolean }>(sql`
        select exists (select 1 from chat_mensagens r
                        where r.tenant_id = app_current_tenant() and r.patient_id = ${lido.patientId} and r.recado_id is not null) as tem`);
      return { estado: lido.estado, horario, mensagens, haAnteriores, ultimaLida: ultimaLidaNaTela(mensagens), temRecado: rec.rows[0]?.tem === true };
    },
    db,
  );
}

/**
 * "Lida" da consulta (RN-448; /code-review do PR 2, I1): a última mensagem DA SESSÃO (no painel, da própria usuária — com
 * duas nutricionistas, a da outra não conta; no portal, do paciente) até `depois` (a última da tela, resolvida no SQL) que
 * o outro lado já passou pelo marcador dele. Sempre uma mensagem da tela ou anterior a ela: o cliente fica com a mais
 * adiante entre esta e a do render (`lidaMaisAdiante`), sem remontar nada. Tela vazia (`depois` nulo) → nenhuma.
 */
async function ultimaLidaAte(tx: Tx, ctx: TenantContext, lado: LadoLeitura, patientId: string, depois: string | null): Promise<string | null> {
  if (depois === null) return null;
  const r = await tx.execute<{ id: string }>(sql`
    select m.id from chat_mensagens m
      join chat_leituras l on l.tenant_id = m.tenant_id and l.patient_id = m.patient_id and l.lado = ${OUTRO_LADO[lado]}
     where m.tenant_id = app_current_tenant() and m.patient_id = ${patientId} and m.autor = ${OUTRO_AUTOR[OUTRO_LADO[lado]]}
       ${lado === 'consultorio' ? sql`and m.autor_user_id = ${ctx.actorUserId}` : sql``}
       and m.criada_em <= l.lida_ate
       and (m.criada_em, m.id) <= ${cursor(patientId, depois)}
     order by m.criada_em desc, m.id desc
     limit 1`);
  return r.rows[0]?.id ?? null;
}

/**
 * RN-452 ("há novas?"): quantas mensagens do outro lado vieram depois de `depois` (o id da última mostrada, resolvido no SQL
 * com o tenant e o paciente; id de outra conversa ou que não é uuid → 0; `null` = a tela estava vazia) e o "Lida"
 * (`ultimaLidaAte`). Sem auditRead, sem texto, sem mexer no marcador. Painel: sessão `nutri` com `patientId`; portal: o
 * paciente vem da sessão (o `patientId` recebido é ignorado).
 */
export async function situacao(ctx: TenantContext, o: { patientId?: string; depois: string | null }, db: Db = getDb()): Promise<{ novas: number; ultimaLida: string | null }> {
  const lado: LadoLeitura | null = ctx.role === 'nutri' ? 'consultorio' : sessaoDePacienteComConta(ctx) ? 'paciente' : null;
  if (!lado) throw new Error('mensagens: só a sessão nutri ou de paciente com conta');
  const patientId = lado === 'paciente' ? ctx.patientId! : o.patientId;
  if (!idValido(patientId) || (o.depois !== null && !idValido(o.depois))) return { novas: 0, ultimaLida: null };
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from chat_mensagens m
         where m.tenant_id = app_current_tenant() and m.patient_id = ${patientId} and m.autor = ${OUTRO_AUTOR[lado]}
           ${o.depois === null ? sql`` : sql`and (m.criada_em, m.id) > ${cursor(patientId, o.depois)}`}`);
      return { novas: r.rows[0].n, ultimaLida: await ultimaLidaAte(tx, ctx, lado, patientId, o.depois) };
    },
    db,
  );
}

/**
 * Plano 25, T7 (§4.1 "Portal", RN-463, RN-473, US-443): o link "Mensagens" da faixa do portal. `null` = sem link (o paciente
 * não tem conversa liberada nem recado); senão, quantas mensagens da nutricionista (as cópias de recado também) vieram depois
 * do marcador do paciente — o "{n}" de "Mensagens ({n})". Só contagem: sem auditRead, sem texto, sem mexer no marcador (o
 * "lido" só anda quando a conversa abre, CH-D72). Sessão que não é de paciente com conta → `null`, sem abrir transação (a
 * faixa aparece em toda seção; a recusa do banco, `paciente_com_conta`, fica como rede).
 */
export async function mensagensNaFaixa(ctx: TenantContext, db: Db = getDb()): Promise<number | null> {
  if (!sessaoDePacienteComConta(ctx)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      // o marcador do paciente (sem marcador, `-infinity`) atrás da cerca `offset 0`, como o da caixa (caixa.ts,
      // MARCADOR_DO_CONSULTORIO): `criada_em > lida.ate` entra no índice (tenant_id, patient_id, criada_em, id) em vez de
      // ler a conversa toda (revisão final do PR 2)
      const r = await tx.execute<{ n: number }>(sql`
        select (select count(*)::int from chat_mensagens m
                 where m.tenant_id = c.tenant_id and m.patient_id = c.patient_id and m.autor = 'nutri'
                   and m.criada_em > lida.ate) as n
          from chat_conversas c
          cross join lateral (
            select coalesce((select l.lida_ate from chat_leituras l
                              where l.tenant_id = c.tenant_id and l.patient_id = c.patient_id and l.lado = 'paciente'),
                            '-infinity'::timestamptz) as ate
            offset 0) lida
         where c.tenant_id = app_current_tenant() and c.patient_id = ${ctx.patientId}
           and (c.liberada_em is not null
                or exists (select 1 from chat_mensagens r where r.tenant_id = c.tenant_id and r.patient_id = c.patient_id and r.recado_id is not null))`);
      return r.rows[0]?.n ?? null;
    },
    db,
  );
}
