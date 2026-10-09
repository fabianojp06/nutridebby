import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Deploy sem repetir o CI do PR (dono, 09/10/2026): o script de decisão do deploy.yml contra um `gh` falso (respostas
// da API em arquivos) e repositórios git de verdade. Na dúvida, pular=false — o deploy roda o CI completo.
const SCRIPT = path.resolve('.github/scripts/ci-ja-passou.sh');
const REPO = 'dono/nutridebby';
const base = mkdtempSync(path.join(tmpdir(), 'nd-ci-ja-passou-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const ambienteGit = {
  GIT_AUTHOR_NAME: 'teste',
  GIT_AUTHOR_EMAIL: 'teste@ex.com',
  GIT_COMMITTER_NAME: 'teste',
  GIT_COMMITTER_EMAIL: 'teste@ex.com',
};
Object.assign(process.env, ambienteGit);

function commitar(cwd: string, arquivo: string, conteudo: string, msg: string) {
  writeFileSync(path.join(cwd, arquivo), conteudo);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

/**
 * "origin": main com A; PR com B (código novo) sobre A, em refs/pull/7/head. `estrategia` decide o commit da main:
 * merge (merge commit, como o repositório usa hoje), squash (commit novo com a árvore de B) ou outra-arvore.
 * "runner": clone da origin (só os branches; refs/pull não vem), onde o script roda.
 */
function cenario(estrategia: 'merge' | 'squash' | 'outra-arvore' | 'desatualizado') {
  const dir = path.join(base, `c${++n}`);
  const origin = path.join(dir, 'origin');
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '-q', '-b', 'main');
  const antes = commitar(origin, 'app.ts', 'export const v = 1;\n', 'A');
  git(origin, 'checkout', '-q', '-b', 'pr');
  const head = commitar(origin, 'app.ts', 'export const v = 2;\n', 'B');
  git(origin, 'checkout', '-q', 'main');
  let anterior = antes;
  let sha: string;
  if (estrategia === 'merge') {
    git(origin, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #7', 'pr');
    sha = git(origin, 'rev-parse', 'HEAD');
  } else if (estrategia === 'squash') {
    sha = git(origin, 'commit-tree', `${head}^{tree}`, '-p', antes, '-m', 'B (#7)');
    git(origin, 'update-ref', 'refs/heads/main', sha);
  } else if (estrategia === 'outra-arvore') {
    sha = commitar(origin, 'app.ts', 'export const v = 3;\n', 'C');
  } else {
    // a main andou (A2) depois do PR; o commit da main tem a árvore de B, mas o PR não contém A2
    anterior = commitar(origin, 'outro.ts', 'export const x = 1;\n', 'A2');
    sha = git(origin, 'commit-tree', `${head}^{tree}`, '-p', anterior, '-m', 'B (#7)');
    git(origin, 'update-ref', 'refs/heads/main', sha);
  }
  git(origin, 'checkout', '-q', '--detach');
  git(origin, 'update-ref', 'refs/pull/7/head', head);
  git(origin, 'branch', '-q', '-D', 'pr');
  const runner = path.join(dir, 'runner');
  git(dir, 'clone', '-q', '--no-local', origin, runner);
  return { dir, runner, sha, head, antes: anterior };
}

type Job = { name: string; conclusion: string | null };
const jobsOk = (): Job[] =>
  ['mudancas', 'quality', 'test', 'e2e', 'image'].map((name) => ({ name, conclusion: 'success' }));

interface Api {
  pulls?: unknown; // undefined → a API falha
  runs?: unknown;
  jobs?: unknown;
}

/**
 * Os campos da execução no formato REAL da API depois do merge (conferido nos PRs #29 e #30): `pull_requests` vazio,
 * `display_title` = o run-name do ci.yml (`ci-pr-<n>-<base.sha>`) e `head_repository`. Padrão: o PR #7, com a base no
 * commit em que a main estava (ancestral do head), do próprio repositório.
 */
const daExecucao = (
  c: ReturnType<typeof cenario>,
  o: { number?: number; sha?: string; repo?: string; titulo?: string } = {},
) => ({
  pull_requests: [],
  display_title: o.titulo ?? `ci-pr-${o.number ?? 7}-${o.sha ?? c.antes}`,
  head_repository: { full_name: o.repo ?? REPO },
});

function apiPadrao(c: ReturnType<typeof cenario>): Api {
  return {
    pulls: [
      {
        number: 7,
        merged_at: '2026-10-09T12:00:00Z',
        merge_commit_sha: c.sha,
        base: { ref: 'main' },
        head: { sha: c.head },
      },
    ],
    runs: {
      workflow_runs: [
        {
          id: 101,
          head_sha: c.head,
          event: 'pull_request',
          path: '.github/workflows/ci.yml',
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-10-09T11:00:00Z',
          ...daExecucao(c),
        },
      ],
    },
    jobs: { jobs: jobsOk() },
  };
}

function rodar(c: ReturnType<typeof cenario>, api: Api, env: Record<string, string> = {}) {
  const bin = path.join(c.dir, 'bin');
  const respostas = path.join(c.dir, 'api');
  mkdirSync(bin, { recursive: true });
  mkdirSync(respostas, { recursive: true });
  for (const k of ['pulls', 'runs', 'jobs'] as const) {
    const f = path.join(respostas, `${k}.json`);
    rmSync(f, { force: true });
    if (api[k] !== undefined) writeFileSync(f, JSON.stringify(api[k]));
  }
  // `gh api <endpoint>`: responde pelo tipo do endpoint e guarda a chamada
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "$*" >> "${path.join(c.dir, 'chamadas.log')}"
[[ "$1" == api ]] || exit 2
case "$2" in
  */commits/*/pulls*) f=pulls ;;
  */actions/workflows/ci.yml/runs*) f=runs ;;
  */actions/runs/*/jobs*) f=jobs ;;
  *) echo "gh: endpoint inesperado $2" >&2; exit 1 ;;
esac
[[ -f "${respostas}/$f.json" ]] || { echo "gh: HTTP 502" >&2; exit 1; }
cat "${respostas}/$f.json"
`,
  );
  chmodSync(path.join(bin, 'gh'), 0o755);
  const saida = path.join(c.dir, 'github_output');
  writeFileSync(saida, '');
  const r = spawnSync('bash', [SCRIPT], {
    cwd: c.runner,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: c.dir,
      ...ambienteGit,
      GITHUB_OUTPUT: saida,
      REPO,
      SHA: c.sha,
      BEFORE: c.antes,
      ...env,
    } as unknown as NodeJS.ProcessEnv,
  });
  const out = readFileSync(saida, 'utf8');
  return {
    status: r.status,
    log: `${r.stdout}${r.stderr}`,
    pular: /^pular=(.*)$/m.exec(out)?.[1],
    chamadas: (() => {
      try {
        return readFileSync(path.join(c.dir, 'chamadas.log'), 'utf8');
      } catch {
        return '';
      }
    })(),
  };
}

describe('ci-ja-passou.sh (deploy pula o CI que o PR já passou)', () => {
  it('merge commit com a árvore do head do PR e o CI do head todo em success → pula', () => {
    const c = cenario('merge');
    const r = rodar(c, apiPadrao(c));
    expect(r.status).toBe(0);
    expect(r.pular).toBe('true');
    expect(r.chamadas).toContain(`repos/${REPO}/commits/${c.sha}/pulls`);
    expect(r.chamadas).toContain(`head_sha=${c.head}`);
    expect(r.chamadas).toContain('actions/runs/101/jobs');
  });

  it('squash: o head do PR não está no clone; o script busca refs/pull/<n>/head e compara as árvores → pula', () => {
    const c = cenario('squash');
    expect(
      spawnSync('git', ['cat-file', '-e', `${c.head}^{commit}`], { cwd: c.runner }).status,
    ).not.toBe(0);
    const r = rodar(c, apiPadrao(c));
    expect(r.pular).toBe('true');
  });

  it('árvore da main diferente da do head do PR → CI completo', () => {
    const c = cenario('outra-arvore');
    const r = rodar(c, apiPadrao(c));
    expect(r.status).toBe(0);
    expect(r.pular).toBe('false');
    expect(r.log).toMatch(/árvore/i);
  });

  it('PR desatualizado (a main anterior não está no head): o CI do PR não testou esta árvore → CI completo', () => {
    const c = cenario('desatualizado');
    expect(git(c.runner, 'rev-parse', `${c.sha}^{tree}`)).toBe(
      git(path.join(c.dir, 'origin'), 'rev-parse', `${c.head}^{tree}`),
    );
    expect(rodar(c, apiPadrao(c)).pular).toBe('false');
  });

  it.each([
    ['failure', 'completed'],
    ['cancelled', 'completed'],
    ['skipped', 'completed'],
    [null, 'in_progress'],
  ])('CI do head com conclusão %s (%s) → CI completo', (conclusion, status) => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    api.runs = {
      workflow_runs: [
        { ...(api.runs as { workflow_runs: object[] }).workflow_runs[0], status, conclusion },
      ],
    };
    expect(rodar(c, api).pular).toBe('false');
  });

  it('a execução mais recente do CI do head é a que vale (sucesso antigo + falha nova → CI completo; o contrário → pula)', () => {
    const c = cenario('merge');
    const run = (id: number, conclusion: string, created_at: string) => ({
      id,
      head_sha: c.head,
      event: 'pull_request',
      path: '.github/workflows/ci.yml',
      status: 'completed',
      conclusion,
      created_at,
      ...daExecucao(c),
    });
    const api = apiPadrao(c);
    api.runs = {
      workflow_runs: [
        run(201, 'failure', '2026-10-09T11:30:00Z'),
        run(101, 'success', '2026-10-09T11:00:00Z'),
      ],
    };
    expect(rodar(c, api).pular).toBe('false');
    api.runs = {
      workflow_runs: [
        run(201, 'success', '2026-10-09T11:30:00Z'),
        run(101, 'failure', '2026-10-09T11:00:00Z'),
      ],
    };
    const r = rodar(c, api);
    expect(r.pular).toBe('true');
    expect(r.chamadas).toContain('actions/runs/201/jobs');
  });

  it.each([
    ['de outro PR (mesmo commit em dois PRs)', { number: 8 }],
    ['com a base fora do histórico do head (testou o merge com outra base)', { sha: 'MERGE' }],
    ['com uma base que nem existe no clone', { sha: 'c'.repeat(40) }],
    ['de um fork (head_repository de outro dono)', { repo: 'outro/nutridebby' }],
  ] as const)('execução do CI %s → CI completo', (_nome, o) => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    const run = (api.runs as { workflow_runs: Record<string, unknown>[] }).workflow_runs[0];
    api.runs = {
      workflow_runs: [
        { ...run, ...daExecucao(c, 'sha' in o && o.sha === 'MERGE' ? { sha: c.sha } : o) },
      ],
    };
    expect(rodar(c, api).pular).toBe('false');
  });

  it('PR do merge com outra base (PR empilhado: a API de pulls do commit diz a base) → CI completo', () => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    api.pulls = [{ ...(api.pulls as Record<string, unknown>[])[0], base: { ref: 'outro-branch' } }];
    expect(rodar(c, api).pular).toBe('false');
  });

  it.each([
    'Plano 14A — IA', // execução antiga, sem o run-name (o display_title é o título do PR)
    'ci',
    'ci-pr-7-abc',
    'ci-pr--' + 'a'.repeat(40),
    'ci-pr-7-' + 'A'.repeat(40),
    'xci-pr-7-' + 'a'.repeat(40),
    'ci-pr-7-' + 'a'.repeat(40) + ' extra',
  ])('display_title fora do padrão (%s) → CI completo', (titulo) => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    const run = (api.runs as { workflow_runs: Record<string, unknown>[] }).workflow_runs[0];
    api.runs = { workflow_runs: [{ ...run, display_title: titulo }] };
    expect(rodar(c, api).pular).toBe('false');
  });

  it('o select não depende de pull_requests: vazio (depois do merge) ou preenchido com outro PR, vale o display_title', () => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    const run = (api.runs as { workflow_runs: Record<string, unknown>[] }).workflow_runs[0];
    expect(run.pull_requests).toEqual([]);
    expect(rodar(c, api).pular).toBe('true');
    api.runs = {
      workflow_runs: [
        { ...run, pull_requests: [{ number: 8, base: { ref: 'outro', sha: c.sha } }] },
      ],
    };
    expect(rodar(c, api).pular).toBe('true');
  });

  it('a execução mais recente do PR certo vale, mesmo com uma execução mais nova do mesmo head em outro PR', () => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    const run = (api.runs as { workflow_runs: Record<string, unknown>[] }).workflow_runs[0];
    api.runs = {
      workflow_runs: [
        {
          ...run,
          id: 301,
          conclusion: 'failure',
          created_at: '2026-10-09T11:59:00Z',
          ...daExecucao(c, { number: 8 }),
        },
        run,
      ],
    };
    const r = rodar(c, api);
    expect(r.pular).toBe('true');
    expect(r.chamadas).toContain('actions/runs/101/jobs');
  });

  it('sem execução do CI para o head (ou só de outro commit) → CI completo', () => {
    const c = cenario('merge');
    const api = apiPadrao(c);
    api.runs = { workflow_runs: [] };
    expect(rodar(c, api).pular).toBe('false');
    api.runs = {
      workflow_runs: [
        {
          ...(apiPadrao(c).runs as { workflow_runs: object[] }).workflow_runs[0],
          head_sha: 'a'.repeat(40),
        },
      ],
    };
    expect(rodar(c, api).pular).toBe('false');
  });

  it.each(['quality', 'test', 'e2e', 'image'])(
    'job %s fora de success (pulado = PR só de documentação, ausente ou com falha) → CI completo',
    (nome) => {
      const c = cenario('merge');
      for (const conclusion of ['skipped', 'failure', 'cancelled', null]) {
        const api = apiPadrao(c);
        api.jobs = { jobs: jobsOk().map((j) => (j.name === nome ? { ...j, conclusion } : j)) };
        expect(rodar(c, api).pular).toBe('false');
      }
      const api = apiPadrao(c);
      api.jobs = { jobs: jobsOk().filter((j) => j.name !== nome) };
      expect(rodar(c, api).pular).toBe('false');
    },
  );

  it('commit que não é o merge de um PR (lista vazia, PR não mergeado, outro merge_commit_sha, outra base) → CI completo', () => {
    const c = cenario('merge');
    const pr = (apiPadrao(c).pulls as object[])[0];
    for (const pulls of [
      [],
      [{ ...pr, merged_at: null }],
      [{ ...pr, merge_commit_sha: 'b'.repeat(40) }],
      [{ ...pr, base: { ref: 'outro' } }],
    ]) {
      const r = rodar(c, { ...apiPadrao(c), pulls });
      expect(r.status).toBe(0);
      expect(r.pular).toBe('false');
    }
  });

  it.each(['pulls', 'runs', 'jobs'] as const)(
    'API falha em %s → CI completo (o script nunca falha o job)',
    (k) => {
      const c = cenario('merge');
      const r = rodar(c, { ...apiPadrao(c), [k]: undefined });
      expect(r.status).toBe(0);
      expect(r.pular).toBe('false');
    },
  );

  it('resposta da API fora do formato (JSON inválido, head que não é um SHA) → CI completo', () => {
    const c = cenario('merge');
    expect(rodar(c, { ...apiPadrao(c), runs: 'não é json {' }).pular).toBe('false');
    const pr = (apiPadrao(c).pulls as object[])[0];
    expect(
      rodar(c, { ...apiPadrao(c), pulls: [{ ...pr, head: { sha: '--upload-pack=x' } }] }).pular,
    ).toBe('false');
  });

  it('entradas ausentes ou BEFORE nulo (primeiro push, push forçado) → CI completo', () => {
    const c = cenario('merge');
    expect(rodar(c, apiPadrao(c), { BEFORE: '0'.repeat(40) }).pular).toBe('false');
    expect(rodar(c, apiPadrao(c), { SHA: '' }).pular).toBe('false');
    expect(rodar(c, apiPadrao(c), { REPO: '' }).pular).toBe('false');
  });

  it('o deploy.yml usa este script e o publish depende da decisão', () => {
    const deploy = readFileSync(path.resolve('.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toContain('.github/scripts/ci-ja-passou.sh');
    expect(deploy).toMatch(/needs: \[decidir, ci\]/);
    expect(deploy).toContain("needs.decidir.outputs.pular != 'true'");
  });
});
