import type { AppointmentRow, TenantRow } from '@/db/schema';
import type { EmailMessage } from '@/email/types';
import { openSecret } from '@/lib/crypto';
import { partesNoFuso, quandoComFuso, rotuloDoFuso } from '@/modules/agenda/fuso';
import { assinarLinkConsulta, urlDaConsulta } from '@/modules/agenda/link-consulta';
import type { ContextoEnvio } from './enviar';

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

/** D7 (rodada 1): o envio cai no dia da consulta, no fuso do tenant — o lembrete de 24 h adiado para as 08:00 diz "hoje". */
export const ehHoje = (c: { consulta: AppointmentRow; tenant: TenantRow; agora: Date }) =>
  partesNoFuso(c.agora, c.tenant.fuso).data === partesNoFuso(c.consulta.inicio, c.tenant.fuso).data;

/** Dados comuns às mensagens de uma consulta; o link assinado (D20) vai em todas, menos no cancelamento. */
export function dadosDaConsulta(c: { consulta: AppointmentRow; tenant: TenantRow }, deps: { appUrl: string; chaveLinks: Buffer }) {
  const modalidade = c.consulta.modalidade as 'presencial' | 'online';
  return {
    nutri: c.tenant.nomeExibicao,
    quando: quandoComFuso(c.consulta.inicio, c.tenant.fuso),
    hora: partesNoFuso(c.consulta.inicio, c.tenant.fuso).hora,
    modalidade,
    local: modalidade === 'online' ? c.consulta.linkOnline : c.tenant.enderecoConsultorio,
    link: urlDaConsulta(deps.appUrl, assinarLinkConsulta({ tenantId: c.tenant.id, appointmentId: c.consulta.id, inicio: c.consulta.inicio }, deps.chaveLinks)),
  };
}

/** E-mail de uma linha de `notifications` (só os tipos ligados a consulta têm e-mail). */
export function emailDaNotificacao(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): EmailMessage | null {
  const evento = c.n.tipo;
  if (!c.consulta || (evento !== 'lembrete_24h' && evento !== 'lembrete_2h' && evento !== 'consulta_marcada' && evento !== 'consulta_cancelada')) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant }, deps);
  // D7: o de 24 h que sai no dia da consulta usa o texto "de hoje" (o do lembrete de 2 h), nunca "amanhã"
  const doDia = evento === 'lembrete_24h' && ehHoje({ consulta: c.consulta, tenant: c.tenant, agora: c.agora }) ? 'lembrete_2h' : evento;
  return { tipo: 'consulta', evento: doDia, para: c.paciente.email, nome: primeiroNome(c.paciente.nome), ...d, link: evento === 'consulta_cancelada' ? null : d.link };
}

/** Texto pronto, cifrado na linha até o envio (convite com link de uso único, Tarefa 14). */
export const FINALIDADE_CONTEUDO = 'notificacao-conteudo';

/**
 * D3: texto simples (sem botões, sem template). Só transacional: lembrete, resposta e convite. O link assinado
 * da consulta vai em todo lembrete; a resposta "1"/"2" é interpretada no webhook (Tarefa 12).
 */
export function textoWhatsapp(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): string | null {
  if (c.n.conteudoSelado) return openSecret(c.n.conteudoSelado, FINALIDADE_CONTEUDO);
  if (c.n.tipo === 'resposta_confirmacao') return 'Presença confirmada. Até lá!';
  if (!c.consulta) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant }, deps);
  const nome = primeiroNome(c.paciente.nome);
  const local = d.local ? (d.modalidade === 'online' ? `Link da chamada: ${d.local}` : `Endereço: ${d.local}`) : null;
  switch (c.n.tipo) {
    case 'lembrete_24h':
      // a data completa (não "amanhã"): também vale para o de 24 h adiado para as 08:00 do dia da consulta (D7)
      return [`Olá, ${nome}! Lembrete da sua consulta com ${d.nutri}: ${d.quando}, ${d.modalidade}.`, local, '', 'Responda 1 para confirmar ou 2 se precisar remarcar.', `Ou use o link: ${d.link}`].filter((l) => l !== null).join('\n');
    case 'lembrete_2h':
      return [`Olá, ${nome}! Sua consulta com ${d.nutri} é hoje às ${d.hora} (${rotuloDoFuso(c.tenant.fuso)}).`, local, '', `Se não puder ir, avise pelo link: ${d.link}`].filter((l) => l !== null).join('\n');
    case 'resposta_remarcar':
      return `Tudo bem! Para escolher outro horário, use o link: ${d.link}\nSe faltarem menos de ${c.tenant.cancelamentoMinH} h para a consulta, fale direto com ${d.nutri}.`;
    default:
      return null;
  }
}
