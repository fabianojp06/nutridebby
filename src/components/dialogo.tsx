'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import { alvoDoFocoAoFechar, aoFecharPeloNavegador, devolveFocoAoDesmontar } from './dialogo-fechar';

/** O `[data-foco-inicial]` do próprio diálogo — nunca o de um diálogo aninhado dentro dele. */
function focoInicialDe(d: HTMLDialogElement): HTMLElement | undefined {
  return Array.from(d.querySelectorAll<HTMLElement>(':scope [data-foco-inicial]')).find((el) => el.closest('dialog') === d);
}

/**
 * Plano 22 (EP-D42) — o diálogo modal COMPARTILHADO do painel e do portal (decisão da orquestradora de 17/11/2026: o
 * Plano 23 usa este mesmo componente, sem cópia). Diálogos e confirmações com rótulos próprios passam por aqui, nunca
 * por `window.confirm`/`ConfirmarBotao` nas telas novas.
 *
 * - `<dialog>` + `showModal()` quando `aberto` (foco preso no diálogo pelo navegador; o fundo fica inerte);
 * - nome acessível pelo h2 do título (`aria-labelledby`, `useId`); `descricao` opcional ligada por `aria-describedby`;
 *   `alerta` (confirmação de ação que apaga ou tira acesso) troca o papel para `alertdialog`;
 * - `children` só é montado com `aberto`: o estado de dentro não passa de uma abertura para a outra e nada fica oculto
 *   no DOM com o diálogo fechado;
 * - foco inicial no elemento marcado com `data-foco-inicial` **do próprio diálogo** (o de um diálogo aninhado não
 *   conta); sem ele, o padrão do navegador (o primeiro elemento focável);
 * - título e rodapé fixos; só o corpo rola (`open:flex open:flex-col` — nunca `flex` puro, que mostraria o `<dialog>`
 *   fechado);
 * - `Esc` (evento `cancel`) chama `aoFechar` — quem abriu decide fechar (o diálogo é controlado por `aberto`);
 * - `ocupado` (a action em andamento): `Esc`, "Fechar" e "Cancelar" não fecham, e os botões do rodapé padrão e do
 *   `DialogoConfirmar` ficam `aria-disabled` (sem `disabled`, para o foco não sair do diálogo). O segundo `Esc` do
 *   Chromium fecha o modal sem `cancel` cancelável: o `onClose` reabre com `showModal()`, sem chamar `aoFechar`
 *   (`aoFecharPeloNavegador`, src/components/dialogo-fechar.ts);
 * - ao fechar, o foco volta ao elemento que estava focado quando o diálogo abriu; se ele saiu do DOM (a linha removida)
 *   ou era o `body`, vai para o que `focoAoFechar` devolver (a tela indica o alvo: o título da lista, o botão vizinho).
 *   Vale também quando o pai desmonta o `<Dialogo>` aberto (o `close` não dispara; a limpeza do efeito devolve o foco);
 * - `rodape`: os botões; ausente → um botão "Fechar"; `null` → nenhum (quem tem formulário põe os botões no `<form>`,
 *   rolando com o corpo, ou no `rodape` com o atributo `form="<id do form>"` em cada botão).
 *
 * **Contrato: nunca dentro de `<form>` da tela.** Nenhum `<form>` embrulha o diálogo — o `<form>` de dentro ficaria
 * aninhado (HTML inválido) e os botões enviariam o formulário da tela. Quem precisa de formulário põe um `<form>`
 * **dentro** do diálogo e renderiza o `<Dialogo>` ao lado do formulário da tela, como a receita ou o exame (RN-394).
 * Foco, Esc e axe são provados no Playwright (EP-D54).
 */
