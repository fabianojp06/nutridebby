import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';

const nextConfig: NextConfig = {
  // pg-boss é biblioteca de servidor com SQL próprio; o `pg` já é externo por padrão no Next
  serverExternalPackages: ['pg-boss'],
  // M7: o token do convite está na URL; além da <meta name="referrer"> da página, o cabeçalho
  // vale desde a primeira resposta (inclusive para recursos pedidos antes do <head> ser lido).
  headers: async () => [{ source: '/convite/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }],
};

export default withSerwist(nextConfig);
