import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
const execute = vi.fn();
const where = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/db/client', () => ({ getDb: () => ({ execute, select: () => ({ from: () => ({ where }) }) }) }));
const { GET } = await import('./route');

/** O que o Drizzle lança: a mensagem traz a consulta e os parâmetros; o código do pg fica em `cause`. */
function erroDoDrizzle(code: string): Error {
  return new Error('Failed query: select "name", "beat_at" from "system_heartbeat" where "name" = $1\nparams: worker', { cause: Object.assign(new Error('permission denied for table system_heartbeat'), { code }) });
}

beforeEach(() => {
  warn.mockReset();
  execute.mockReset().mockResolvedValue({ rows: [] });
  where.mockReset();
});

describe('GET /api/health (RNF-04)', () => {
  it('heartbeat recente: 200 "ok", sem log', async () => {
    where.mockResolvedValue([{ name: 'worker', beatAt: new Date() }]);
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'ok' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('select 1 passa e a leitura do heartbeat falha: 503 "heartbeat ilegível" e o SQLSTATE no log, sem a mensagem', async () => {
    where.mockRejectedValue(erroDoDrizzle('42501'));
    const r = await GET();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ status: 'degradado', reason: 'heartbeat ilegível' });
    expect(warn).toHaveBeenCalledWith({ motivo: '42501', leitura: 'heartbeat' }, 'health: leitura do banco falhou');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/permission|system_heartbeat|params/);
  });

  it('banco fora: 503 "banco indisponível" e o código da conexão no log', async () => {
    execute.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }));
    const r = await GET();
    expect(await r.json()).toEqual({ status: 'degradado', reason: 'banco indisponível' });
    expect(warn).toHaveBeenCalledWith({ motivo: 'ECONNREFUSED', leitura: 'banco' }, 'health: leitura do banco falhou');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('10.0.0.5');
  });
});
