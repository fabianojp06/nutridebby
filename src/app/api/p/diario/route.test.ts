import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { diaryEntries, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { COTA_BYTES, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { MSG_DIARIO } from '@/modules/portal/diario-constantes';
import { novoTenant } from '../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../test/portal';
import { entrar } from '../../../../../test/sessao';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

const JPEG = () => new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)])], { type: 'image/jpeg' });
const PDF = () => new Blob([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)])], { type: 'image/jpeg' });

async function pacienteLogado() {
  const T = await novoTenant(db);
  const { paciente, email } = await pacienteComConta(db, T);
  return { T, paciente, cookie: await entrar(auth, email) };
}
function enviar(campos: Record<string, string | Blob>, o: { cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return POST(
    new Request('http://localhost:3000/api/p/diario', {
      method: 'POST',
      body: f,
      headers: { ...(o.cookie ? { cookie: o.cookie } : {}), origin: o.origin ?? 'http://localhost:3000', ...o.headers },
    }),
  );
}
const registros = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, patientId)), db);

describe('POST /api/p/diario (US-042)', () => {
  it('sem sessão → 401; outra origem → 403; nada gravado', async () => {
    const A = await pacienteLogado();
    expect((await enviar({ refeicao: 'Almoço', texto: 'arroz' })).status).toBe(401);
    expect((await enviar({ refeicao: 'Almoço', texto: 'arroz' }, { cookie: A.cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect(await registros(A.T, A.paciente.id)).toEqual([]);
  });

  it('content-length acima de 10 MB + 64 KB → 413 com a mensagem da foto; PDF no campo foto → 415', async () => {
    const A = await pacienteLogado();
    const grande = await enviar({ refeicao: 'Almoço', texto: 'arroz' }, { cookie: A.cookie, headers: { 'content-length': String(10 * 1024 * 1024 + 64 * 1024 + 1) } });
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ erros: { foto: MSG_DIARIO.foto } });
    const pdf = await enviar({ refeicao: 'Almoço', texto: 'arroz', foto: PDF() }, { cookie: A.cookie });
    expect(pdf.status).toBe(415);
    expect(await pdf.json()).toEqual({ erros: { foto: MSG_DIARIO.foto } });
    expect(await registros(A.T, A.paciente.id)).toEqual([]);
  });

  it('texto + JPEG válido → 200 "Registro salvo."; o 11º do dia → 409 com o limite', async () => {
    const A = await pacienteLogado();
    const r = await enviar({ refeicao: 'Almoço', texto: 'arroz, feijão', foto: JPEG() }, { cookie: A.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ ok: true, mensagem: MSG_DIARIO.salvo, semFoto: false });
    for (let i = 1; i < 10; i++) expect((await enviar({ refeicao: 'Outro', texto: `item ${i}` }, { cookie: A.cookie })).status).toBe(200);
    const onze = await enviar({ refeicao: 'Outro', texto: 'mais um' }, { cookie: A.cookie });
    expect(onze.status).toBe(409);
    expect(await onze.json()).toEqual({ erros: { geral: MSG_DIARIO.limite } });
    expect(await registros(A.T, A.paciente.id)).toHaveLength(10);
  });

  it('R9: cota esgotada com texto → 200, salvo sem a foto e com o texto da spec; só a foto → 507', async () => {
    const A = await pacienteLogado();
    await db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, A.T.tenantId));
    const r = await enviar({ refeicao: 'Jantar', texto: 'sopa', foto: JPEG() }, { cookie: A.cookie });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ mensagem: `${MSG_DIARIO.salvoSemFoto} ${MSG_COTA_ESGOTADA}`, semFoto: true });
    const so = await enviar({ refeicao: 'Jantar', foto: JPEG() }, { cookie: A.cookie });
    expect(so.status).toBe(507);
    expect(await so.json()).toEqual({ erros: { foto: MSG_COTA_ESGOTADA } });
    expect((await registros(A.T, A.paciente.id)).map((e) => [e.texto, e.fotoStatus])).toEqual([['sopa', 'sem_foto']]);
  });
});
