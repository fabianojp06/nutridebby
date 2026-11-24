'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { aceitarTermoAction, type AceiteDoTermoState } from './actions';

const ERRO_ID = 'erro-aceite-termo';

/**
 * Revisão do code review do PR 2 do Plano 26 (RN-500): a caixa e o botão do aceite da versão em vigor do Termo de
 * confidencialidade da equipe. `rotulo`, `botao` e `versao` vêm da página (servidor); a action confere tudo de novo.
 * A caixa de 20 px, como no convite da recepção, e o `Botao` de 44 px (WCAG 2.5.8).
 */
export function AceiteDoTermo({ rotulo, botao, versao }: { rotulo: string; botao: string; versao: string }) {
  const [state, action, pendente] = useActionState<AceiteDoTermoState, FormData>(aceitarTermoAction, {});
  return (
    <form action={action} className="space-y-3">
      {/* P08-06: a versão que a pessoa leu; a action recusa se a versão em vigor mudou com a página aberta */}
      <input type="hidden" name="versao" value={versao} />
      <div className="flex items-start gap-2">
        <input
          id="sigilo"
          name="sigilo"
          type="checkbox"
          className="mt-1 size-5 shrink-0"
          aria-invalid={state.erro ? true : undefined}
          aria-describedby={state.erro ? ERRO_ID : undefined}
        />
        <label htmlFor="sigilo">{rotulo}</label>
      </div>
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
      <Botao disabled={pendente} className="w-full">
        {botao}
      </Botao>
    </form>
  );
}
