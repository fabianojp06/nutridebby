import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Runner próprio (docs/operacao/runner-proprio.md, 12/10/2026): os jobs do ci.yml rodam na VPS. Estas guardas leem os
// workflows como texto e quebram o CI se uma mudança abrir caminho para código de terceiros no runner ou levar para ele
// o que precisa ficar hospedado (segredos de deploy, packages:write). São alarme contra engano, não barreira: quem
// edita o YAML de um PR também pode editar este teste.
const PASTA = path.resolve('.github/workflows');
const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .filter((linha) => !/^\s*#/.test(linha))
    .map((linha) => linha.replace(/\s+#.*$/, ''))
    .join('\n');
const workflows = readdirSync(PASTA)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => {
    const bruto = readFileSync(path.join(PASTA, f), 'utf8');
    return { nome: f, bruto, texto: semComentarios(bruto) };
  });
const lerWorkflow = (nome: string) => workflows.find((w) => w.nome === nome)!.texto;

/** Blocos dos jobs de um workflow (de "  nome:" até o próximo job de mesmo nível). */
function jobs(texto: string): Record<string, string> {
  const depois = texto.slice(texto.search(/^jobs:\s*$/m));
  const blocos: Record<string, string> = {};
  for (const parte of depois.split(/^(?=  [\w-]+:\s*$)/m).slice(1)) {
    blocos[parte.match(/^ {2}([\w-]+):/)![1]] = parte;
  }
  return blocos;
}
const HOSPEDADO = 'runs-on: ubuntu-latest';
const PROPRIO = 'runs-on: [self-hosted, nutri-ci]';

describe('runner próprio: guardas dos workflows', () => {
  it('nenhum workflow usa gatilhos que rodam código de terceiros com segredos (GitHub M4)', () => {
    for (const { nome, texto } of workflows) {
      expect(texto, nome).not.toMatch(/\b(pull_request_target|workflow_run|issue_comment)\b/);
    }
  });

  it('todo job roda no hospedado ou no runner próprio, escrito de um jeito só (o rótulo nutri-ci sozinho também vai para a VPS)', () => {
    for (const { nome, texto } of workflows) {
      for (const [job, bloco] of Object.entries(jobs(texto))) {
        const runsOn = bloco.match(/^ {4}runs-on:.*$/m)?.[0].trim();
        if (runsOn === undefined) {
          expect(bloco, `${nome}/${job}: sem runs-on, só um workflow reutilizável`).toMatch(/^ {4}uses: \.\/\.github\/workflows\//m);
          continue;
        }
        expect([HOSPEDADO, PROPRIO], `${nome}/${job}`).toContain(runsOn);
      }
    }
  });

  it('os jobs do ci.yml mantêm os nomes de que o ci-ja-passou.sh depende e rodam no runner próprio', () => {
    const ci = jobs(lerWorkflow('ci.yml'));
    for (const nome of ['mudancas', 'quality', 'test', 'e2e', 'image']) {
      expect(ci[nome], nome).toContain(PROPRIO);
    }
  });

  it('nada que vá para o runner próprio recebe segredos ou permissão de escrita', () => {
    for (const { nome, bruto, texto } of workflows) {
      // Onde o job roda sai do texto sem comentários (um "# antes: runs-on: ubuntu-latest" não o isenta); o que ele
      // recebe, do texto BRUTO: o GitHub expande ${{ secrets.X }} até dentro de um comentário de shell num `run:`
      const semComentario = jobs(texto);
      for (const [job, bloco] of Object.entries(jobs(bruto))) {
        if (semComentario[job]?.match(/^ {4}runs-on:.*$/m)?.[0].trim() !== HOSPEDADO) {
          expect(bloco, `${nome}/${job}`).not.toMatch(/\bsecrets\b|: write\b|write-all|EASYPANEL|github\.token|GITHUB_TOKEN/);
        }
      }
    }
    // O ci.yml inteiro roda no runner próprio: nem as permissões do topo podem escrever
    const topoCi = lerWorkflow('ci.yml').split(/^jobs:\s*$/m)[0];
    expect(topoCi).not.toMatch(/: write\b|write-all/);
    expect(jobs(lerWorkflow('deploy.yml')).ci).not.toMatch(/secrets:|permissions:/);
  });

  it('o deploy.yml deixa hospedados o decidir e o publish (segredos de deploy e packages:write fora da VPS)', () => {
    const deploy = jobs(lerWorkflow('deploy.yml'));
    expect(deploy.decidir).toContain(HOSPEDADO);
    expect(deploy.publish).toContain(HOSPEDADO);
    expect(deploy.publish).toMatch(/packages: write/);
  });

  it('a publicação de emergência só vale na main e com a confirmação digitada; o contrário falha à vista', () => {
    const deploy = lerWorkflow('deploy.yml');
    const j = jobs(deploy);
    expect(deploy).toMatch(/workflow_dispatch:/);
    expect(j.publish).toMatch(
      /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.confirmo == 'PUBLICAR-SEM-CI'/,
    );
    expect(j.confirmar).toMatch(
      /if: github\.event_name == 'workflow_dispatch' && !\(github\.ref == 'refs\/heads\/main' && inputs\.confirmo == 'PUBLICAR-SEM-CI'\)/,
    );
    expect(j.confirmar).toMatch(/exit 1/);
    // No disparo manual, o decidir e o ci não rodam (senão o CI rodaria no runner fora do ar e travaria a emergência),
    // e a emergência cancela o deploy de push preso na fila
    expect(j.decidir).toMatch(/if: github\.event_name == 'push'/);
    expect(j.ci).toMatch(/if: \$\{\{ github\.event_name == 'push' && !cancelled\(\)/);
    expect(deploy).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
    // ...mas só a emergência válida entra no grupo do deploy; a recusada fica num grupo próprio e não derruba nada
    expect(deploy).toMatch(
      /group: \$\{\{ github\.event_name == 'workflow_dispatch' && !\(github\.ref == 'refs\/heads\/main' && inputs\.confirmo == 'PUBLICAR-SEM-CI'\) && format\('deploy-recusado-\{0\}', github\.run_id\) \|\| 'deploy-main' \}\}/,
    );
  });
});
