import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const execFile = promisify(execFileCb);
const tem = (cmd: string) => {
  try {
    execFileSync(cmd, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const temRclone = tem('rclone');
if (process.env.CI && !temRclone) throw new Error('rclone é obrigatório no CI (teste da restauração, P08-04)');

const BACKUP = path.resolve('scripts/backup/nutri-backup.sh');
const RESTAURAR = path.resolve('scripts/backup/nutri-restauracao-teste.sh');

describe.skipIf(!temRclone)('teste de restauração (RNF-05, P08-04)', () => {
  let base = '';
  let env = {} as NodeJS.ProcessEnv;
  // Cópia do banco de teste no mesmo container: o backup daqui registra em backup_runs da CÓPIA. No banco de teste, as
  // linhas cairiam na janela das "execuções desde a referência" do test/backup.test.ts, que roda ao mesmo tempo (X-1)
  const container = inject('pgContainerId');
  const usuario = inject('pgUser');
  const copia = `nd_restaura_${randomBytes(4).toString('hex')}`;
  const noContainer = (...args: string[]) => execFile('docker', ['exec', container, ...args], { env: process.env });

  beforeAll(async () => {
    // Regra 10: com NUTRI_DB_CONTAINER vazio o nutri-backup.sh procura o container pelo nome (nutri_db = PRODUÇÃO neste
    // host). Falha aqui, antes de qualquer docker exec, e o filtro abaixo não casa com nenhum container.
    if (!/^[0-9a-f]{12,64}$/.test(container)) throw new Error('container do Testcontainers ausente: o backup não roda (regra 10)');
    await noContainer('createdb', '-U', usuario, copia);
    await noContainer(
      'sh', '-c', 'pg_dump -U "$1" -d "$2" -Fc | pg_restore -U "$1" -d "$3" --exit-on-error', 'sh', usuario, inject('pgDatabase'), copia,
    );
    base = mkdtempSync(path.join(tmpdir(), 'nd-restaura-'));
    const destino = path.join(base, 'r2');
    const dados = path.join(base, 'data');
    mkdirSync(destino);
    mkdirSync(path.join(dados, 't1', 'logo'), { recursive: true });
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'x');
    const senha = execFileSync('rclone', ['obscure', randomBytes(24).toString('hex')]).toString().trim();
    env = {
      PATH: process.env.PATH,
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      HOME: base,
      RCLONE_CONFIG: path.join(base, 'rclone.conf'),
      RCLONE_CONFIG_CRIPTO_TYPE: 'crypt',
      RCLONE_CONFIG_CRIPTO_REMOTE: destino,
      RCLONE_CONFIG_CRIPTO_PASSWORD: senha,
      NUTRI_BACKUP_REMOTE: 'cripto:',
      NUTRI_DATA_DIR: dados,
      NUTRI_DB_CONTAINER: container,
      NUTRI_DB_CONTAINER_FILTER: `nao-existe-${randomBytes(6).toString('hex')}`, // regra 10: o fallback nunca acha o nutri_db
      NUTRI_DB_USER: usuario,
      NUTRI_DB_NAME: copia,
      NUTRI_BACKUP_TODAY: '2026-10-04',
    } as unknown as NodeJS.ProcessEnv;
    await execFile('bash', [BACKUP], { env }); // o backup do banco de teste (Testcontainers), nunca o de produção
  }, 180_000);
  afterAll(async () => {
    if (base) rmSync(base, { recursive: true, force: true });
    await noContainer('dropdb', '-U', usuario, '--if-exists', '--force', copia).catch(() => undefined);
  });

  it('restaura num banco descartável sem rede, confere a RLS e os roles e só imprime contagens', async () => {
    // Testcontainers migra como superusuário: as funções SECURITY DEFINER têm dono superusuário só aqui (em produção, 0)
    const r = await execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2026-10-04', NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER: '1' }, timeout: 170_000 });
    const saida = `${r.stdout}${r.stderr}`;
    expect(saida).toMatch(/restauracao ok: duracao=\d+s tabelas_sem_rls=0 migrations=\d+ tenants=\d+ pacientes=\d+ funcoes_definer_superusuario=\d+ roles=ok/);
    expect(saida).not.toMatch(/PASSWORD|senha|@/i);
    const sobra = execFileSync('docker', ['ps', '-a', '--filter', 'name=nutri_restauracao_teste', '--format', '{{.Names}}'], { env }).toString().trim();
    expect(sobra).toBe(''); // o container (com dado restaurado) não fica
  }, 180_000);

  it('sem a permissão do CI, função SECURITY DEFINER com dono superusuário reprova a restauração', async () => {
    const r = execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2026-10-04' }, timeout: 170_000 });
    await expect(r).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('função SECURITY DEFINER com dono superusuário') });
  }, 180_000);

  it('globais.sql vazio conta como ausente: AVISO (criar os roles à mão), não "roles aplicados"', async () => {
    const cripto = (args: string[]) => execFile('rclone', args, { env, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    const bom = (await cripto(['cat', 'cripto:db/globais.sql'])).stdout as unknown as Buffer;
    const regravar = (conteudo: Buffer | string) =>
      new Promise<void>((ok, falha) => {
        const c = execFileCb('rclone', ['rcat', 'cripto:db/globais.sql'], { env }, (e) => (e ? falha(e) : ok()));
        c.stdin?.end(conteudo);
      });
    await regravar(''); // backup antigo que gravou o dump de roles vazio
    try {
      const r = await execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2026-10-04', NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER: '1' }, timeout: 170_000 }).then(
        () => ({ code: 0, stdout: '' }),
        (e: { code?: number; stdout?: string }) => ({ code: e.code ?? 1, stdout: e.stdout ?? '' }),
      );
      expect(r.code).toBe(1); // sem os roles, o pg_restore não passa
      expect(r.stdout).toContain('AVISO: sem db/globais.sql');
      expect(r.stdout).not.toContain('roles aplicados');
    } finally {
      await regravar(bom);
    }
  }, 180_000);

  it('dia sem dump: sai com erro e mensagem fixa', async () => {
    await expect(execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2001-01-01' } })).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('ERRO: dump do dia não encontrado'),
    });
  }, 120_000);
});
