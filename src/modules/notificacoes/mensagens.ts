import type { AppointmentRow, PatientRow, TenantRow } from '@/db/schema';
import type { EmailMessage } from '@/email/types';
import { openSecret } from '@/lib/crypto';
import { urlDoApp } from '@/lib/url-do-app';
import { partesNoFuso, quandoComFuso, rotuloDoFuso } from '@/modules/agenda/fuso';
import { assinarLinkConsulta, urlDaConsulta } from '@/modules/agenda/link-consulta';
import { telaDoPortal } from '@/modules/portal/link-portal';
import type { ContextoEnvio } from './enviar';

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

/** D7 (rodada 1): o envio cai no dia da consulta, no fuso do tenant — o lembrete de 24 h adiado para as 08:00 diz "hoje". */
export const ehHoje = (c: { consulta: AppointmentRow; tenant: TenantRow; agora: Date }) =>
  partesNoFuso(c.agora, c.tenant.fuso).data === partesNoFuso(c.consulta.inicio, c.tenant.fuso).data;

/** Dados comuns às mensagens de uma consulta (sem link: só o e-mail e o push levam o link assinado, `linkDaConsulta`). */
export function dadosDaConsulta(c: { consulta: AppointmentRow; tenant: TenantRow }) {
  const modalidade = c.consulta.modalidade as 'presencial' | 'online';
  return {
    nutri: c.tenant.nomeExibicao,
    quando: quandoComFuso(c.consulta.inicio, c.tenant.fuso),
    hora: partesNoFuso(c.consulta.inicio, c.tenant.fuso).hora,
    modalidade,
    local: modalidade === 'online' ? c.consulta.linkOnline : c.tenant.enderecoConsultorio,
  };
}

/** D20: link assinado da consulta, com o e-mail ATUAL do paciente na assinatura (corrigido o e-mail, o link antigo cai). */
export function linkDaConsulta(c: { consulta: AppointmentRow; tenant: TenantRow; paciente: PatientRow }, deps: { appUrl: string; chaveLinks: Buffer }): string {
  return urlDaConsulta(deps.appUrl, assinarLinkConsulta({ tenantId: c.tenant.id, appointmentId: c.consulta.id, inicio: c.consulta.inicio, email: c.paciente.email }, deps.chaveLinks));
}

/**
 * E-mail de uma linha de `notifications` (só os tipos ligados a consulta têm e-mail). O link da consulta e o da chamada
 * ficam aqui. `resposta_remarcar` (fechamento): o "2" no WhatsApp gera também um e-mail novo, montado no envio — com o
 * e-mail ATUAL do paciente e o link assinado com ele (o do lembrete pode nunca ter saído ou ter caído com a correção do
 * e-mail).
 */
export function emailDaNotificacao(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): EmailMessage | null {
  const evento = c.n.tipo;
  if (!c.consulta || (evento !== 'lembrete_24h' && evento !== 'lembrete_2h' && evento !== 'consulta_marcada' && evento !== 'consulta_cancelada' && evento !== 'resposta_remarcar')) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant });
  if (evento === 'resposta_remarcar') {
    const link = linkDaConsulta({ consulta: c.consulta, tenant: c.tenant, paciente: c.paciente }, deps);
    return { tipo: 'consulta', evento, para: c.paciente.email, nome: primeiroNome(c.paciente.nome), ...d, link, prazoH: c.tenant.cancelamentoMinH };
  }
  // D7: o de 24 h que sai no dia da consulta usa o texto "de hoje" (o do lembrete de 2 h), nunca "amanhã"
  const doDia = evento === 'lembrete_24h' && ehHoje({ consulta: c.consulta, tenant: c.tenant, agora: c.agora }) ? 'lembrete_2h' : evento;
  const link = evento === 'consulta_cancelada' ? null : linkDaConsulta({ consulta: c.consulta, tenant: c.tenant, paciente: c.paciente }, deps);
  return { tipo: 'consulta', evento: doDia, para: c.paciente.email, nome: primeiroNome(c.paciente.nome), ...d, link };
}

