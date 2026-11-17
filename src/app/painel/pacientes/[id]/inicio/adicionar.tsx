'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import type { GrupoNoAdicionar } from '@/modules/ficha/adicionar';
import { MSG_FICHA } from '@/modules/ficha/textos';
import type { ChaveDeAcao } from '@/modules/ficha/tipos';

const ITEM = 'inline-flex min-h-11 w-full items-center rounded-xl px-3 text-left text-link underline hover:bg-linha';

/**
 * Plano 18 (US-263, RN-280): o botão "Adicionar" e o diálogo modal nativo "Adicionar ao prontuário". Ao abrir, o foco vai
 * ao título (o leitor de tela anuncia); Esc e "Fechar" fecham e o foco volta ao botão. Os links não pré-carregam (os
 * destinos gravam auditRead); Receita e Parecer nutricional são as Server Actions dos botões da aba Documentos.
 */
export function Adicionar({ grupos, acoes }: { grupos: GrupoNoAdicionar[]; acoes: Partial<Record<ChaveDeAcao, () => Promise<void>>> }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-haspopup="dialog"
        aria-label={MSG_FICHA.adicionarAoProntuario}
        data-guia="adicionar-prontuario"
        onClick={() => {
          dialogo.current?.showModal();
          titulo.current?.focus();
        }}
        className={classeDoBotao()}
      >
        <span aria-hidden="true">+</span> {MSG_FICHA.adicionar}
      </button>
      <dialog
        ref={dialogo}
        aria-labelledby="adicionar-titulo"
        onClose={() => botao.current?.focus()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl border border-borda bg-cartao p-6 text-texto shadow-xl backdrop:bg-[rgb(0_0_0/0.55)]"
      >
        <h2 id="adicionar-titulo" tabIndex={-1} ref={titulo} className="font-titulo text-xl font-semibold">{MSG_FICHA.adicionarAoProntuario}</h2>
        <p className="mt-2 text-sm text-suave">{MSG_FICHA.dica}</p>
        {grupos.map((g) => (
          <section key={g.grupo} aria-labelledby={`adicionar-${g.grupo}`} className="mt-4 space-y-1">
            <h3 id={`adicionar-${g.grupo}`} className="font-semibold">{g.titulo}</h3>
            <ul className="space-y-1">
              {g.itens.map((i) => {
                if ('href' in i)
                  return (
                    <li key={i.rotulo}>
                      <Link href={i.href} prefetch={false} className={ITEM}>{i.rotulo}</Link>
                    </li>
                  );
                const acao = acoes[i.acao];
                return acao ? (
                  <li key={i.rotulo}>
                    <form action={acao}>
                      <button type="submit" className={ITEM}>{i.rotulo}</button>
                    </form>
                  </li>
                ) : null;
              })}
            </ul>
          </section>
        ))}
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={() => dialogo.current?.close()} className={classeDoBotao('secundario')}>{MSG_FICHA.fechar}</button>
        </div>
      </dialog>
    </>
  );
}
