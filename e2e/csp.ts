import type { Page } from '@playwright/test';

/**
 * D7 (P08-05): violação de CSP vira mensagem no console. A lista devolvida cresce enquanto a página viver; o spec espera
 * vazia no fim (csp.spec e o laço de todas as telas do acessibilidade-painel-base.spec).
 */
export function vigiarCsp(page: Page): string[] {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (/Content[- ]Security[- ]Policy/i.test(m.text())) erros.push(`${page.url()}: ${m.text()}`);
  });
  return erros;
}
