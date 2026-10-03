import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/p/inicio',
    name: 'NutriDebby',
    short_name: 'NutriDebby',
    description: 'Seu acompanhamento nutricional',
    lang: 'pt-BR',
    start_url: '/p/inicio',
    scope: '/p/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1d6b5a',
    // D21: arte genérica (o dono pode trocar o SVG e rodar `pnpm icones`)
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
