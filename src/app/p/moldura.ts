import 'server-only';
import { headers } from 'next/headers';
import type { TenantContext } from '@/db/tenant';
import type { PacienteAccess } from '@/lib/paciente-session';
import { mensagensNaFaixa } from '@/modules/mensagens/conversa';
import { getTenantBrand, type MarcaTenant } from '@/modules/plataforma/marca';
import { examesVisiveis, temEnvioVisivel } from '@/modules/portal/exames-enviados';
import { CABECALHO_PEDIDO_DA_COPIA } from '../sw-regras';
import { secoesDoPortal, type SecaoPortal } from './navegacao';

/**
 * Plano 16 (D10, RN-192): o que a faixa de uma seção precisa — a marca, as seções que este paciente vê e (Plano 25) o link
 * "Mensagens" da faixa.
 */
export async function molduraDaSecao(a: Pick<PacienteAccess, 'tenant' | 'ctx'>): Promise<Moldura> {
  const [exames, mensagens] = await Promise.all([examesVisiveis(a.tenant, () => temEnvioVisivel(a.ctx)), mensagensDaFaixa(a.ctx)]);
  return molduraComExames(a.tenant, exames, mensagens);
}

/** `mensagens`: as não lidas do link "Mensagens" da faixa; `null` = sem link (Plano 25, RN-473). */
export type Moldura = { marca: MarcaTenant; secoes: SecaoPortal[]; mensagens: number | null };

/** P08-13: a moldura com o "Exames" já decidido (Hoje lê o envio na transação da faixa, faixaDeHoje) e o número de mensagensDaFaixa. */
export function molduraComExames(tenant: PacienteAccess['tenant'], exames: boolean, mensagens: number | null = null): Moldura {
  return { marca: getTenantBrand(tenant), secoes: secoesDoPortal({ exames }), mensagens };
}

/**
 * Plano 25 (§4.1, RN-473): o link "Mensagens" da faixa — `null` sem conversa liberada nem recado (sem link); senão as não
 * lidas (só contagem, sem auditRead). Na busca da cópia offline de /p/plano (o service worker manda
 * CABECALHO_PEDIDO_DA_COPIA), o link sai sem o "({n})": o número da cópia ficaria velho no aparelho.
 */
export async function mensagensDaFaixa(ctx: TenantContext): Promise<number | null> {
  const [n, h] = await Promise.all([mensagensNaFaixa(ctx), headers()]);
  if (n === null) return null;
  return h.get(CABECALHO_PEDIDO_DA_COPIA) === '1' ? 0 : n;
}
