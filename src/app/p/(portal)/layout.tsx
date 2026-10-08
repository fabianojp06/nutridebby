import type { CSSProperties } from 'react';
import { requirePaciente } from '@/lib/paciente-session';
import { corDaFaixa } from '@/lib/tema/marca-tema';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { RegistrarAcesso } from '../acesso';
import { DonoDoAparelho } from '../plano-guardado';

export const dynamic = 'force-dynamic';

/**
 * Páginas que exigem vínculo escolhido e termo aceito (todas de /p/, menos /p/escolher, /p/sem-acesso e /p/termo).
 * Cada página chama requirePaciente de novo (o layout não roda de novo na navegação entre seções). Plano 16: a faixa
 * (marca e seções) é de cada página (Faixa / CabecalhoDetalhe, D10); aqui só as cores do consultório: --nd-marca-base
 * (botões e links), --nd-marca-clara (o escuro) e --nd-faixa (corDaFaixa, RN-207).
 */
export default async function PortalLayout({ children }: LayoutProps<'/p'>) {
  const { tenant, vinculo } = await requirePaciente('/p/inicio');
  const marca = getTenantBrand(tenant);
  // --nd-marca é calculado no elemento com [data-tema]: o contêiner repete data-tema="sistema" junto com a cor do consultório
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro, '--nd-faixa': corDaFaixa(marca.cor) } as CSSProperties;
  return (
    // sem min-h-dvh: o contêiner de /p/layout.tsx já tem (débito T-4)
    <div data-tema="sistema" data-app="paciente" style={cores} className="flex flex-1 flex-col">
      <DonoDoAparelho dono={vinculo.patientId} />
      <RegistrarAcesso dono={vinculo.patientId} />
      {children}
    </div>
  );
}
