import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { novoTenant } from '../../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../../test/portal';
import { entrar } from '../../../../../../../test/sessao';
import { envioNoBanco, envioRecebido } from '../../../../../../../test/exames-enviados';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-pdf-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
const baixar = (id: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/p/exames/${id}/pdf`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) } as RouteContext<'/api/p/exames/[id]/pdf'>);

describe('GET /api/p/exames/{id}/pdf (D17 = a, RN-169)', () => {
  it('o próprio envio "recebido" → 303 para a URL assinada; aceito, de outro paciente ou sem sessão → 404/401', async () => {
    const T = await novoTenant(db);
    const { paciente, email } = await pacienteComConta(db, T);
    const cookie = await entrar(auth, email);
    const rec = await envioRecebido(db, T.ctx, paciente.id, dataDir);
    const r = await baixar(rec.id, cookie);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/^\/api\/arquivos\?c=/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const aceito = await envioNoBanco(db, T.ctx, paciente.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect((await baixar(aceito, cookie)).status).toBe(404);
    const outro = await pacienteComConta(db, T);
    const doOutro = await envioRecebido(db, T.ctx, outro.paciente.id, dataDir);
    expect((await baixar(doOutro.id, cookie)).status).toBe(404);
    expect((await baixar(rec.id)).status).toBe(401);
  });
});
