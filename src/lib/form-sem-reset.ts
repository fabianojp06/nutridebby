/**
 * SUS-108: ref de um `<form action={…}>` em que TODO campo é controlado pelo estado do React (o estado é a fonte; o que se
 * salva sai dele, como o JSON escondido da receita, ou dos campos que sempre mostram o estado).
 *
 * O React 19 chama `form.reset()` depois de toda action do `<form action>`, no fim da fase de mutação do commit. O reset
 * leva cada campo ao valor padrão do nó, e o React não ressincroniza um campo controlado enquanto a prop não muda:
 *  - `<select value>` não marca nenhuma opção como `defaultSelected` (react-dom 19.2, `updateOptions`) e volta à primeira
 *    opção (ou à do HTML do servidor);
 *  - `<input type="checkbox|radio" checked>` volta ao `checked` da montagem (o React só atualiza o `defaultChecked` de
 *    quem não é controlado).
 * (`<input value>` e `<textarea value>` escapam: o React copia o valor para o `defaultValue` a cada renderização.)
 * O `form.reset()` dispara o evento `reset`, cancelável: esta ref o cancela, e a tela continua mostrando o estado. Cancela
 * também o de um `<button type="reset">` do mesmo formulário (nenhum dos que a usam tem um): para limpar, mude o estado.
 *
 * Use SEMPRE esta função, nunca uma ref nova a cada renderização (`ref={(el) => …}`): o React desliga e religa uma ref
 * que mudou em todo commit, e o reset roda justamente entre o desligar e o religar — sem o ouvinte. Formulário com campo
 * não controlado que conta com o reset (para voltar ao padrão ou limpar depois do sucesso) não usa esta ref: o select vai
 * com `defaultValue` e remontagem a cada resposta, a caixa e o rádio com `defaultChecked={estado}`. A guarda é
 * `src/app/formularios-reset.test.ts`.
 */
export function semResetAutomatico(form: HTMLFormElement | null): (() => void) | undefined {
  if (!form) return;
  form.addEventListener('reset', cancelar);
  return () => form.removeEventListener('reset', cancelar);
}

const cancelar = (e: Event) => e.preventDefault();
