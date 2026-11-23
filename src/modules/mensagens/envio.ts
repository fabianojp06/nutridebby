/**
 * Plano 25 (US-441, US-443; RN-443, RN-444, RN-447, RN-449, RN-458, RN-475; CH-D70, CH-D72): o envio de mensagem de texto
 * pelos dois lados (o anexo entra na T8, os avisos na T4). O gatilho chat_mensagens_regras e a política paciente_chat_envio
 * (0128) são a rede; o módulo confere antes e devolve os erros da tela (§6.2), sem gravar nada.
 *
 * Travas (RN-447): envio do paciente → paciente FOR UPDATE (a trava das ações do paciente: serializa com a pausa e com os
 * outros envios dele); envio da nutricionista → paciente FOR SHARE e conversa FOR NO KEY UPDATE (serializa com a pausa e
 * com outra nutricionista, sem segurar o FOR KEY SHARE que o INSERT do paciente e o marcador de leitura tomam pela FK).
 */
import { sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { chatConversas, chatMensagens, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { detectarRisco } from '@/modules/ia/nutri-paciente/sinais-risco';
import { emHorarioSilencioso } from '@/modules/notificacoes/agendar';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { LIMITE_MENSAGENS_DIA, LIMITE_MENSAGENS_HORA, MSG_MENSAGENS, MSG_PORTAL_MENSAGENS, RISCO_DO_TEXTO_FIXO, TEXTO_MAX, type CodigoTextoFixo } from './constantes';
import { dentroDoHorario, horarioParaPaciente, type Faixa } from './horario';
import { exigirNutri, exigirPacienteComConta } from './sessao';

export type CodigoErroDeEnvio = 'vazio' | 'longo' | 'conversa' | 'carimbo' | 'muitas';
/**
 * O erro com o texto exato da §6.2 do lado que enviou (painel ou portal). `textoFixo` só no `muitas` do paciente com sinal
 * de risco no texto recusado (revisão da T3, M8): a mensagem não é gravada, mas a tela mostra o socorro (RN-449).
 */
export type ErroDeEnvio = { erro: CodigoErroDeEnvio; mensagem: string; textoFixo?: CodigoTextoFixo };

const ERROS_PAINEL: Record<Exclude<CodigoErroDeEnvio, 'muitas'>, string> = {
  vazio: MSG_MENSAGENS.erros.semConteudo,
  longo: MSG_MENSAGENS.erros.textoLongo,
  conversa: MSG_MENSAGENS.erros.conversaFechada,
  carimbo: MSG_MENSAGENS.erros.semCarimbo,
};
const ERROS_PORTAL: Record<Exclude<CodigoErroDeEnvio, 'carimbo'>, string> = {
  vazio: MSG_PORTAL_MENSAGENS.erros.semConteudo,
  longo: MSG_PORTAL_MENSAGENS.erros.textoLongo,
  conversa: MSG_PORTAL_MENSAGENS.erros.pausadaNoEnvio,
  muitas: MSG_PORTAL_MENSAGENS.erros.muitas,
};
const erroPainel = (erro: keyof typeof ERROS_PAINEL): ErroDeEnvio => ({ erro, mensagem: ERROS_PAINEL[erro] });
const erroPortal = (erro: keyof typeof ERROS_PORTAL): ErroDeEnvio => ({ erro, mensagem: ERROS_PORTAL[erro] });

/**
 * RN-444: o texto sem espaços nas pontas, de 1 a 2.000 caracteres contados como o Postgres conta (pontos de código, como o
 * CHECK chat_mensagens_texto_tamanho). O NUL sai (o Postgres não guarda NUL em `text`: 22021).
 */
function textoDoEnvio(texto: unknown): string | 'vazio' | 'longo' {
  const t = typeof texto === 'string' ? texto.replaceAll('\u0000', '').trim() : '';
  if (!t) return 'vazio';
  return [...t].length > TEXTO_MAX ? 'longo' : t;
}

type Titular = { id: string; status: string; anonimizadoEm: Date | null };
async function travarTitular(tx: Tx, patientId: string, modo: 'share' | 'update'): Promise<Titular | undefined> {
  const [p] = await tx
    .select({ id: patients.id, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
    .from(patients)
    .where(sql`${patients.id} = ${patientId}`)
    .for(modo);
  return p;
}
const ativo = (p: Titular) => p.status === 'ativo' && !p.anonimizadoEm;

/**
 * US-441: a nutricionista envia texto ao paciente. Conferências (nada gravado em nenhuma): texto, titular ativo e conversa
 * liberada e não pausada (`conversa`), carimbo do consultório (`carimbo`, RN-475). O carimbo vai para a linha pelo gatilho.
 * Paciente fora do consultório → PacienteNaoEncontradoError.
 */
export async function enviarComoNutri(
  ctx: TenantContext,
  patientId: string,
  i: { texto: string },
  db: Db = getDb(),
  /** Só para os testes de concorrência: roda depois do INSERT, com as travas seguras, antes do commit. */
  o: { aposGravar?: () => Promise<void> } = {},
): Promise<{ id: string } | ErroDeEnvio> {
  exigirNutri(ctx);
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const texto = textoDoEnvio(i?.texto);
  if (texto === 'vazio' || texto === 'longo') return erroPainel(texto);
  return withTenant(
    ctx,
    async (tx) => {
      const p = await travarTitular(tx, patientId, 'share');
      if (!p) throw new PacienteNaoEncontradoError();
      if (!ativo(p)) return erroPainel('conversa');
      const [c] = await tx
        .select({ liberadaEm: chatConversas.liberadaEm, pausadaEm: chatConversas.pausadaEm })
        .from(chatConversas)
        .where(sql`${chatConversas.tenantId} = ${ctx.tenantId} and ${chatConversas.patientId} = ${p.id}`)
        .for('no key update');
      if (!c?.liberadaEm || c.pausadaEm) return erroPainel('conversa');
      const [t] = await tx.select({ nome: tenants.nomeProfissional, crn: tenants.crn }).from(tenants).where(sql`${tenants.id} = ${ctx.tenantId}`);
      if (!t?.nome || !t.crn) return erroPainel('carimbo');
      const [m] = await tx
        .insert(chatMensagens)
        .values({ tenantId: ctx.tenantId, patientId: p.id, autor: 'nutri', autorUserId: ctx.actorUserId!, texto })
        .returning({ id: chatMensagens.id });
      // T4: avisarPaciente(tx, { tipo: 'chat_mensagem', … }) entra aqui, na mesma transação
      await o.aposGravar?.();
      return { id: m.id };
    },
    db,
  );
}

/**
 * RN-458: o instante está "no horário" do aviso por e-mail à nutricionista — dentro das faixas com o horário ligado; com o
 * horário desligado, fora do silêncio das 21h às 8h. Lido SEM trava (snapshot simples) e ANTES de app_chat_aviso_nutri_devido:
 * salvarConfiguracao trava chat_configuracoes e depois chat_avisos_nutri, e a função trava chat_avisos_nutri — uma trava em
 * chat_configuracoes depois da função fecharia o ciclo (deadlock).
 */
async function noHorarioDoAviso(tx: Tx, tenantId: string, agora: Date): Promise<boolean> {
  const [t] = await tx.select({ fuso: tenants.fuso }).from(tenants).where(sql`${tenants.id} = ${tenantId}`);
  return avisoNoHorario(await horarioParaPaciente(tx), t.fuso, agora);
}

/**
 * RN-458, puro: dentro das faixas com o horário ligado; com o horário desligado — ou ligado sem nenhuma faixa (revisão da
 * T3, M7: não há horário definido) —, fora do silêncio das 21h às 8h no fuso do consultório.
 */
export function avisoNoHorario(h: { horarioAtivo: boolean; faixas: readonly Faixa[] }, fuso: string, agora: Date): boolean {
  return h.horarioAtivo && h.faixas.length > 0 ? dentroDoHorario(h.faixas, fuso, agora) : !emHorarioSilencioso(agora, fuso);
}

type EnvioDoPaciente = { id: string; textoFixo: CodigoTextoFixo | null; avisoNutriDevido: boolean };

/**
 * RN-447: trava o paciente (FOR UPDATE) → confere titular, conversa e limites → risco → app_chat_aviso_nutri_devido →
 * INSERT. A função do aviso roda em TODO envio que vai ser gravado (nunca num envio recusado) e ANTES do INSERT (CH-D72): o
 * FOR UPDATE dela, com a trava do paciente, serializa os envios, e a ordem de `criada_em` segue a ordem de commit. O retorno
 * dela fica só aqui dentro (T4: o e-mail à nutricionista); a resposta ao paciente não depende dele (canal lateral, CH-D70).
 */
async function gravarDoPaciente(tx: Tx, ctx: TenantContext, texto: string): Promise<EnvioDoPaciente | ErroDeEnvio> {
  const patientId = ctx.patientId!;
  const p = await travarTitular(tx, patientId, 'update');
  if (!p || !ativo(p)) return erroPortal('conversa');
  const [c] = await tx
    .select({ liberadaEm: chatConversas.liberadaEm, pausadaEm: chatConversas.pausadaEm })
    .from(chatConversas)
    .where(sql`${chatConversas.tenantId} = ${ctx.tenantId} and ${chatConversas.patientId} = ${patientId}`);
  if (!c?.liberadaEm || c.pausadaEm) return erroPortal('conversa');
  // RN-447: 30 na última hora e 200 no dia (no fuso do consultório), contadas no banco (nenhum Date do JS filtra criada_em).
  // O limite inferior (o menor dos dois inícios) deixa o índice da conversa ler só a janela, nunca o histórico (revisão da T3,
  // M1). `materialized` e a coluna `desde` pronta: inlinada, a comparação viraria `criada_em >= least(…)`, que a RLS de
  // chat_mensagens (barreira de segurança) não promove a condição do índice (EXPLAIN no relatório da T3)
  const [n] = (
    await tx.execute<{ hora: number; dia: number }>(sql`
      with t as materialized (
        select h.hora, h.dia, least(h.hora, h.dia) as desde
          from (select now() - interval '1 hour' as hora, (date_trunc('day', now() at time zone fuso) at time zone fuso) as dia
                  from tenants where id = ${ctx.tenantId}) h)
      select count(*) filter (where m.criada_em > t.hora)::int as hora,
             count(*) filter (where m.criada_em >= t.dia)::int as dia
        from t join chat_mensagens m on m.criada_em >= t.desde
       where m.tenant_id = ${ctx.tenantId} and m.patient_id = ${patientId} and m.autor = 'paciente'`)
  ).rows;
  const sinal = detectarRisco(texto);
  if (n.hora >= LIMITE_MENSAGENS_HORA || n.dia >= LIMITE_MENSAGENS_DIA) {
    // revisão da T3, M8 (segurança do paciente): a mensagem não é gravada, mas o socorro aparece (RN-449)
    return sinal ? { ...erroPortal('muitas'), textoFixo: sinal.textoFixo } : erroPortal('muitas');
  }
  const noHorario = await noHorarioDoAviso(tx, ctx.tenantId, new Date());
  const [aviso] = (await tx.execute<{ devido: boolean }>(sql`select app_chat_aviso_nutri_devido(${noHorario}) as devido`)).rows;
  const [m] = await tx
    .insert(chatMensagens)
    .values({
      tenantId: ctx.tenantId,
      patientId,
      autor: 'paciente',
      autorUserId: ctx.actorUserId!,
      texto,
      risco: sinal ? RISCO_DO_TEXTO_FIXO[sinal.textoFixo] : null,
    })
    .returning({ id: chatMensagens.id });
  return { id: m.id, textoFixo: sinal?.textoFixo ?? null, avisoNutriDevido: aviso.devido === true };
}

/**
 * US-443: o paciente envia texto à nutricionista. Devolve o `textoFixo` do sinal de risco (a tela mostra o socorro, RN-449)
 * ou um erro com o texto do portal; nada é gravado no erro. A resposta tem sempre as mesmas chaves — nunca diz se o e-mail
 * à nutricionista saiu (CH-D70). Só a sessão de paciente com conta (RN-440).
 */
export async function enviarComoPaciente(ctx: TenantContext, i: { texto: string }, db: Db = getDb()): Promise<{ id: string; textoFixo: CodigoTextoFixo | null } | ErroDeEnvio> {
  exigirPacienteComConta(ctx);
  const texto = textoDoEnvio(i?.texto);
  if (texto === 'vazio' || texto === 'longo') return erroPortal(texto);
  const r = await withTenant(ctx, (tx) => gravarDoPaciente(tx, ctx, texto), db);
  return 'erro' in r ? r : { id: r.id, textoFixo: r.textoFixo };
}
