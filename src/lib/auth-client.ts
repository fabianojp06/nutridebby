'use client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import type { Auth } from './auth';
import { withReturnPath } from './safe-return';

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<Auth>(),
    twoFactorClient({
      onTwoFactorRedirect() {
        // repassa o ?volta (já validado) do /entrar para a tela de 2FA
        const volta = new URLSearchParams(window.location.search).get('volta');
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- redirecionamento de 2FA exige navegação completa para recarregar a sessão
        window.location.href = withReturnPath('/entrar/2fa', volta);
      },
    }),
  ],
});