/**
 * Texto pronto, cifrado na linha até o envio: uma linha com `conteudo_selado` sai com esse texto, qualquer que seja o tipo.
 * Hoje nenhum fluxo grava (o convite por WhatsApp é montado no envio, sem link — rodada 1 da T14); toda saída final o
 * apaga e o banco recusa o texto fora de `pendente`/`enviando` (CHECK `notifications_conteudo_so_antes_do_envio`).
 */
export const FINALIDADE_CONTEUDO = 'notificacao-conteudo';

/** "a***@ex.com": primeira letra + "***" + "@" + domínio; sem as duas partes, só "***". */
export function emailMascarado(email: string): string {
  const arroba = email.lastIndexOf('@');
  if (arroba < 1 || arroba === email.length - 1) return '***';
  return `${[...email][0]}***@${email.slice(arroba + 1)}`;
}

/**
 * US-010, decisão do dono (rodada 1 da T14): o convite por WhatsApp é só um aviso — o link (credencial de criação da
 * conta) vai só no e-mail. O número do WhatsApp não foi verificado e a conversa fica no aparelho do consultório (D2):
 * com o link, um número errado ou reciclado criaria a conta do paciente. Um texto só para conta nova ou existente — dizer
 * que o e-mail já é paciente de outra nutricionista vazaria dado do outro consultório. Montado na hora do envio, com o
 * e-mail atual do paciente.
 */
export function textoConviteWhatsapp(o: { nome: string; nutri: string; email: string }): string {
  return `Olá, ${primeiroNome(o.nome)}! ${o.nutri} convidou você para o NutriDebby. Enviamos o convite para o seu e-mail ${emailMascarado(o.email)} (vale por 7 dias).`;
}

/**
 * D3: texto simples (sem botões, sem template). Só transacional: lembrete, resposta e convite. A resposta "1"/"2" é
 * interpretada no webhook (Tarefa 12). Decisão do dono (fechamento), pelo mesmo motivo do convite: o número nunca foi
 * verificado e a conversa fica no aparelho do consultório (D2) — nada de endereço de acesso no WhatsApp. Nem o link
 * assinado da consulta (confirmar, cancelar, remarcar) nem o link da chamada online: os dois vão só no e-mail, e o texto
 * diz para qual e-mail (mascarado, como no convite). O endereço do consultório fica (não dá acesso a nada).
 */
export function textoWhatsapp(c: ContextoEnvio): string | null {
  if (c.n.conteudoSelado) return openSecret(c.n.conteudoSelado, FINALIDADE_CONTEUDO);
  if (c.n.tipo === 'resposta_confirmacao') return 'Presença confirmada. Até lá!';
  if (c.n.tipo === 'convite_paciente') return textoConviteWhatsapp({ nome: c.paciente.nome, nutri: c.tenant.nomeExibicao, email: c.paciente.email });
  if (!c.consulta) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant });
  const nome = primeiroNome(c.paciente.nome);
  const email = emailMascarado(c.paciente.email);
  const local = d.modalidade === 'online' ? `O link da chamada foi enviado para o seu e-mail ${email}.` : d.local ? `Endereço: ${d.local}` : null;
  const responda = 'Responda 1 para confirmar ou 2 se precisar remarcar.';
  switch (c.n.tipo) {
    case 'lembrete_24h':
      // a data completa (não "amanhã"): também vale para o de 24 h adiado para as 08:00 do dia da consulta (D7)
      return [`Olá, ${nome}! Lembrete da sua consulta com ${d.nutri}: ${d.quando}, ${d.modalidade}.`, local, '', responda].filter((l) => l !== null).join('\n');
    case 'lembrete_2h':
      return [`Olá, ${nome}! Sua consulta com ${d.nutri} é hoje às ${d.hora} (${rotuloDoFuso(c.tenant.fuso)}), ${d.modalidade}.`, local, '', responda].filter((l) => l !== null).join('\n');
    case 'resposta_remarcar':
      // fechamento: a mesma resposta grava um e-mail novo com o link (`tratarResposta`, whatsapp/webhook.ts)
      return `Tudo bem! Enviamos o link para remarcar para o seu e-mail ${email}.\nSe faltarem menos de ${c.tenant.cancelamentoMinH} h para a consulta, fale direto com ${d.nutri}.`;
    default:
      return null;
  }
}

