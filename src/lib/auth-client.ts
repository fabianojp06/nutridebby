'use client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import type { Auth } from './auth';

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<Auth>(),
    twoFactorClient({
      onTwoFactorRedirect() {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- redirecionamento de 2FA exige navegação completa para recarregar a sessão
        window.location.href = '/entrar/2fa';
      },
    }),
  ],
});
