'use client';

import { useActionState, useEffect, useRef } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import { MSG_EQUIPE } from '@/modules/plataforma/equipe-textos';
import { convidarAction, type ConvidarState } from './actions';

const CAMPO = 'min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const ERRO = { nome: 'erro-equipe-nome', email: 'erro-equipe-email', geral: 'erro-equipe-geral' } as const;

/**
 * Plano 26 (US-488, §7.2): "Convidar recepcionista" abre na própria página (`<details>`), com o foco no campo "Nome". Volta
 * aberto quando a action devolve erro, com os valores digitados, cada erro ligado ao campo por `aria-describedby` e o foco
 * no primeiro campo com erro (ou no erro geral). `noValidate`: as mensagens são as da spec, não as do navegador. O sucesso
 * volta pela URL (`?ok=convidada`), e a página anuncia.
 */
export function ConvidarForm() {
  const [state, action, pendente] = useActionState<ConvidarState, FormData>(convidarAction, {});
  const nome = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const geral = useRef<HTMLParagraphElement>(null);
  const erros = state.erros ?? {};

  useEffect(() => {
    if (!state.envio) return;
    if (state.erros?.nome) nome.current?.focus();
    else if (state.erros?.email) email.current?.focus();
    else geral.current?.focus();
  }, [state.envio, state.erros]);

  return (
    <details
      open={state.erros ? true : undefined}
      onToggle={(e) => {
        if (e.currentTarget.open && !state.erros) nome.current?.focus();
      }}
      className="max-w-xl"
    >
      <summary className={`${classeDoBotao('primario')} cursor-pointer list-none`}>{MSG_EQUIPE.convidar}</summary>
      <form key={state.envio ?? 'novo'} action={action} noValidate className="mt-4 space-y-4 rounded-3xl border border-borda bg-cartao p-5">
        <p id="dica-convite" className="text-suave">{MSG_EQUIPE.dicaConvite}</p>
        <div className="space-y-1">
          <label htmlFor="equipe-nome" className="block font-medium">{MSG_EQUIPE.campos.nome}</label>
          <input
            ref={nome}
            id="equipe-nome"
            name="nome"
            type="text"
            autoComplete="off"
            defaultValue={state.valores?.nome}
            aria-invalid={erros.nome ? true : undefined}
            aria-describedby={erros.nome ? ERRO.nome : undefined}
            className={CAMPO}
          />
          {erros.nome && <p id={ERRO.nome} className="text-erro">{erros.nome}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="equipe-email" className="block font-medium">{MSG_EQUIPE.campos.email}</label>
          <input
            ref={email}
            id="equipe-email"
            name="email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            defaultValue={state.valores?.email}
            aria-invalid={erros.email ? true : undefined}
            aria-describedby={erros.email ? ERRO.email : undefined}
            className={CAMPO}
          />
          {erros.email && <p id={ERRO.email} className="text-erro">{erros.email}</p>}
        </div>
        <div className="flex items-start gap-2">
          <input id="equipe-financeiro" name="financeiro" type="checkbox" defaultChecked={state.valores?.financeiro} aria-describedby="dica-financeiro" className="mt-1 size-5" />
          <div>
            <label htmlFor="equipe-financeiro" className="font-medium">{MSG_EQUIPE.campos.financeiro}</label>
            <p id="dica-financeiro" className="text-suave">{MSG_EQUIPE.dicaFinanceiro}</p>
          </div>
        </div>
        {erros.geral && (
          <p ref={geral} id={ERRO.geral} tabIndex={-1} role="alert" className="font-medium text-erro">
            {erros.geral}
          </p>
        )}
        <button disabled={pendente} className={classeDoBotao('primario')}>{MSG_EQUIPE.enviar}</button>
      </form>
    </details>
  );
}
