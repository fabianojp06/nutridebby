import 'server-only';
import type { PacienteAccess } from '@/lib/paciente-session';
import { getTenantBrand, type MarcaTenant } from '@/modules/plataforma/marca';
import { examesVisiveis, temEnvioVisivel } from '@/modules/portal/exames-enviados';
import { temExameLiberado } from '@/modules/portal/exames-liberados';
import { secoesDoPortal, type SecaoPortal } from './navegacao';

/**
 * Plano 16 (D10, RN-192): o que a faixa de uma seção precisa — a marca e as seções que este paciente vê. Plano 22 (RN-386):
 * "Exames" também aparece com exame liberado pela nutricionista.
 */
export async function molduraDaSecao(a: Pick<PacienteAccess, 'tenant' | 'ctx'>): Promise<Moldura> {
  return molduraComExames(
    a.tenant,
    await examesVisiveis(
      a.tenant,
      () => temEnvioVisivel(a.ctx),
      () => temExameLiberado(a.ctx),
    ),
  );
}

export type Moldura = { marca: MarcaTenant; secoes: SecaoPortal[] };

/** P08-13: a moldura com o "Exames" já decidido (Hoje lê o envio na transação da faixa, faixaDeHoje). */
export function molduraComExames(tenant: PacienteAccess['tenant'], exames: boolean): Moldura {
  return { marca: getTenantBrand(tenant), secoes: secoesDoPortal({ exames }) };
}
