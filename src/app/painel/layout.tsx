import type { CSSProperties } from 'react';
import { requireNutri } from '@/lib/tenant-session';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { CabecalhoPainel } from './cabecalho';

/**
 * Visual V2 (D24): o tema (data-tema, D17) e a cor do consultório (D19) valem para todas as telas do painel. O layout
 * NÃO é barreira de segurança: cada página chama requireNutri (guarda em cabecalho.test.ts).
 */
export default async function PainelLayout({ children }: LayoutProps<'/painel'>) {
  const { data, tenant } = await requireNutri('/painel', { permitirDpaPendente: true });
  const marca = getTenantBrand(tenant);
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
  return (
    <div data-tema={tema} style={cores} className="flex min-h-dvh flex-col bg-fundo font-sans text-texto">
      <CabecalhoPainel marca={marca} nome={data.user.name} email={data.user.email} tema={tema} completo={tenant.dpaVersao === DPA_VERSAO} />
      {children}
    </div>
  );
}
