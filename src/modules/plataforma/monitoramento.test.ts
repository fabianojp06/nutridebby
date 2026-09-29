import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../../test/db';
import { user } from '@/db/schema';
import {
  backupsFaltando, emailsDosAdmins, percentualDisco, statfsDoDiretorio, verificarBackups, verificarDisco,
} from './monitoramento';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // backup_runs é só leitura para o app
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});
// Datas de 2020: não se misturam com as execuções reais do test/backup.test.ts
const H = 3600_000;
const agora = new Date('2020-01-10T10:00:00Z');
const registrar = (tipo: string, ok: boolean, quando: Date, detalhe: string | null = null) =>
  owner.pool.query(`insert into backup_runs (tipo, ok, detalhe, iniciado_em, concluido_em) values ($1, $2, $3, $4, $4)`, [tipo, ok, detalhe, quando]);

describe('verificação do backup (RNF-05)', () => {
  it('aponta o que não teve backup ok nas últimas 26 h (falha não conta)', async () => {
    await registrar('banco', true, new Date(agora.getTime() - 2 * H));
    await registrar('arquivos', false, new Date(agora.getTime() - 1 * H), 'retenção falhou');
    await registrar('arquivos', true, new Date(agora.getTime() - 27 * H));
    expect(await backupsFaltando(app.db, agora)).toEqual(['arquivos']);
    expect(await backupsFaltando(app.db, new Date(agora.getTime() + 25 * H))).toEqual(['arquivos', 'banco']);
  });
  it('avisa só quando falta, sem repetir o detalhe gravado pelo script', async () => {
    const avisar = vi.fn(async () => undefined);
    await verificarBackups({ db: app.db, now: agora, avisar });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('arquivos'));
    expect(avisar).not.toHaveBeenCalledWith(expect.stringContaining('retenção'));
    avisar.mockClear();
    await registrar('arquivos', true, new Date(agora.getTime() - H / 2));
    await verificarBackups({ db: app.db, now: agora, avisar });
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe('alerta de disco em 70% (RNF-13)', () => {
  it('percentual como o df', () => {
    expect(percentualDisco({ blocks: 100, bfree: 30, bavail: 25 })).toBe(74);
    expect(percentualDisco({ blocks: 100, bfree: 40, bavail: 40 })).toBe(60);
  });
  it('avisa ao passar de 70% no máximo uma vez a cada 24 h', async () => {
    const avisar = vi.fn(async () => undefined);
    const disco = (pct: number) => async () => ({ blocks: 100, bfree: 100 - pct, bavail: 100 - pct });
    const t0 = new Date('2020-02-01T00:00:00Z');
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco(69), avisar })).toEqual({ percentual: 69, alertou: false });
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco(74), avisar })).toEqual({ percentual: 74, alertou: true });
    expect(await verificarDisco({ db: app.db, now: new Date(t0.getTime() + 23 * H), statfs: disco(80), avisar })).toEqual({ percentual: 80, alertou: false });
    expect(await verificarDisco({ db: app.db, now: new Date(t0.getTime() + 24 * H), statfs: disco(80), avisar })).toEqual({ percentual: 80, alertou: true });
    expect(avisar).toHaveBeenCalledTimes(2);
    expect(avisar).toHaveBeenLastCalledWith(80);
  });
  it('mede o ancestral existente quando DATA_DIR ainda não existe (sem ENOENT)', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'monitor-'));
    try {
      const s = await statfsDoDiretorio(path.join(base, 'ainda', 'nao', 'existe'));
      expect(percentualDisco(s)).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('emailsDosAdmins', () => {
  it('lista os e-mails de quem tem papel admin', async () => {
    const id = randomUUID();
    await app.db.insert(user).values({ id, name: 'Adm', email: `adm-${id.slice(0, 8)}@teste.dev`, appRole: 'admin' });
    expect(await emailsDosAdmins(app.db)).toContain(`adm-${id.slice(0, 8)}@teste.dev`);
  });
});
