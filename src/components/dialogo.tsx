'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';

/**
 * Plano 22 (EP-D42) — o diálogo modal COMPARTILHADO do painel e do portal (decisão da orquestradora de 17/11/2026: o
 * Plano 23 usa este mesmo componente, sem cópia). Diálogos e confirmações com rótulos próprios passam por aqui, nunca
 * por `window.confirm`/`ConfirmarBotao` nas telas novas.
 *
 * - `<dialog>` + `showModal()` quando `aberto` (foco preso no diálogo pelo navegador; o fundo fica inerte);
 * - nome acessível pelo h2 do título (`aria-labelledby`, `useId`); `descricao` opcional ligada por `aria-describedby`;
 * - foco inicial no elemento marcado com `data-foco-inicial` dentro do diálogo; sem ele, o padrão do navegador (o
 *   primeiro elemento focável);
 * - `Esc` (evento `cancel`) chama `aoFechar` — quem abriu decide fechar (o diálogo é controlado por `aberto`);
 * - ao fechar, o foco volta ao elemento que estava focado quando o diálogo abriu;
 * - `rodape`: os botões; ausente → um botão "Fechar"; `null` → nenhum (quem tem formulário põe os botões no `<form>`).
 *
 * Nenhum `<form>` embrulha o diálogo: quem precisa de formulário põe um `<form>` **dentro** dele (fora do formulário da
 * tela, como a receita ou o exame — RN-394). Foco, Esc e axe são provados no Playwright (EP-D54).
 */
export function Dialogo({
  aberto,
  titulo,
  descricao,
  aoFechar,
  children,
  rodape,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  aoFechar: () => void;
  children?: ReactNode;
  rodape?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const anterior = useRef<HTMLElement | null>(null);
  /** O estado que a tela deu por último: um fechamento que não veio dela (form method="dialog") também avisa `aoFechar`. */
  const abertoAgora = useRef(aberto);
  const aoFecharAgora = useRef(aoFechar);
  const id = useId();
  const idTitulo = `${id}-titulo`;
  const idDescricao = `${id}-descricao`;

  useEffect(() => {
    aoFecharAgora.current = aoFechar;
  }, [aoFechar]);

  useEffect(() => {
    abertoAgora.current = aberto;
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      anterior.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      d.querySelector<HTMLElement>('[data-foco-inicial]')?.focus();
    } else if (!aberto && d.open) {
      d.close();
    }
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      onCancel={(e) => {
        e.preventDefault(); // Esc: quem controla `aberto` fecha (e o foco volta pelo onClose)
        aoFecharAgora.current();
      }}
      onClose={() => {
        const volta = anterior.current;
        anterior.current = null;
        if (volta?.isConnected) volta.focus();
        if (abertoAgora.current) aoFecharAgora.current();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-borda bg-cartao p-6 text-texto shadow-xl backdrop:bg-[rgb(0_0_0/0.55)]"
    >
      <h2 id={idTitulo} className="font-titulo text-xl font-semibold">
        {titulo}
      </h2>
      {descricao && (
        <p id={idDescricao} className="mt-2">
          {descricao}
        </p>
      )}
      {children !== undefined && <div className="mt-4">{children}</div>}
      {rodape === undefined ? (
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Botao type="button" variante="secundario" onClick={() => aoFecharAgora.current()}>
            Fechar
          </Botao>
        </div>
      ) : rodape === null ? null : (
        <div className="mt-6 flex flex-wrap justify-end gap-3">{rodape}</div>
      )}
    </dialog>
  );
}

/**
 * Confirmação com rótulos próprios ("Remover"/"Cancelar", "Excluir"/"Cancelar", "Mostrar no app"/"Cancelar"): o texto é
 * a descrição do diálogo. `perigo` (ação que apaga ou tira acesso): o foco começa em "Cancelar"; sem `perigo`, na
 * confirmação. `aoConfirmar` não fecha sozinho: quem abriu decide (por exemplo, fecha e chama a action).
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
}: {
  aberto: boolean;
  titulo: string;
  texto: string;
  confirmar: string;
  cancelar?: string;
  aoConfirmar: () => void;
  aoFechar: () => void;
  perigo?: boolean;
}) {
  return (
    <Dialogo
      aberto={aberto}
      titulo={titulo}
      descricao={texto}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="button" variante="secundario" onClick={aoFechar} data-foco-inicial={perigo ? '' : undefined}>
            {cancelar}
          </Botao>
          <Botao type="button" variante={perigo ? 'escuro' : 'primario'} onClick={aoConfirmar} data-foco-inicial={perigo ? undefined : ''}>
            {confirmar}
          </Botao>
        </>
      }
    />
  );
}
