import type { AppointmentRow, TenantRow } from '@/db/schema';
import type { EmailMessage } from '@/email/types';
import { partesNoFuso, quandoComFuso } from '@/modules/agenda/fuso';
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
