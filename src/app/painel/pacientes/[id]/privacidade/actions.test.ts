import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { diaryEntries, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getEnv } from '@/env';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { nutriComDpa } from '../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../test/pacientes';

// atenderExclusaoAction pelo caminho real (requireNutri → Postgres via Testcontainers), como os outros actions.test.ts;
// só o runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { atenderExclusaoAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const confirmacao = (nome: string) => {
  const f = new FormData();
  f.set('confirmacao', nome);
  return f;
};

describe('atenderExclusaoAction (US-018, Plano 06)', () => {
  it('"Atender pedido de exclusão" bloqueia e apaga na hora as fotos do diário (o registro fica, com a foto "removida")', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    const foto = await salvarArquivo(N.ctx, { tipo: 'diario_foto', conteudo: JPEG, permitidos: ['jpg'], patientId: p.id }, { db });
    await withTenant(N.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: N.tenantId, patientId: p.id, refeicao: 'Almoço', texto: 'arroz', fotoPath: foto.caminho, fotoStatus: 'pronta' }), db);

    expect(await atenderExclusaoAction(p.id, {}, confirmacao(p.nome))).toEqual({});

    const [paciente] = await withTenant(N.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), db);
    expect(paciente.status).toBe('bloqueado');
    const [e] = await withTenant(N.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), db);
    expect(e).toMatchObject({ fotoPath: null, fotoStatus: 'removida', texto: 'arroz' });
    expect(existsSync(resolverCaminho(getEnv().DATA_DIR, foto.caminho))).toBe(false);
  });

  it('nome errado: nada é bloqueado nem apagado', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    const foto = await salvarArquivo(N.ctx, { tipo: 'diario_foto', conteudo: JPEG, permitidos: ['jpg'], patientId: p.id }, { db });
    await withTenant(N.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: N.tenantId, patientId: p.id, refeicao: 'Almoço', fotoPath: foto.caminho, fotoStatus: 'pronta' }), db);
    expect((await atenderExclusaoAction(p.id, {}, confirmacao('Outra Pessoa'))).erro).toBeTruthy();
    const [e] = await withTenant(N.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), db);
    expect(e).toMatchObject({ fotoPath: foto.caminho, fotoStatus: 'pronta' });
    expect(existsSync(resolverCaminho(getEnv().DATA_DIR, foto.caminho))).toBe(true);
  });
});
