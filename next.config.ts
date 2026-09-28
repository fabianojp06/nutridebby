import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';

const nextConfig: NextConfig = {
  // pg-boss é biblioteca de servidor com SQL próprio; o `pg` já é externo por padrão no Next
  serverExternalPackages: ['pg-boss'],
};

export default withSerwist(nextConfig);
