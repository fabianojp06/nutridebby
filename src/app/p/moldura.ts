import 'server-only';
import type { PacienteAccess } from '@/lib/paciente-session';
import { getTenantBrand, type MarcaTenant } from '@/modules/plataforma/marca';
import { temEnvioVisivel } from '@/modules/portal/exames-enviados';
import { secoesDoPortal, type SecaoPortal } from './navegacao';

/** Plano 16 (D10, RN-192): o que a faixa de uma seção precisa — a marca e as seções que este paciente vê. */
export async function molduraDaSecao(a: Pick<PacienteAccess, 'tenant' | 'ctx'>): Promise<{ marca: MarcaTenant; secoes: SecaoPortal[] }> {
  const exames = Boolean(a.tenant.examesPacienteAtivadoEm) || (await temEnvioVisivel(a.ctx));
  return { marca: getTenantBrand(a.tenant), secoes: secoesDoPortal({ exames }) };
}
