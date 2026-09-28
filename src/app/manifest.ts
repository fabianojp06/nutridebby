import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NutriDebby',
    short_name: 'NutriDebby',
    start_url: '/p',
    scope: '/p/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1d6b5a',
    icons: [],
  };
}
