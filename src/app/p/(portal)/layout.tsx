import type { CSSProperties } from 'react';
import { requirePaciente } from '@/lib/paciente-session';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { RegistrarAcesso } from '../acesso';
import { NavPortal } from '../nav-portal';
import { DonoDoAparelho } from '../plano-guardado';
import { SeloOffline } from '../selo-offline';

export const dynamic = 'force-dynamic';

/**
 * Páginas que exigem vínculo escolhido e termo aceito (todas de /p/, menos /p/escolher, /p/sem-acesso e /p/termo).
 * Cada página chama requirePaciente de novo (o layout não roda de novo na navegação entre abas).
 * US-005 "Marca aplicada" no PWA: logo e cor da nutricionista no topo.
 */
export default async function PortalLayout({ children }: LayoutProps<'/p'>) {
  const { tenant, vinculo } = await requirePaciente('/p/inicio');
  const marca = getTenantBrand(tenant);
  // --nd-marca é calculado no elemento com [data-tema]: o contêiner repete data-tema="sistema" junto com a cor do consultório
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
  return (
    // sem min-h-dvh: o contêiner de /p/layout.tsx já tem (débito T-4)
    <div data-tema="sistema" style={cores} className="flex flex-1 flex-col">
      <DonoDoAparelho dono={vinculo.patientId} />
      <RegistrarAcesso dono={vinculo.patientId} />
      <div className="flex items-center gap-3 border-b-[3px] border-marca px-6 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, sem otimização do Next */}
        {marca.logoUrl && <img src={marca.logoUrl} alt={`Logo de ${marca.nome}`} className="h-8 w-auto rounded bg-white p-1" />}
        <p className="text-sm text-suave">{`Acompanhamento com ${marca.nome}`}</p>
      </div>
      <SeloOffline />
      <div className="flex-1">{children}</div>
      <NavPortal />
    </div>
  );
}
