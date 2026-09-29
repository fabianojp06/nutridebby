import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from './db';

const execFile = promisify(execFileCb);
const temRclone = (() => {
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
// No CI o teste não pode sumir em silêncio; local (host de produção sem rclone) ele é pulado.
if (process.env.CI && !temRclone) throw new Error('rclone é obrigatório no CI (teste do backup, P02-10)');

const SCRIPT = path.resolve('scripts/backup/nutri-backup.sh');

describe.skipIf(!temRclone)('backup diário no host (RNF-05)', () => {
  let owner: ReturnType<typeof makeDb>;
  let base = '';
  let destino = '';
  let dados = '';
  let env = {} as NodeJS.ProcessEnv;

  beforeAll(() => {
    owner = makeDb(inject('ownerDatabaseUrl'));
    base = mkdtempSync(path.join(tmpdir(), 'nd-backup-'));
    destino = path.join(base, 'r2'); // o "bucket": pasta local por baixo do remoto crypt
    dados = path.join(base, 'data');
    mkdirSync(destino);
    mkdirSync(path.join(dados, 't1', 'logo'), { recursive: true });
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'versao-1');
    writeFileSync(path.join(dados, 't1', 'logo', 'b.png'), 'sera-apagado');
    // Senha do crypt gerada agora, só para este teste
    const senha = execFileSync('rclone', ['obscure', randomBytes(24).toString('hex')]).toString().trim();
    env = {
      PATH: process.env.PATH,
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}), // mesmo Docker do Testcontainers
      HOME: base,
      RCLONE_CONFIG: path.join(base, 'rclone.conf'),
      RCLONE_CONFIG_CRIPTO_TYPE: 'crypt',
      RCLONE_CONFIG_CRIPTO_REMOTE: destino,
      RCLONE_CONFIG_CRIPTO_PASSWORD: senha,
      NUTRI_BACKUP_REMOTE: 'cripto:',
      NUTRI_DATA_DIR: dados,
      NUTRI_DB_CONTAINER: inject('pgContainerId'),
      NUTRI_DB_USER: inject('pgUser'),
      NUTRI_DB_NAME: inject('pgDatabase'),
    } as unknown as NodeJS.ProcessEnv;
  });
  afterAll(async () => {
    if (base) rmSync(base, { recursive: true, force: true });
    await owner?.pool.end();
  });

  const rodar = (hoje: string, extra: Record<string, string> = {}) =>
    execFile('bash', [SCRIPT], { env: { ...env, NUTRI_BACKUP_TODAY: hoje, ...extra } }).then(
      () => 0,
      (e: { code?: number }) => e.code ?? 1,
    );
  const lsf = async (p: string) =>
    (await execFile('rclone', ['lsf', `cripto:${p}`], { env })).stdout.split('\n').filter(Boolean).sort();
  const cat = async (p: string) =>
    (await execFile('rclone', ['cat', `cripto:${p}`], { env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout as unknown as Buffer;
  const rcat = (p: string, conteudo: string) =>
    new Promise<void>((ok, falha) => {
      const c = execFileCb('rclone', ['rcat', `cripto:${p}`], { env }, (e) => (e ? falha(e) : ok()));
      c.stdin?.end(conteudo);
    });
  const arquivosBrutos = (dir: string) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => path.join(d.parentPath, d.name));
  const execucoesDesde = async (desde: Date) =>
    (await owner.pool.query(`select tipo, ok from backup_runs where concluido_em >= $1 order by tipo`, [desde])).rows;

  it('o script é bash válido', async () => {
    await expect(execFile('bash', ['-n', SCRIPT])).resolves.toBeTruthy();
  });

  it('domingo: dump cifrado no diário e no semanal, /data sincronizado, retenção 7+4, registro em backup_runs', async () => {
    for (let d = 20; d <= 27; d++) await rcat(`db/diario/nutri-2026-09-${d}.dump`, 'antigo'); // 8 diários antigos
    for (const d of ['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']) await rcat(`db/semanal/nutri-${d}.dump`, 'antigo');
    const antes = new Date(Date.now() - 1000);
    expect(await rodar('2026-10-04')).toBe(0); // 04/10/2026 é domingo
    const diarios = await lsf('db/diario/');
    expect(diarios).toHaveLength(7);
    expect(diarios[0]).toBe('nutri-2026-09-22.dump');
    expect(diarios.at(-1)).toBe('nutri-2026-10-04.dump');
    expect(await lsf('db/semanal/')).toEqual(['nutri-2026-09-13.dump', 'nutri-2026-09-20.dump', 'nutri-2026-09-27.dump', 'nutri-2026-10-04.dump']);
    expect((await cat('db/diario/nutri-2026-10-04.dump')).subarray(0, 5).toString()).toBe('PGDMP');
    // No "R2" nada é legível: nomes e conteúdo cifrados
    const brutos = arquivosBrutos(destino);
    expect(brutos.length).toBeGreaterThan(0);
    expect(brutos.some((f) => /nutri-|a\.png|diario/.test(path.relative(destino, f)))).toBe(false);
    expect(brutos.some((f) => readFileSync(f).includes('PGDMP'))).toBe(false);
    expect(await lsf('data/atual/t1/logo/')).toEqual(['a.png', 'b.png']);
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: true }]);
  });

  it('dia seguinte: alterado/apagado vai para o histórico datado; histórico com mais de 30 dias sai; segunda não gera semanal', async () => {
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'versao-2');
    rmSync(path.join(dados, 't1', 'logo', 'b.png'));
    await rcat('data/historico/2026-08-01/velho.txt', 'x');
    expect(await rodar('2026-10-05')).toBe(0);
    expect(await lsf('data/atual/t1/logo/')).toEqual(['a.png']);
    expect((await cat('data/atual/t1/logo/a.png')).toString()).toBe('versao-2');
    expect(await lsf('data/historico/2026-10-05/t1/logo/')).toEqual(['a.png', 'b.png']);
    expect((await cat('data/historico/2026-10-05/t1/logo/a.png')).toString()).toBe('versao-1');
    expect(await lsf('data/historico/')).not.toContain('2026-08-01/');
    expect(await lsf('db/semanal/')).not.toContain('nutri-2026-10-05.dump');
  });

  it('falha no dump: registra ok=false, não deixa arquivo parcial, ainda copia /data e sai com erro', async () => {
    const antes = new Date(Date.now() - 1000);
    const codigo = await rodar('2026-10-06', { NUTRI_PG_DUMP_ARGS: '--table=tabela_que_nao_existe --strict-names' });
    expect(codigo).toBe(1);
    expect(await lsf('db/diario/')).not.toContain('nutri-2026-10-06.dump');
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: false }]);
  });
});

describe('backup_runs é escrita só pelo script do host', () => {
  it('o role da aplicação lê, mas não insere, altera nem apaga', async () => {
    const app = makeDb(inject('appDatabaseUrl'));
    try {
      await expect(app.pool.query('select count(*) from backup_runs')).resolves.toBeTruthy();
      await expect(
        app.pool.query(`insert into backup_runs (tipo, ok, iniciado_em) values ('banco', true, now())`),
      ).rejects.toThrow(/permission denied/);
      await expect(app.pool.query(`update backup_runs set ok = false`)).rejects.toThrow(/permission denied/);
      await expect(app.pool.query(`delete from backup_runs`)).rejects.toThrow(/permission denied/);
    } finally {
      await app.pool.end();
    }
  });
});
