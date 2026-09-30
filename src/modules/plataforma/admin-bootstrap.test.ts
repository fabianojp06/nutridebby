import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { user } from '@/db/schema';
import { createAuth } from '@/lib/auth';
import { AdminBootstrapError, createAdmin } from './admin-bootstrap';

const app = makeDb(inject('appDatabaseUrl'));
const deps = { db: app.db, auth: createAuth(app.db) };
afterAll(() => app.pool.end());

describe('createAdmin (US-001, cenário "Primeiro admin")', () => {
  it('normaliza o e-mail, cria admin sem senha e devolve link de definição (Review Focus 4)', async () => {
    const r = await createAdmin('  Primeiro.Admin@Exemplo.COM ', deps);
    const [u] = await app.db.select().from(user).where(eq(user.id, r.userId));
    expect(u.email).toBe('primeiro.admin@exemplo.com');
    expect(u.appRole).toBe('admin');
    expect(u.tenantId).toBeNull();
    expect(r.link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/.+callbackURL=%2Fdefinir-senha/);
  });

  it('recusa e-mail já cadastrado', async () => {
    await expect(createAdmin('primeiro.admin@exemplo.com', deps)).rejects.toThrow('Já existe um usuário com este e-mail');
  });

  it('recusa e-mail inválido', async () => {
    await expect(createAdmin('nao-e-email', deps)).rejects.toBeInstanceOf(AdminBootstrapError);
  });

  it('desfaz o usuário se requestPasswordReset falhar e permite retry', async () => {
    const email = 'retry-test@exemplo.com';
    // Primeira tentativa: auth que falha
    const failingAuth = {
      api: {
        requestPasswordReset: async () => {
          throw new Error('falha simulada');
        },
      },
    } as unknown as typeof deps.auth;

    await expect(
      createAdmin(email, { db: app.db, auth: failingAuth }),
    ).rejects.toThrow('falha simulada');

    // Verifica que nenhum usuário foi criado
    const [u] = await app.db.select().from(user).where(eq(user.email, email));
    expect(u).toBeUndefined();

    // Segunda tentativa: auth real deve funcionar
    const r = await createAdmin(email, deps);
    expect(r.userId).toBeDefined();
    expect(r.link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/.+callbackURL=%2Fdefinir-senha/);
  });
});
