import { valeNoDia } from '@/modules/plano-alimentar/dias';
import type { FiltroDia } from './estado';
import type { StatusSalvamento } from './use-salvamento';

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
 * Há edição que ainda não está no servidor? Qualquer status que não seja 'salvo' (salvando, sem rede, erro de campo,
 * parado) ou edição esperando os 800 ms do salvamento automático. Tudo salvo e nada esperando: não há.
 */
export function haAlteracaoNaoSalva(status: StatusSalvamento, edicaoEsperando: boolean): boolean {
  return status !== 'salvo' || edicaoEsperando;
}

/** O que o botão "Sair" (`data-sair`, um formulário, não um link) faz no editor. */
export type SaidaDoEditor = 'direto' | 'enviar-antes' | 'confirmar';

/**
 * "Sair" encerra a sessão, e o envio que o editor faz ao desmontar chegaria depois do logout (401): a edição se perderia
 * sem aviso. Então:
 * - `direto`: tudo salvo e nada esperando;
 * - `enviar-antes`: só o debounce pendente (ou um envio normal em voo): o editor envia na hora, espera gravar e então
 *   sai; se não gravar, cai na confirmação;
 * - `confirmar`: o envio não resolve (sem rede, erro de campo, conflito/paciente bloqueado, última tentativa sem
 *   sucesso): pede confirmação antes de descartar.
 */
export function comoSair(status: StatusSalvamento, s: { edicaoEsperando: boolean; falhou: boolean; parado: boolean }): SaidaDoEditor {
  if (!haAlteracaoNaoSalva(status, s.edicaoEsperando)) return 'direto';
  if (s.falhou || s.parado || status === 'offline' || status === 'erro' || status === 'parado') return 'confirmar';
  return 'enviar-antes';
}

/**
 * Plano 19 (RN-247 a): o link de um erro ("A refeição "Almoço" está sem texto.", D31) leva o foco ao campo pelo id
 * (`<refeição>-descricao`, `<refeição>-dias`, `<item>-g`…). Se o filtro de dias esconde a refeição do campo, ele não
 * está na tela: o filtro volta para "Todos". Campo que já aparece, ou que não é de refeição ("macros", "titulo"), não
 * muda o filtro.
 */
export function filtroQueMostra(idDoCampo: string, refeicoes: { id: string; diasSemana: readonly number[]; itens: { id: string }[] }[], filtro: FiltroDia): FiltroDia {
  if (filtro === 'todos') return filtro;
  const dono = /^([0-9a-f-]{36})-/i.exec(idDoCampo)?.[1];
  const r = dono ? refeicoes.find((x) => x.id === dono || x.itens.some((i) => i.id === dono)) : undefined;
  return r && !valeNoDia(r, filtro) ? 'todos' : filtro;
}
