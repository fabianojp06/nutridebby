import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

// Revisão da T13 (rodada 2): o reset do formulário do React 19 depois de uma action com erro. Com `<form action={…}>`, o
// React chama `form.reset()` no fim do commit; um checkbox controlado volta ao `defaultChecked` (false) e o DOM diverge do
// estado — a nutricionista marca as linhas, recebe "Desmarque {n} linhas." e vê tudo desmarcado; o 2º envio sai vazio.
// Isso só aparece no navegador, então o componente de verdade é empacotado (esbuild) e montado numa página em branco, com
// a ação de servidor trocada por uma de mentira que grava o FormData e devolve erro no 1º envio. Não usa o app nem o banco.
const ACAO_FALSA = `
export async function aplicarSugestaoAction(_patientId, _tarefaId, _prev, fd) {
  window.__envios.push({ sel: fd.getAll('sel'), usarData: fd.get('usarData'), nome0: fd.get('nome-0'), unidade1: fd.get('unidade-1') });
  return window.__envios.length === 1 ? { erros: { geral: 'Um exame pode ter no máximo 50 valores. Desmarque 1 linha.' } } : { erros: {} };
}`;

const ENTRADA = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ConferenciaIa } from '@/app/painel/pacientes/[id]/exames/conferencia-ia';
window.__envios = [];
const linhas = [0, 1].map((i) => ({ indice: i, nomeSugerido: 'Marcador ' + i, nomeAjustado: false, valorInicial: '92', valorTexto: '92', unidade: 'mg/dL', referencia: '70 a 99', pagina: 1, jaLancado: false }));
createRoot(document.getElementById('raiz')).render(
  createElement(ConferenciaIa, { patientId: 'p', tarefaId: 't', linhas, dataColeta: { iso: '2026-10-01', texto: '01/10/2026' }, descartadas: 0 }),
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

type Envio = { sel: string[]; usarData: string | null; nome0: string | null; unidade1: string | null };

test('conferência da IA: marcações e correções continuam na tela e no 2º envio depois de um erro', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.setContent('<!doctype html><html lang="pt-BR"><body><div id="raiz"></div></body></html>');
  await page.addScriptTag({ content: await pacote() });

  const caixa0 = page.getByRole('checkbox', { name: 'Selecionar Marcador 0' });
  const caixa1 = page.getByRole('checkbox', { name: 'Selecionar Marcador 1' });
  const data = page.getByRole('checkbox', { name: /Usar/ });
  await expect(caixa0).not.toBeChecked(); // US-111: começam desmarcadas
  await caixa0.check();
  await caixa1.check();
  await data.check();
  await page.getByRole('textbox', { name: 'Nome do marcador 1' }).fill('Glicose em jejum');
  await page.getByRole('textbox', { name: 'Unidade de Marcador 1' }).fill('mmol/L');

  await page.getByRole('button', { name: 'Salvar valores selecionados' }).click();
  await expect(page.getByText('Desmarque 1 linha.')).toBeVisible();
  const envios = () => page.evaluate(() => (window as unknown as { __envios: Envio[] }).__envios);
  expect((await envios())[0]).toEqual({ sel: ['0', '1'], usarData: '1', nome0: 'Glicose em jejum', unidade1: 'mmol/L' });

  // depois do erro: nada foi desmarcado nem voltou ao que a IA leu (DOM, não só o estado do React)
  await expect(caixa0).toBeChecked();
  await expect(caixa1).toBeChecked();
  await expect(data).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Nome do marcador 1' })).toHaveValue('Glicose em jejum');
  await expect(page.getByRole('textbox', { name: 'Unidade de Marcador 1' })).toHaveValue('mmol/L');

  // a nutricionista desmarca uma linha (o que o erro pediu) e salva de novo, sem remarcar nada
  await caixa0.uncheck();
  await page.getByRole('button', { name: 'Salvar valores selecionados' }).click();
  await expect.poll(async () => (await envios()).length).toBe(2);
  expect((await envios())[1]).toEqual({ sel: ['1'], usarData: '1', nome0: 'Glicose em jejum', unidade1: 'mmol/L' });
  expect(erros).toEqual([]);
});
