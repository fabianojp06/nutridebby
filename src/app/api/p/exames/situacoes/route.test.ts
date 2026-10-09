import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { novoTenant } from '../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../test/portal';
import { entrar } from '../../../../../../test/sessao';
import { envioNoBanco } from '../../../../../../test/exames-enviados';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
const consultar = (cookie?: string) => GET(new Request('http://localhost:3000/api/p/exames/situacoes', { headers: cookie ? { cookie } : {} }));

describe('GET /api/p/exames/situacoes (hotfix 09/10/2026: só a situação, sem auditoria)', () => {
  it('devolve só id e status dos envios do paciente da sessão (sem cancelados nem os de outro paciente) e não grava em audit_log', async () => {
    const T = await novoTenant(db);
    const { paciente, email } = await pacienteComConta(db, T);
    const cookie = await entrar(auth, email);
    const processando = await envioNoBanco(db, T.ctx, paciente.id, { status: 'processando', observacao: 'texto do paciente' });
    const recebido = await envioNoBanco(db, T.ctx, paciente.id, { status: 'recebido' });
    await envioNoBanco(db, T.ctx, paciente.id, { status: 'cancelado' });
    const outro = await pacienteComConta(db, T);
    const doOutro = await envioNoBanco(db, T.ctx, outro.paciente.id, { status: 'processando' });
    const auditoria = () =>
      withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.patientId, paciente.id), eq(auditLog.acao, 'ler'))), db);
    const antes = (await auditoria()).length;

    const r = await consultar(cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = (await r.json()) as Record<string, unknown>[];
    expect(corpo.map((e) => Object.keys(e).sort())).toEqual([['id', 'status'], ['id', 'status']]);
    expect(corpo).toEqual(expect.arrayContaining([{ id: processando, status: 'processando' }, { id: recebido, status: 'recebido' }]));
    expect(corpo.map((e) => e.id)).not.toContain(doOutro);
    expect((await auditoria()).length).toBe(antes);
  });

  it('sem sessão: a recusa de sempre das rotas do portal (401)', async () => {
    expect((await consultar()).status).toBe(401);
  });
});
