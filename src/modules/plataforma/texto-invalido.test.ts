import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, limpo, semErroDoBanco, sujo } from '../../../test/erros-do-banco';
import { closeDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { criarContaNutri, listarContas } from './contas';
import { atualizarPerfil } from './marca';

vi.mock('server-only', () => ({})); // marca.ts é só do servidor

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par no perfil público do consultório (nome de exibição, endereço,
 * link), no nome da conta criada pelo admin e na busca da lista de contas não chegam ao banco — o `text` recusaria o NUL
 * (22021) com o texto no log e no erro do app. O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(async () => {
  await stopBoss(); // criarContaNutri enfileira o e-mail do convite
  await closeDb();
  await app.pool.end();
});

describe('SUS-110: texto com NUL ou surrogate sem par no perfil do consultório', () => {
  it.each(INVALIDOS)('nome de exibição, endereço e link com %s vão limpos', async (_nome, ch) => {
    const [t] = await app.db.insert(tenants).values({ slug: `sus110-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Marca' }).returning();
    await semErroDoBanco(errosDoBanco, () =>
      atualizarPerfil(
        t.id,
        {
          nomeExibicao: `Debby${ch} Silva 🙂`,
          crn: 'CRN-3 12345',
          corPrimaria: '#2E7D32',
          enderecoConsultorio: `Rua A${ch}, 10 🙂`,
          linkOnlinePadrao: `https://meet.exemplo.com/debby${ch}`,
          antecedenciaMinH: '12',
          cancelamentoMinH: '24',
          agendamentoPublicoAtivo: true,
          mostrarPercGorduraPaciente: false,
          fuso: 'America/Sao_Paulo',
        },
        app.db,
      ),
    );
    const [r] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r).toMatchObject({ nomeExibicao: 'Debby Silva 🙂', enderecoConsultorio: 'Rua A, 10 🙂', linkOnlinePadrao: 'https://meet.exemplo.com/debby' });
  });

  it.each(INVALIDOS)('admin: o nome da conta nova com %s vai limpo, e a busca da lista com ele não dá erro do banco e acha a conta', async (_nome, ch) => {
    const x = randomUUID().slice(0, 8);
    const { tenantId } = await semErroDoBanco(errosDoBanco, () =>
      criarContaNutri({ nomeExibicao: sujo(`Debby ${x}`, ch), email: `debby-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `sus110-${x}` }, { db: app.db, appUrl: 'http://localhost:3000' }),
    );
    const [t] = await app.db.select({ nome: tenants.nomeExibicao }).from(tenants).where(eq(tenants.id, tenantId));
    expect(t.nome).toBe(limpo(`Debby ${x}`));
    const pagina = await semErroDoBanco(errosDoBanco, () => listarContas(app.db, new Date(), { busca: `${x}${ch}` }));
    expect(pagina.contas.map((c) => c.tenantId)).toEqual([tenantId]);
  });
});