export function Dialogo({
  aberto,
  titulo,
  descricao,
  aoFechar,
  children,
  rodape,
  ocupado = false,
  alerta = false,
  focoAoFechar,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  aoFechar: () => void;
  children?: ReactNode;
  rodape?: ReactNode;
  /** A action em andamento: `Esc` e "Fechar" não fecham; o "Fechar" fica `aria-disabled`. */
  ocupado?: boolean;
  /** `role="alertdialog"` (o `DialogoConfirmar` com `perigo`). */
  alerta?: boolean;
  /**
   * O alvo do foco ao fechar quando o elemento que abriu saiu do DOM ou era o `body` (chamado só nesse caso, depois do
   * `close`). Lembrete do contrato: o `<Dialogo>` nunca fica dentro de `<form>` da tela.
   */
  focoAoFechar?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const anterior = useRef<HTMLElement | null>(null);
  /** O estado que a tela deu por último: um fechamento que não veio dela (form method="dialog") também avisa `aoFechar`. */
  const abertoAgora = useRef(aberto);
  const aoFecharAgora = useRef(aoFechar);
  const ocupadoAgora = useRef(ocupado);
  const focoAoFecharAgora = useRef(focoAoFechar);
  /** O foco já voltou nesta abertura (o `close` devolveu): a desmontagem logo depois não devolve de novo. */
  const devolvido = useRef(false);
  const id = useId();
  const idTitulo = `${id}-titulo`;
  const idDescricao = `${id}-descricao`;

  useEffect(() => {
    aoFecharAgora.current = aoFechar;
    ocupadoAgora.current = ocupado;
    focoAoFecharAgora.current = focoAoFechar;
  }, [aoFechar, ocupado, focoAoFechar]);

  /** O foco de volta (ao fechar ou ao desmontar aberto): o elemento que abriu, se ainda está no DOM; senão, `focoAoFechar`. */
  const devolverFoco = useRef(() => {
    if (devolvido.current) return;
    devolvido.current = true;
    const volta = anterior.current;
    anterior.current = null;
    alvoDoFocoAoFechar<HTMLElement>(volta, focoAoFecharAgora.current)?.focus();
  });

  // Minor do /code-review do PR 1: o pai desmontou o <Dialogo> aberto — o `close` não dispara e o foco ficaria no `body`
  useEffect(() => {
    const d = ref.current;
    const devolver = devolverFoco.current;
    return () => {
      if (devolveFocoAoDesmontar({ aberto: abertoAgora.current, conectado: d?.isConnected ?? false, devolvido: devolvido.current })) devolver();
    };
  }, []);

  useEffect(() => {
    abertoAgora.current = aberto;
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      const ativo = document.activeElement;
      anterior.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null;
      devolvido.current = false;
      d.showModal();
      focoInicialDe(d)?.focus();
    } else if (!aberto && d.open) {
      d.close();
    }
  }, [aberto]);

  /** "Fechar"/"Cancelar" e `Esc`: com `ocupado`, nada acontece. */
  const pedirFechar = () => {
    if (!ocupadoAgora.current) aoFecharAgora.current();
  };

  return (
    <dialog
      ref={ref}
      role={alerta ? 'alertdialog' : undefined}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      aria-busy={ocupado || undefined}
      onCancel={(e) => {
        e.preventDefault(); // Esc: quem controla `aberto` fecha (e o foco volta pelo onClose); ocupado, não fecha
        pedirFechar();
      }}
      onClose={(e) => {
        // ocupado: o fechamento que não veio da tela (o segundo Esc do Chromium) não fura a trava — reabre, sem aoFechar
        const d = e.currentTarget;
        const acao = aoFecharPeloNavegador({ ocupado: ocupadoAgora.current, aberto: abertoAgora.current });
        if (acao.reabrir) {
          if (d.isConnected && !d.open) {
            d.showModal();
            focoInicialDe(d)?.focus();
          }
          return;
        }
        if (acao.devolverFoco) devolverFoco.current();
        if (acao.avisar) aoFecharAgora.current();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-borda bg-cartao p-6 text-texto shadow-xl backdrop:bg-[rgb(0_0_0/0.55)] open:flex open:flex-col"
    >
      <div className="shrink-0">
        <h2 id={idTitulo} className="font-titulo text-xl font-semibold">
          {titulo}
        </h2>
        {descricao && (
          <p id={idDescricao} className="mt-2">
            {descricao}
          </p>
        )}
      </div>
      {aberto && children !== undefined && (
        // só o corpo rola; p-2 (com a margem negativa) para o anel de foco não ser cortado pela rolagem (RNF-10/D25)
        <div className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
      )}
      {rodape === undefined ? (
        <div className="mt-6 flex shrink-0 flex-wrap justify-end gap-3">
          <Botao type="button" variante="secundario" onClick={pedirFechar} aria-disabled={ocupado || undefined} className="aria-disabled:opacity-60">
            Fechar
          </Botao>
        </div>
      ) : rodape === null ? null : (
        <div className="mt-6 flex shrink-0 flex-wrap justify-end gap-3">{rodape}</div>
      )}
    </dialog>
  );
}

/**
 * Confirmação com rótulos próprios ("Remover"/"Cancelar", "Excluir"/"Cancelar", "Mostrar no app"/"Cancelar"): o texto é
 * a descrição do diálogo. `perigo` (ação que apaga ou tira acesso): `role="alertdialog"` e o foco começa em "Cancelar";
 * sem `perigo`, na confirmação. `aoConfirmar` não fecha sozinho: quem abriu decide (por exemplo, fecha e chama a
 * action). `ocupado`: os dois botões ficam `aria-disabled` (o clique não faz nada) e `Esc` não fecha.
 */
export function DialogoConfirmar({
  aberto,
  titulo,
  texto,
  confirmar,
  cancelar = 'Cancelar',
  aoConfirmar,
  aoFechar,
  perigo = false,
  ocupado = false,
  focoAoFechar,
}: {
  aberto: boolean;
  titulo: string;
  texto: string;
  confirmar: string;
  cancelar?: string;
  aoConfirmar: () => void;
  aoFechar: () => void;
  perigo?: boolean;
  ocupado?: boolean;
  focoAoFechar?: () => HTMLElement | null;
}) {
  const desligado = ocupado || undefined;
  return (
    <Dialogo
      aberto={aberto}
      titulo={titulo}
      descricao={texto}
      aoFechar={aoFechar}
      ocupado={ocupado}
      alerta={perigo}
      focoAoFechar={focoAoFechar}
      rodape={
        <>
          <Botao
            type="button"
            variante="secundario"
            onClick={() => {
              if (!ocupado) aoFechar();
            }}
            aria-disabled={desligado}
            className="aria-disabled:opacity-60"
            data-foco-inicial={perigo ? '' : undefined}
          >
            {cancelar}
          </Botao>
          <Botao
            type="button"
            variante={perigo ? 'escuro' : 'primario'}
            onClick={() => {
              if (!ocupado) aoConfirmar();
            }}
            aria-disabled={desligado}
            className="aria-disabled:opacity-60"
            data-foco-inicial={perigo ? undefined : ''}
          >
            {confirmar}
          </Botao>
        </>
      }
    />
  );
}
