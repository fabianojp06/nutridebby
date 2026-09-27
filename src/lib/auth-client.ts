'use client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import type { Auth } from './auth';

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<Auth>(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/entrar/2fa';
      },
    }),
  ],
});
