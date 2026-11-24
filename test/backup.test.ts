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
      // SUS-107: o banco do Vitest é um só para todos os arquivos, e o dump dele inteiro crescia com os dados dos outros
      // testes (3,8 s com 14 MB, 14,5 s com 254 MB) até estourar o prazo sob carga. Aqui o dump passa só pela tabela que
      // estes testes controlam — o caminho (pg_dump -Fc no container → crypt → retenção → registro) é o mesmo. O script
      // com o dump do banco INTEIRO (sem NUTRI_PG_DUMP_ARGS, como roda no host) tem um caso só, o último, com prazo
      // próprio; o dump inteiro restaurado de verdade é provado em test/restauracao.test.ts (que faz o próprio pg_dump,
      // sem o script). Quem precisa de outros argumentos (falha no dump) passa os seus.
      NUTRI_PG_DUMP_ARGS: '--table=backup_runs',
    } as unknown as NodeJS.ProcessEnv;
  });
  afterAll(async () => {
    if (base) rmSync(base, { recursive: true, force: true });
    await owner?.pool.end();
  });

  /** Código de saída e tudo o que o script escreveu (stdout + stderr, o que iria para o journal). */
  const rodarComSaida = (hoje: string, extra: Record<string, string> = {}) =>
    execFile('bash', [SCRIPT], { env: { ...env, NUTRI_BACKUP_TODAY: hoje, ...extra } }).then(
      (r) => ({ codigo: 0, saida: `${r.stdout}${r.stderr}` }),
      (e: { code?: number; stdout?: string; stderr?: string }) => ({ codigo: e.code ?? 1, saida: `${e.stdout ?? ''}${e.stderr ?? ''}` }),
    );
  const rodar = async (hoje: string, extra: Record<string, string> = {}) => (await rodarComSaida(hoje, extra)).codigo;
  /** rclone "falso" no PATH: repassa tudo ao real, exceto o subcomando que deve falhar. Nada é instalado. */
  const rcloneQueFalhaEm = (subcomando: string) => {
    const real = execFileSync('bash', ['-c', 'command -v rclone']).toString().trim();
    const bin = mkdtempSync(path.join(base, 'fakebin-'));
    writeFileSync(path.join(bin, 'rclone'), `#!/usr/bin/env bash\n[ "$1" = ${subcomando} ] && { echo "segredo-no-stderr" >&2; exit 1; }\nexec "${real}" "$@"\n`, { mode: 0o755 });
    return `${bin}:${process.env.PATH}`;
  };
  /** docker "falso" no PATH: falha só no `docker exec <container> <programa>` (depois de escrever `parcial` no stdout,
   *  como um dump que cai no meio); o resto vai ao real. */
  const dockerQueFalhaEm = (programa: string, parcial = '') => {
    const real = execFileSync('bash', ['-c', 'command -v docker']).toString().trim();
    const bin = mkdtempSync(path.join(base, 'fakebin-'));
    writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash\n[ "$1" = exec ] && [ "$3" = ${programa} ] && { printf '%s' '${parcial}'; echo "segredo-no-stderr" >&2; exit 1; }\nexec "${real}" "$@"\n`, { mode: 0o755 });
    return `${bin}:${process.env.PATH}`;
  };
  const lsf = async (p: string) =>
    (await execFile('rclone', ['lsf', `cripto:${p}`], { env })).stdout.split('\n').filter(Boolean).sort();
  const cat = async (p: string) =>
    (await execFile('rclone', ['cat', `cripto:${p}`], { env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout as unknown as Buffer;
  /** Vários arquivos no remoto com um `rclone copy` só (um rcat por arquivo era um processo do rclone, e o crypt, cada). */
  const semear = async (arquivos: Record<string, string>) => {
    const origem = mkdtempSync(path.join(base, 'semente-'));
    for (const [p, conteudo] of Object.entries(arquivos)) {
      mkdirSync(path.dirname(path.join(origem, p)), { recursive: true });
      writeFileSync(path.join(origem, p), conteudo);
    }
    await execFile('rclone', ['copy', origem, 'cripto:'], { env });
    rmSync(origem, { recursive: true, force: true });
  };
  const rcat = (p: string, conteudo: string) =>
    new Promise<void>((ok, falha) => {
      const c = execFileCb('rclone', ['rcat', `cripto:${p}`], { env }, (e) => (e ? falha(e) : ok()));
      c.stdin?.end(conteudo);
    });
  const arquivosBrutos = (dir: string) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => path.join(d.parentPath, d.name));
  // Ponto de referência tirado do relógio do próprio banco (texto preserva os microssegundos), não o do host: o
  // script grava `concluido_em` com o now() do banco, sempre depois daqui. X-1: não usar max(concluido_em) — com a
  // tabela vazia ele vira -infinity e as linhas datadas de 2020 que o monitoramento.test.ts grava ao mesmo tempo, no
  // mesmo banco, entravam nas "execuções desde a referência"
  const referencia = async () =>
    (await owner.pool.query<{ ref: string }>(`select clock_timestamp()::text as ref`)).rows[0]!.ref;
  const execucoesDesde = async (ref: string) =>
    (await owner.pool.query(`select tipo, ok from backup_runs where concluido_em > $1::timestamptz order by tipo`, [ref])).rows;

  it('o script é bash válido', async () => {
    await expect(execFile('bash', ['-n', SCRIPT])).resolves.toBeTruthy();
  });

  it('domingo: dump cifrado no diário e no semanal, /data sincronizado, retenção 7+4, registro em backup_runs', async () => {
    await semear(
      Object.fromEntries([
        ...Array.from({ length: 8 }, (_, i) => `db/diario/nutri-2026-09-${20 + i}.dump`), // 8 diários antigos
        ...['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map((d) => `db/semanal/nutri-${d}.dump`),
      ].map((p) => [p, 'antigo'])),
    );
    const antes = await referencia();
    // X-1: outro arquivo de teste (monitoramento.test.ts) grava no mesmo banco, ao mesmo tempo, execuções com datas
    // antigas; com a tabela ainda vazia elas não podem entrar nas "execuções desde a referência"
    await owner.pool.query(`insert into backup_runs (tipo, ok, iniciado_em, concluido_em) values ('banco', false, '1999-12-31', '1999-12-31')`);
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
    const banco = await owner.pool.query(`select bytes from backup_runs where tipo = 'banco' and concluido_em > $1::timestamptz`, [antes]);
    expect(Number(banco.rows[0].bytes)).toBeGreaterThan(0);
    // D6 (P08-04): os roles (sem senha) vão junto, para a restauração recriar donos e grants
    const globais = (await cat('db/globais.sql')).toString();
    expect(globais).toContain('nutri_app_role');
    expect(globais).not.toMatch(/PASSWORD\s+'/i);
  });

  it('dia seguinte: alterado/apagado vai para o histórico datado; histórico com mais de 30 dias sai; segunda não gera semanal', async () => {
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'versao-2');
    rmSync(path.join(dados, 't1', 'logo', 'b.png'));
    await rcat('data/historico/2026-08-01/velho.txt', 'x');
    mkdirSync(path.join(dados, 't1', 'exportacao'), { recursive: true });
    writeFileSync(path.join(dados, 't1', 'exportacao', 'e.zip'), 'zip');
    // Plano 12 (PM-11, D8): as imagens de página e os originais do exame enviado pelo paciente são temporários
    for (const pasta of ['exame_pagina', 'exame_original']) {
      mkdirSync(path.join(dados, 't1', pasta), { recursive: true });
      writeFileSync(path.join(dados, 't1', pasta, 'x.jpg'), 'temporario');
    }
    expect(await rodar('2026-10-05')).toBe(0);
    expect(await lsf('data/atual/t1/logo/')).toEqual(['a.png']);
    expect((await cat('data/atual/t1/logo/a.png')).toString()).toBe('versao-2');
    expect(await lsf('data/historico/2026-10-05/t1/logo/')).toEqual(['a.png', 'b.png']);
    expect((await cat('data/historico/2026-10-05/t1/logo/a.png')).toString()).toBe('versao-1');
    expect(await lsf('data/historico/')).not.toContain('2026-08-01/');
    expect(await lsf('db/semanal/')).not.toContain('nutri-2026-10-05.dump');
    expect(await lsf('data/atual/t1/')).toEqual(['logo/']); // nem o ZIP de exportação nem os temporários do envio vão para o R2
    expect(await lsf('data/historico/2026-10-05/t1/')).not.toContain('exportacao/');
    expect(await lsf('data/historico/2026-10-05/t1/')).not.toContain('exame_pagina/');
    expect(await lsf('data/historico/2026-10-05/t1/')).not.toContain('exame_original/');
  });

  it('falha no dump: registra ok=false, não deixa arquivo parcial, ainda copia /data e sai com erro', async () => {
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'versao-tres'); // M21: tamanho novo — prova que /data foi copiado nesta execução
    const antes = await referencia();
    const { codigo, saida } = await rodarComSaida('2026-10-06', { NUTRI_PG_DUMP_ARGS: '--table=tabela_que_nao_existe --strict-names' });
    expect(codigo).toBe(1);
    expect(await lsf('db/diario/')).not.toContain('nutri-2026-10-06.dump');
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: false }]);
    expect((await cat('data/atual/t1/logo/a.png')).toString()).toBe('versao-tres');
    // G2: o erro do pg_dump (cita o nome do objeto) não vai para o log; só a mensagem fixa
    expect(saida).toContain('ERRO no backup do banco');
    expect(saida).not.toContain('tabela_que_nao_existe');
  });

  it('falha na retenção: apagar os diários velhos falha -> banco ok=false com detalhe fixo, sai com erro, /data segue ok', async () => {
    const antes = await referencia();
    const { codigo, saida } = await rodarComSaida('2026-10-07', { PATH: rcloneQueFalhaEm('deletefile') }); // quarta: 8 diários -> precisa podar
    expect(codigo).toBe(1);
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: false }]);
    const det = await owner.pool.query(`select detalhe from backup_runs where tipo = 'banco' and concluido_em > $1::timestamptz`, [antes]);
    expect(det.rows[0].detalhe).toBe('retenção falhou');
    // M21 (RNF-11): o stderr do rclone (pode citar caminho/endpoint) não vai para o log nem para o detalhe
    expect(saida).toContain('ERRO no backup do banco (retenção falhou)'); // a captura funciona
    expect(saida).not.toContain('segredo-no-stderr');
  });

  it('container do banco não encontrado: pula só o banco, /data ainda é copiado, sai com erro (M20)', async () => {
    writeFileSync(path.join(dados, 't1', 'logo', 'c.png'), 'novo-sem-banco');
    const antes = await referencia();
    const { codigo, saida } = await rodarComSaida('2026-10-08', { NUTRI_DB_CONTAINER: '', NUTRI_DB_CONTAINER_FILTER: `nao-existe-${randomBytes(6).toString('hex')}` });
    expect(codigo).toBe(2); // banco pulado + arquivos sem registro
    expect(saida).toContain('container do banco não encontrado');
    // G8: a cópia deu certo — a mensagem diz isso, e não "ERRO no backup dos arquivos"
    expect(saida).toContain('arquivos copiados, mas sem registro (banco indisponível)');
    expect(saida).not.toContain('ERRO no backup dos arquivos');
    expect((await cat('data/atual/t1/logo/c.png')).toString()).toBe('novo-sem-banco');
    expect(await lsf('db/diario/')).not.toContain('nutri-2026-10-08.dump');
    expect(await execucoesDesde(antes)).toEqual([]); // sem banco, nada registrado (o worker alerta pela ausência)
  });

  it('falha no rclone sync de /data: arquivos ok=false com detalhe fixo, banco segue ok, sai com erro (M21)', async () => {
    const antes = await referencia();
    const { codigo, saida } = await rodarComSaida('2026-10-09', { PATH: rcloneQueFalhaEm('sync') });
    expect(codigo).toBe(1);
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: false }, { tipo: 'banco', ok: true }]);
    const det = await owner.pool.query(`select detalhe from backup_runs where tipo = 'arquivos' and concluido_em > $1::timestamptz`, [antes]);
    expect(det.rows[0].detalhe).toBe('rclone sync falhou');
    expect(saida).toContain('ERRO no backup dos arquivos');
    expect(saida).not.toContain('segredo-no-stderr'); // G2
  });

  it('falha no rclone rcat do dump: banco ok=false com detalhe fixo, sem o stderr do rclone no log (G2)', async () => {
    const antes = await referencia();
    const { codigo, saida } = await rodarComSaida('2026-10-10', { PATH: rcloneQueFalhaEm('rcat') });
    expect(codigo).toBe(1);
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: false }]);
    const det = await owner.pool.query(`select detalhe from backup_runs where tipo = 'banco' and concluido_em > $1::timestamptz`, [antes]);
    expect(det.rows[0].detalhe).toBe('pg_dump ou envio falhou');
    expect(saida).toContain('ERRO no backup do banco');
    expect(saida).not.toContain('segredo-no-stderr');
  });

  it('falha no dump dos roles (D6): banco ok=false com detalhe fixo, o dump do dia fica, o globais.sql anterior fica, sem o stderr no log', async () => {
    const antes = await referencia();
    const { codigo, saida } = await rodarComSaida('2026-10-12', { PATH: dockerQueFalhaEm('pg_dumpall', 'CREATE ROLE parcial') });
    expect(codigo).toBe(1);
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: false }]);
    const det = await owner.pool.query(`select detalhe from backup_runs where tipo = 'banco' and concluido_em > $1::timestamptz`, [antes]);
    expect(det.rows[0].detalhe).toBe('roles falhou');
    expect(await lsf('db/diario/')).toContain('nutri-2026-10-12.dump');
    expect(saida).toContain('ERRO no backup do banco (roles falhou)');
    expect(saida).not.toContain('segredo-no-stderr');
    // O globais.sql é a única cópia dos roles: o dump que caiu (vazio ou pela metade) não fica por cima da última boa
    const globais = (await cat('db/globais.sql')).toString();
    expect(globais).toContain('nutri_app_role');
    expect(globais).not.toContain('parcial');
    expect(await lsf('db/')).not.toContain('globais.sql.novo'); // nem sobra o temporário
  });

  it('falha ao promover o globais.sql (D6): banco ok=false, o temporário sai e a última cópia boa fica', async () => {
    await rcat('db/globais.sql', 'CREATE ROLE nutri_app_role; -- copia boa');
    const antes = await referencia();
    const { codigo } = await rodarComSaida('2026-10-13', { PATH: rcloneQueFalhaEm('moveto') });
    expect(codigo).toBe(1);
    const det = await owner.pool.query(`select detalhe from backup_runs where tipo = 'banco' and concluido_em > $1::timestamptz`, [antes]);
    expect(det.rows[0].detalhe).toBe('roles falhou');
    expect((await cat('db/globais.sql')).toString()).toBe('CREATE ROLE nutri_app_role; -- copia boa');
    expect(await lsf('db/')).not.toContain('globais.sql.novo');
  });

  // SUS-107 (revisão do #76): único caso que roda o script como no host, com o dump do banco inteiro (sem
  // NUTRI_PG_DUMP_ARGS). O prazo é próprio porque o dump inteiro cresce com os dados dos outros arquivos de teste:
  // medido com o banco quase vazio (só este arquivo): 2,0 s isolado e 2,3 s com 6 laços de CPU concorrentes (load ~10);
  // na suíte inteira o banco chega a 254 MB e o dump inteiro levou 14,5 s sob carga (SUS-107), daí 60 s (~4x).
  it('dump do banco inteiro (como no host, sem NUTRI_PG_DUMP_ARGS): sai 0, dump cifrado válido e registro ok', async () => {
    const envInteiro = { ...env };
    delete envInteiro.NUTRI_PG_DUMP_ARGS;
    const antes = await referencia();
    const r = await execFile('bash', [SCRIPT], { env: { ...envInteiro, NUTRI_BACKUP_TODAY: '2026-10-12' } }).then(
      () => 0,
      (e: { code?: number }) => e.code ?? 1,
    ); // 12/10/2026 é segunda: sem semanal
    expect(r).toBe(0);
    expect((await cat('db/diario/nutri-2026-10-12.dump')).subarray(0, 5).toString()).toBe('PGDMP');
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: true }]);
  }, 60_000);
});

describe('regra 10 (CLAUDE.md): o nutri-backup.sh só roda aqui', () => {
  it('nenhum outro arquivo de código cita o script (há bancos de produção no host)', () => {
    const citam = ['test', 'src', 'e2e', 'scripts'].flatMap((dir) =>
      (readdirSync(dir, { recursive: true }) as string[])
        .filter((f) => /\.(c|m)?[jt]sx?$/.test(f))
        .map((f) => path.join(dir, f))
        .filter((f) => f !== path.join('test', 'backup.test.ts') && readFileSync(f, 'utf8').includes('nutri-backup.sh')),
    );
    expect(citam).toEqual([]);
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
