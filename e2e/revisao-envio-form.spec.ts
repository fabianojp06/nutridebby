import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

// Revisão da T11 (Plano 12): os dois achados só aparecem no navegador. (1) "Aceitar" e "Recusar" são <summary>; com
// `inline-flex` o display deixa de ser `list-item` e a seta do <details> some. (2) A caixa "Escreva o motivo" só existe com
// "Outro motivo" marcado (o `recusarEnvio` só guarda o texto nesse motivo, US-164). Molde do conferencia-ia.spec.ts: os
// componentes de verdade são empacotados (esbuild) e montados numa página em branco, com as ações de servidor trocadas por
// umas de mentira que gravam o FormData; a 1ª recusa devolve o erro do texto. Não usa o app nem o banco; o CSS é o do
// `next build` que o webServer do Playwright já exige (.next/static), para o Tailwind de verdade valer no summary.
const ACAO_FALSA = `
export async function aceitarEnvioAction() { return {}; }
export async function recusarEnvioAction(_id, _prev, fd) {
  const envio = { motivo: fd.get('motivo'), texto: fd.get('texto') };
  window.__envios.push(envio);
  return window.__envios.length === 1
    ? { erros: { texto: 'Escreva o motivo para o paciente' }, valores: { motivo: envio.motivo ?? '', texto: envio.texto ?? '' } }
    : {};
}`;

const ENTRADA = `
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { AceitarForm } from '@/app/painel/exames-recebidos/[id]/aceitar-form';
import { RecusarForm } from '@/app/painel/exames-recebidos/[id]/recusar-form';
window.__envios = [];
createRoot(document.getElementById('raiz')).render(
  createElement(Fragment, null,
    createElement(AceitarForm, { id: 'e', tituloInicial: 'Hemograma', dataInicial: '2026-10-01', hoje: '2026-10-07', comIa: false }),
    createElement(RecusarForm, { id: 'e' }),
  ),
);`;

async function pacote(): Promise<string> {
  const r = await build({
    stdin: { contents: ENTRADA, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    banner: { js: 'var process = { env: { NODE_ENV: "development" } };' }, // o React de desenvolvimento lê `process` solto
    logLevel: 'silent',
    plugins: [
      {
        name: 'acao-falsa',
        setup(b) {
          b.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'acao-falsa', namespace: 'falsa' }));
          b.onLoad({ filter: /.*/, namespace: 'falsa' }, () => ({ contents: ACAO_FALSA, loader: 'js' }));
        },
      },
    ],
  });
  return r.outputFiles[0].text;
}

/** O CSS do app (Tailwind com o preflight), do `next build`. */
function cssDoApp(): string {
  const dir = join(process.cwd(), '.next', 'static');
  const arquivos = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css'));
  if (arquivos.length === 0) throw new Error('sem CSS em .next/static: rode o next build antes');
  return arquivos.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

type Envio = { motivo: string | null; texto: string | null };

test('revisão do envio: "Aceitar" e "Recusar" com a seta do <details>; "Escreva o motivo" só com "Outro motivo"', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.setContent('<!doctype html><html lang="pt-BR"><body><div id="raiz"></div></body></html>');
  await page.addStyleTag({ content: cssDoApp() });
  await page.addScriptTag({ content: await pacote() });

  // (1) o summary continua `list-item`: o navegador desenha a seta que diz que ali abre um formulário
  for (const rotulo of ['Aceitar', 'Recusar']) {
    const s = page.locator('summary', { hasText: rotulo });
    await expect(s).toBeVisible();
    expect(await s.evaluate((el) => getComputedStyle(el).display)).toBe('list-item');
  }

  // (2) a caixa do texto só com "Outro motivo"
  await page.locator('summary', { hasText: 'Recusar' }).click();
  const texto = page.getByRole('textbox', { name: 'Escreva o motivo' });
  const outro = page.getByRole('radio', { name: 'Outro motivo' });
  const repetido = page.getByRole('radio', { name: 'Exame repetido' });
  await expect(page.getByRole('radio', { name: 'Arquivo ilegível' })).toBeVisible();
  await expect(texto).toHaveCount(0);
  await repetido.check();
  await expect(texto).toHaveCount(0);
  await outro.check();
  await expect(texto).toBeVisible();
  await repetido.check();
  await expect(texto).toHaveCount(0);

  // "Outro motivo" sem texto: o erro volta com "Outro motivo" ainda marcado e a caixa na tela, ligada ao erro
  await outro.check();
  await page.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(page.getByText('Escreva o motivo para o paciente')).toBeVisible();
  const envios = () => page.evaluate(() => (window as unknown as { __envios: Envio[] }).__envios);
  expect((await envios())[0]).toEqual({ motivo: 'outro', texto: '' });
  await expect(outro).toBeChecked();
  await expect(texto).toBeVisible();
  await expect(texto).toHaveAttribute('aria-invalid', 'true');

  // trocou para "Exame repetido": a caixa some e o texto não vai junto (nada se perde sem aviso)
  await texto.fill('Você já enviou este exame em agosto');
  await repetido.check();
  await expect(texto).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect.poll(async () => (await envios()).length).toBe(2);
  expect((await envios())[1]).toEqual({ motivo: 'repetido', texto: null });
  expect(erros).toEqual([]);
});
