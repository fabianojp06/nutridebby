import 'server-only';
import type { PacienteAccess } from '@/lib/paciente-session';
import { getTenantBrand, type MarcaTenant } from '@/modules/plataforma/marca';
import { temEnvioVisivel } from '@/modules/portal/exames-enviados';
import { secoesDoPortal, type SecaoPortal } from './navegacao';

/** Plano 16 (D10, RN-192): o que a faixa de uma seção precisa — a marca e as seções que este paciente vê. */
export async function molduraDaSecao(a: Pick<PacienteAccess, 'tenant' | 'ctx'>): Promise<Moldura> {
  return molduraComExames(a.tenant, Boolean(a.tenant.examesPacienteAtivadoEm) || (await temEnvioVisivel(a.ctx)));
}

export type Moldura = { marca: MarcaTenant; secoes: SecaoPortal[] };

/** P08-13: a moldura com o "Exames" já decidido (Hoje lê o envio na transação da faixa, faixaDeHoje). */
export function molduraComExames(tenant: PacienteAccess['tenant'], exames: boolean): Moldura {
  return { marca: getTenantBrand(tenant), secoes: secoesDoPortal({ exames }) };
}
