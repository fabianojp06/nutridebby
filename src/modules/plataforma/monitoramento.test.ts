import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../../test/db';
import { closeDb, type Tx } from '@/db/client';
import { eq } from 'drizzle-orm';
import { systemHeartbeat, user } from '@/db/schema';
import { EMAIL_FINALIDADE, enqueueEmail } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';
import {
  avisarAdmins, backupsFaltando, emailsDosAdmins, percentualDisco, statfsDoDiretorio, verificarBackups, verificarDisco,
} from './monitoramento';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // backup_runs é só leitura para o app
afterAll(async () => {
  await stopBoss();
  await closeDb();
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
    const avisar = vi.fn(async () => 1);
    await verificarBackups({ db: app.db, now: agora, avisar });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('arquivos'));
    expect(avisar).not.toHaveBeenCalledWith(expect.stringContaining('retenção'));
    avisar.mockClear();
    await registrar('arquivos', true, new Date(agora.getTime() - H / 2));
    await verificarBackups({ db: app.db, now: agora, avisar });
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe('última execução por tipo (falha depois de ok recente)', () => {
  const t = new Date('2020-03-01T10:00:00Z');
  it('reporta o tipo cuja falha veio depois de um ok dentro da janela e limpa quando volta a dar certo', async () => {
    await registrar('banco', true, new Date(t.getTime() - 5 * H));
    await registrar('banco', false, new Date(t.getTime() - 1 * H), 'retenção falhou');
    await registrar('arquivos', true, new Date(t.getTime() - 3 * H));
    expect(await backupsFaltando(app.db, t)).toEqual(['banco']);
    await registrar('banco', true, new Date(t.getTime() - H / 2));
    expect(await backupsFaltando(app.db, t)).toEqual([]);
  });
});

describe('alerta de disco em 70% (RNF-13)', () => {
  it('percentual como o df', () => {
    expect(percentualDisco({ blocks: 100, bfree: 30, bavail: 25 })).toBe(74);
    expect(percentualDisco({ blocks: 100, bfree: 40, bavail: 40 })).toBe(60);
    // como o df: arredonda para cima (69,4% aparece como 70 e já alerta)
    expect(percentualDisco({ blocks: 1000, bfree: 306, bavail: 306 })).toBe(70);
    expect(percentualDisco({ blocks: 1000, bfree: 301, bavail: 301 })).toBe(70);
    expect(percentualDisco({ blocks: 1000, bfree: 300, bavail: 300 })).toBe(70);
    expect(percentualDisco({ blocks: 1000, bfree: 310, bavail: 310 })).toBe(69);
  });
  /** Simula `avisarAdmins` com `n` destinatários: grava a marca numa transação só se houve e-mail. */
  const avisarCom = (n: number) =>
    vi.fn(async (_percentual: number, marcar: (tx: Tx) => Promise<unknown>) => {
      if (n > 0) await app.db.transaction(marcar);
      return n;
    });
  it('avisa ao passar de 70% no máximo uma vez a cada 24 h', async () => {
    const avisar = avisarCom(1);
    const disco = (pct: number) => async () => ({ blocks: 100, bfree: 100 - pct, bavail: 100 - pct });
    const t0 = new Date('2020-02-01T00:00:00Z');
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco(69), avisar })).toEqual({ percentual: 69, alertou: false });
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco(74), avisar })).toEqual({ percentual: 74, alertou: true });
    expect(await verificarDisco({ db: app.db, now: new Date(t0.getTime() + 23 * H), statfs: disco(80), avisar })).toEqual({ percentual: 80, alertou: false });
    expect(await verificarDisco({ db: app.db, now: new Date(t0.getTime() + 24 * H), statfs: disco(80), avisar })).toEqual({ percentual: 80, alertou: true });
    expect(avisar).toHaveBeenCalledTimes(2);
    expect(avisar).toHaveBeenLastCalledWith(80, expect.any(Function));
  });
  it('sem destinatário (0 enfileirados) não grava a marca: o alerta sai assim que houver admin (F6)', async () => {
    const disco = async () => ({ blocks: 100, bfree: 20, bavail: 20 });
    const t0 = new Date('2021-01-01T00:00:00Z'); // bem depois da marca do teste acima (2020)
    const semAdmin = avisarCom(0);
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco, avisar: semAdmin })).toEqual({ percentual: 80, alertou: false });
    const comAdmin = avisarCom(1);
    const depois = new Date(t0.getTime() + H);
    expect(await verificarDisco({ db: app.db, now: depois, statfs: disco, avisar: comAdmin })).toEqual({ percentual: 80, alertou: true });
    expect(comAdmin).toHaveBeenCalledWith(80, expect.any(Function));
  });
  it('a marca de 24 h confirma na mesma transação dos e-mails: falhou a marca, nenhum e-mail fica na fila (G4)', async () => {
    const id = randomUUID();
    await app.db.insert(user).values({ id, name: 'Adm', email: `adm-${id.slice(0, 8)}@teste.dev`, appRole: 'admin' });
    const painelUrl = `http://x/${randomUUID()}/admin`; // identifica os e-mails deste teste na fila
    const disco = async () => ({ blocks: 100, bfree: 10, bavail: 10 });
    const avisar = (percentual: number, marcar: (tx: Tx) => Promise<unknown>) =>
      avisarAdmins(app.db, (para) => ({ tipo: 'alerta_disco', para, percentual, painelUrl }), undefined, marcar);
    const naFila = async () =>
      (await (await getBoss()).findJobs<EmailJobData>('email'))
        .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
        .filter((m) => m.tipo === 'alerta_disco' && m.painelUrl === painelUrl).length;
    // Data inválida: os e-mails enfileiram, mas gravar a marca falha (toISOString lança)
    await expect(verificarDisco({ db: app.db, now: new Date(Number.NaN), statfs: disco, avisar })).rejects.toThrow();
    expect(await naFila()).toBe(0); // antes: os e-mails já confirmados e a nova tentativa duplicava o alerta
    const t = new Date('2022-01-01T00:00:00Z');
    expect(await verificarDisco({ db: app.db, now: t, statfs: disco, avisar })).toEqual({ percentual: 90, alertou: true });
    expect(await naFila()).toBeGreaterThanOrEqual(1);
    const [marca] = await app.db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'alerta_disco'));
    expect(marca.beatAt.getTime()).toBe(t.getTime());
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

