/** O que interessa do clique (o `MouseEvent` do navegador serve). */
export type Clique = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };
/** O `<a href>` clicado (ou null, se o clique não foi num link). */
export type LinkClicado = { href: string; target: string; temDownload: boolean };

/**
 * Clique que o App Router transforma em navegação interna (a página do editor desmonta): botão principal, sem
 * modificadores, num `<a href>` da mesma origem, sem `target` (além de `_self`) nem `download`, e que não é só uma
 * âncora na própria página. Nova aba, outra origem e download não tiram a nutricionista do editor.
 */
export function ehNavegacaoInterna(c: Clique, link: LinkClicado | null, atual: string): boolean {
  if (!link || c.defaultPrevented || c.button !== 0 || c.metaKey || c.ctrlKey || c.shiftKey || c.altKey) return false;
  if ((link.target && link.target !== '_self') || link.temDownload) return false;
  const aqui = new URL(atual);
  let destino: URL;
  try {
    destino = new URL(link.href, aqui);
  } catch {
    return false;
  }
  if (destino.origin !== aqui.origin) return false;
  return !(destino.pathname === aqui.pathname && destino.search === aqui.search && destino.hash !== '');
}

/**
 * Clique no botão "Sair" (`data-sair`): um formulário, não um link — `ehNavegacaoInterna` não o pega. Ao enviar, a sessão
 * acaba e a edição que ainda não chegou ao servidor se perderia (o envio da desmontagem do editor chegaria depois do
 * logout e levaria 401). Vale com qualquer modificador: o formulário é enviado do mesmo jeito. Só fica de fora o clique que
 * outro listener já tratou.
 */
export function ehCliqueEmSair(c: Pick<Clique, 'defaultPrevented'>, dentroDeSair: boolean): boolean {
  return dentroDeSair && !c.defaultPrevented;
}

/**
 * Sair encerra a sessão, e o envio que o debounce segurava não garante a edição: qualquer status que não seja 'salvo'
 * (salvando, sem rede, erro de campo, parado) ou edição esperando os 800 ms pede confirmação. Tudo salvo sai direto.
 */
export function haAlteracaoNaoSalva(status: string, edicaoEsperando: boolean): boolean {
  return status !== 'salvo' || edicaoEsperando;
}