/** Plano 06: push sem consulta — o texto e a tela do portal que o toque abre (US-040, US-043, US-025). */
const AVISOS_DO_PORTAL: Record<string, { corpo: string; tela: string }> = {
  push_teste: { corpo: 'Notificações ativadas ✅', tela: '/p/inicio' },
  comentario_diario: { corpo: 'Sua nutricionista comentou seu diário', tela: '/p/diario' },
  plano_novo: { corpo: 'Seu novo plano alimentar está disponível', tela: '/p/plano' },
  // D4 (Plano 07): neutro — o título do conteúdo pode dizer uma condição de saúde na tela de bloqueio
  conteudo_novo: { corpo: 'Sua nutricionista publicou um novo conteúdo', tela: '/p/conteudos' },
  // US-145 / RN-152: neutro — nem o tipo do documento, nem itens ou produtos
  documento_novo: { corpo: 'Você tem um novo documento.', tela: '/p/documentos' },
  // US-149 / D11: o cancelamento, também neutro (nem o tipo do documento, nem o motivo)
  documento_atualizado: { corpo: 'Um documento seu foi atualizado.', tela: '/p/documentos' },
  // Plano 12 (C-05): neutro de propósito, mais que os outros — nem "exame" (a palavra na tela de bloqueio já diz dado de saúde)
  exame_revisado: { corpo: 'Há uma atualização para você no app.', tela: '/p/exames' },
  exame_expirado: { corpo: 'Há uma atualização para você no app.', tela: '/p/exames' },
};

/**
 * D19: texto do push sem dado de saúde — só o horário (fechamento: neutro, sem o nome da nutricionista, que diria na tela
 * de bloqueio com quem a pessoa se consulta; nada do paciente, da modalidade nem do local). O toque abre o link da
 * consulta (o push vai só aos dispositivos inscritos pelo próprio paciente). Vai cifrado até o dispositivo.
 */
export function pushDaNotificacao(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): { titulo: string; corpo: string; url: string | null } | null {
  // Plano 06 (D7, D8): avisos do portal, sem consulta — texto neutro (sem nome da nutricionista nem dado do paciente)
  if (!c.consulta) {
    const aviso = Object.hasOwn(AVISOS_DO_PORTAL, c.n.tipo) ? AVISOS_DO_PORTAL[c.n.tipo] : null;
    // a tela leva o consultório (`?v=`): com 2+ vínculos, o toque abre o diário/plano deste, não o do cookie
    return aviso ? { titulo: 'NutriDebby', corpo: aviso.corpo, url: urlDoApp(deps.appUrl, telaDoPortal(aviso.tela, c.tenant.id)) } : null;
  }
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant });
  const link = () => linkDaConsulta({ consulta: c.consulta!, tenant: c.tenant, paciente: c.paciente }, deps);
  const hoje = `Sua consulta é hoje às ${d.hora}.`;
  switch (c.n.tipo) {
    case 'lembrete_24h': // D7: adiado para as 08:00 do dia da consulta → "hoje"
      return { titulo: 'Lembrete de consulta', corpo: ehHoje({ consulta: c.consulta, tenant: c.tenant, agora: c.agora }) ? hoje : `Você tem uma consulta amanhã às ${d.hora}.`, url: link() };
    case 'lembrete_2h':
      return { titulo: 'Lembrete de consulta', corpo: hoje, url: link() };
    case 'consulta_marcada':
      return { titulo: 'Consulta marcada', corpo: `Sua consulta foi marcada para ${d.quando}.`, url: link() };
    case 'consulta_cancelada':
      return { titulo: 'Consulta cancelada', corpo: `Sua consulta de ${d.quando} foi cancelada.`, url: null };
    default:
      return null;
  }
}