describe('avisarAdmins (F5)', () => {
  const marcador = () => `teste-${randomUUID()}`;
  const alertasCom = async (detalhe: string) =>
    (await (await getBoss()).findJobs<EmailJobData>('email'))
      .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
      .filter((m) => m.tipo === 'alerta_backup' && m.detalhe === detalhe);
  const novoAdmin = async () => {
    const id = randomUUID();
    await app.db.insert(user).values({ id, name: 'Adm', email: `adm-${id.slice(0, 8)}@teste.dev`, appRole: 'admin' });
  };

  it('enfileira um e-mail por admin e devolve quantos', async () => {
    await novoAdmin();
    await novoAdmin();
    const detalhe = marcador();
    const n = await avisarAdmins(app.db, (para) => ({ tipo: 'alerta_backup', para, detalhe, painelUrl: 'http://x/admin' }));
    expect(n).toBe((await emailsDosAdmins(app.db)).length);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await alertasCom(detalhe)).toHaveLength(n);
  });

  it('falha no meio: nenhum e-mail fica na fila (a nova tentativa do job não duplica)', async () => {
    await novoAdmin();
    await novoAdmin();
    const detalhe = marcador();
    let chamadas = 0;
    await expect(
      avisarAdmins(
        app.db,
        (para) => ({ tipo: 'alerta_backup', para, detalhe, painelUrl: 'http://x/admin' }),
        async (msg, tx) => {
          if (++chamadas === 2) throw new Error('fila caiu no segundo');
          return enqueueEmail(msg, { tx });
        },
      ),
    ).rejects.toThrow('fila caiu no segundo');
    expect(chamadas).toBe(2);
    expect(await alertasCom(detalhe)).toEqual([]);
  });
});
