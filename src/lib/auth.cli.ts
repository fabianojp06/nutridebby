import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuth } from './auth';

export const auth = createAuth(drizzle('postgres://cli:cli@127.0.0.1:1/cli'), {
  baseURL: 'http://localhost:3000',
  secret: 'cli-only-secret-cli-only-secret-000',
  trustedProxies: [],
});
