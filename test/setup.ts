import { inject } from 'vitest';

// NODE_ENV é tipado como readonly pelos tipos globais do Next.js; Object.assign
// contorna a checagem estática sem afetar o valor em runtime (Vitest já o define
// como 'test' por padrão — a linha abaixo apenas o deixa explícito).
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_URL = inject('appDatabaseUrl');
process.env.AUTH_SECRET = 'test-secret-with-at-least-32-characters!!';
process.env.LOG_LEVEL = 'error';
