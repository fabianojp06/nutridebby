import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Runner próprio (docs/operacao/runner-proprio.md, 12/10/2026): os jobs do ci.yml rodam na VPS. Estas guardas leem os
// workflows como texto (sem os comentários) e quebram o CI se uma mudança abrir caminho para código de terceiros no
// runner ou levar para ele o que precisa ficar hospedado (segredos de deploy, packages:write).
const PASTA = path.resolve('.github/workflows');
const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .filter((linha) => !/^\s*#/.test(linha))
    .map((linha) => linha.replace(/\s+#.*$/, ''))
    .join('\n');
const workflows = readdirSync(PASTA)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ nome: f, texto: semComentarios(readFileSync(path.join(PASTA, f), 'utf8')) }));
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

describe('runner próprio: guardas dos workflows', () => {
  it('nenhum workflow usa gatilhos que rodam código de terceiros com segredos (GitHub M4)', () => {
    for (const { nome, texto } of workflows) {
      expect(texto, nome).not.toMatch(/\b(pull_request_target|workflow_run|issue_comment)\b/);
    }
  });

  it('os jobs do ci.yml mantêm os nomes de que o ci-ja-passou.sh depende e rodam no runner próprio', () => {
    const ci = jobs(lerWorkflow('ci.yml'));
    for (const nome of ['mudancas', 'quality', 'test', 'e2e', 'image']) {
      expect(ci[nome], nome).toMatch(/runs-on: \[self-hosted, nutri-ci\]/);
    }
  });

  it('o deploy.yml deixa hospedados o decidir e o publish (segredos de deploy e packages:write fora da VPS)', () => {
    const deploy = jobs(lerWorkflow('deploy.yml'));
    expect(deploy.decidir).toMatch(/runs-on: ubuntu-latest/);
    expect(deploy.publish).toMatch(/runs-on: ubuntu-latest/);
    expect(deploy.publish).toMatch(/packages: write/);
    for (const { nome, texto } of workflows) {
      for (const [job, bloco] of Object.entries(jobs(texto))) {
        if (/self-hosted/.test(bloco)) {
          expect(bloco, `${nome}/${job}`).not.toMatch(/secrets\.|packages: write|EASYPANEL/);
        }
      }
    }
  });

  it('a publicação de emergência só vale na main e com a confirmação digitada', () => {
    const deploy = lerWorkflow('deploy.yml');
    const publish = jobs(deploy).publish;
    expect(deploy).toMatch(/workflow_dispatch:/);
    expect(publish).toMatch(
      /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.confirmo == 'PUBLICAR-SEM-CI'/,
    );
    // No disparo manual, o decidir e o ci não rodam (senão o CI rodaria no runner fora do ar e travaria a emergência)
    expect(jobs(deploy).decidir).toMatch(/if: github\.event_name == 'push'/);
    expect(jobs(deploy).ci).toMatch(/if: \$\{\{ github\.event_name == 'push' && !cancelled\(\)/);
  });
});
