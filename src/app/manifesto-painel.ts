import type { Metadata, MetadataRoute } from 'next';

/** P09-05: o painel da nutricionista instalável numa janela própria. Separado do app do portal pelo `id`. */
export const MANIFESTO_DO_PAINEL_URL = '/painel.webmanifest';

export function manifestoDoPainel(): MetadataRoute.Manifest {
  return {
    id: '/painel',
    name: 'NutriDebby — Painel',
    short_name: 'Painel ND',
    description: 'Painel da nutricionista',
    lang: 'pt-BR',
    start_url: '/painel',
    // D7: '/' e não '/painel' — o login (/entrar) e a Segurança (/conta) ficam dentro da janela do app; no iPhone, sair do
    // escopo abre o Safari, com outros cookies, e o login não voltaria para o app
    scope: '/',
    display: 'standalone',
    // sem `orientation` (WCAG 2.1 AA 1.3.4) e sem service worker (D8: nada do painel guardado no aparelho)
    background_color: '#ffffff',
    theme_color: '#1d6b5a',
    // arte provisória (o dono define o layout depois): `pnpm icones` gera os PNG a partir de public/icones/painel.svg
    icons: [
      { src: '/icones/painel-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/painel-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/painel-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** `metadata` do layout do painel: o manifest dele (substitui o do portal, que o app/manifest.ts põe em toda página) e o iPhone. */
export const METADADOS_DO_PAINEL: Metadata = {
  manifest: MANIFESTO_DO_PAINEL_URL,
  // o iPhone usa o apple-touch-icon e o título daqui, não os do manifest
  appleWebApp: { capable: true, title: 'Painel ND', statusBarStyle: 'default' },
  icons: { apple: '/icones/painel-apple-touch-icon.png' },
};
