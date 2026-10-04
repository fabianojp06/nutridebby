import type { CSSProperties } from 'react';
import { requireNutri } from '@/lib/tenant-session';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { lerGuia } from '@/modules/plataforma/preferencias';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { CabecalhoPainel } from './cabecalho';

/**
 * Visual V2 (D24): o tema (data-tema, D17) e a cor do consultório (D19) valem para todas as telas do painel. O layout
 * NÃO é barreira de segurança: cada página chama requireNutri (guarda em cabecalho.test.ts). O contêiner é bloco, não
 * flex: num flex em coluna, o `<main className="mx-auto max-w-*">` das telas ficaria com a largura do próprio conteúdo.
 */
export default async function PainelLayout({ children }: LayoutProps<'/painel'>) {
  const { data, tenant } = await requireNutri('/painel', { permitirDpaPendente: true });
  const marca = getTenantBrand(tenant);
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
  const completo = tenant.dpaVersao === DPA_VERSAO;
  // D27: o progresso do manual guiado é só o valor inicial do GuiaDoPainel (a navegação pelo cliente não refaz o layout)
  const progresso = completo ? await lerGuia(data.user.id) : null;
  return (
    <div data-tema={tema} style={cores} className="min-h-dvh bg-fundo font-sans text-texto">
      <CabecalhoPainel marca={marca} nome={data.user.name} email={data.user.email} tema={tema} completo={completo} progresso={progresso} />
      {children}
    </div>
  );
}
