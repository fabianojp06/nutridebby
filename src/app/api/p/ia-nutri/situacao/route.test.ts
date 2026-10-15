import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { mensagemNoBanco } from '../../../../../../test/ia-nutri';
import { novoTenant } from '../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../test/portal';
import { entrar } from '../../../../../../test/sessao';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
const consultar = (cookie?: string) => GET(new Request('http://localhost:3000/api/p/ia-nutri/situacao', { headers: cookie ? { cookie } : {} }));

describe('GET /api/p/ia-nutri/situacao (RNF-160: só a situação, sem auditoria)', () => {
  it('devolve só id e status das perguntas do paciente da sessão (nem respostas, nem as de outro paciente) e não grava em audit_log', async () => {
    const T = await novoTenant(db);
    const { paciente, email } = await pacienteComConta(db, T);
    const cookie = await entrar(auth, email);
    const respondida = await mensagemNoBanco(db, T.tenantId, paciente.id, { status: 'respondida', createdAt: new Date(Date.now() - 60_000) });
    const naFila = await mensagemNoBanco(db, T.tenantId, paciente.id, { status: 'na_fila' });
    await mensagemNoBanco(db, T.tenantId, paciente.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…' });
    const outro = await pacienteComConta(db, T);
    const doOutro = await mensagemNoBanco(db, T.tenantId, outro.paciente.id, { status: 'processando' });
    const auditoria = () => withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(like(auditLog.entidade, 'ia_nutri%'), eq(auditLog.patientId, paciente.id))), db);
    const antes = (await auditoria()).length;

    const r = await consultar(cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = (await r.json()) as Record<string, unknown>[];
    expect(corpo).toEqual([{ id: naFila, status: 'na_fila' }, { id: respondida, status: 'respondida' }]);
    expect(corpo.map((e) => e.id)).not.toContain(doOutro);
    expect((await auditoria()).length).toBe(antes);
  });

  it('sem sessão: a recusa de sempre das rotas do portal (401)', async () => {
    expect((await consultar()).status).toBe(401);
  });
});
