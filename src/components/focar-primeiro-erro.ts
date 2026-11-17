/**
 * Plano 22 (revisão da T3, "Erro longe do botão"): depois de uma resposta com erro, num formulário longo, o foco vai ao
 * primeiro campo marcado (`aria-invalid="true"`) ou, antes dele na ordem do documento, ao aviso de erro sem campo que a
 * tela marcou como focável (`role="alert"` com `tabindex="-1"`, como o erro da lista de faixas ou de exames) — e a tela
 * rola até ele. Sem isso, quem clica em "Salvar" no fim da página não vê o erro do topo e o foco fica no botão.
 */
export const SELETOR_DO_PRIMEIRO_ERRO = '[aria-invalid="true"], [role="alert"][tabindex="-1"]';

/** Foca (e mostra) o primeiro erro dentro de `raiz`; devolve o alvo, ou `null` se não há erro marcado. */
export function focarPrimeiroErro(raiz: Pick<ParentNode, 'querySelector'> | null): HTMLElement | null {
  const alvo = raiz?.querySelector<HTMLElement>(SELETOR_DO_PRIMEIRO_ERRO) ?? null;
  if (!alvo) return null;
  alvo.scrollIntoView({ block: 'center' });
  alvo.focus({ preventScroll: true });
  return alvo;
}
