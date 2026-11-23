/**
 * Plano 22 (/code-review do PR 1) — as decisões do `<Dialogo>` (src/components/dialogo.tsx) num fechamento que não veio da
 * tela, sem DOM (testadas em dialogo.test.ts; foco e Esc de verdade ficam no Playwright, EP-D54).
 */

/**
 * O evento `close` do `<dialog>` chegou. Ele vem da tela (`aberto` passou a falso e o efeito chamou `close()`) ou do
 * navegador sem passar pela tela: `form method="dialog"` ou o segundo `Esc` do Chromium, que fecha o modal com um `cancel`
 * NÃO cancelável (a proteção contra diálogo que prende o usuário) — o `preventDefault` do `onCancel` não segura.
 *
 * - `ocupado` com a tela ainda mandando `aberto` → `reabrir`: a trava não pode ser furada; `showModal()` de novo (o estado
 *   do `<dialog>` volta a bater com `aberto`), sem chamar `aoFechar` e sem devolver o foco;
 * - fora isso, o foco volta (`devolverFoco`) e, se a tela ainda manda `aberto`, `aoFechar` avisa (`avisar`) para ela
 *   acompanhar o fechamento.
 */
export function aoFecharPeloNavegador(s: { ocupado: boolean; aberto: boolean }): { reabrir: boolean; devolverFoco: boolean; avisar: boolean } {
  if (s.ocupado && s.aberto) return { reabrir: true, devolverFoco: false, avisar: false };
  return { reabrir: false, devolverFoco: true, avisar: s.aberto };
}

/**
 * O `<Dialogo>` desmontou (o pai o tirou da tela, ou a tela inteira saiu): o `close` não dispara, então o foco volta pela
 * limpeza do efeito — só se ele estava aberto e o `<dialog>` saiu mesmo do DOM (`conectado` falso). No Strict Mode, a
 * desmontagem simulada deixa o `<dialog>` no DOM: o foco fica onde está.
 */
export function devolveFocoAoDesmontar(s: { aberto: boolean; conectado: boolean }): boolean {
  return s.aberto && !s.conectado;
}
