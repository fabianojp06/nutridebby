'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { cancelarLancamentoAction, type LancamentoState } from './actions';
import { ACAO_DA_LINHA, ErroGeral, PAINEL_DA_LINHA } from './comum';
import { useFocoNoErro } from './receber';

/**
 * US-302 / RN-309: "Cancelar lançamento" abre, abaixo da linha, o aviso de que não tem volta, o "Motivo do cancelamento"
 * e "Confirmar cancelamento". Sem motivo → "Informe o motivo do cancelamento." junto do campo, com o foco nele; cancelado
 * → a action volta à mesma tela com `?ok=cancelado`.
 */
export function Cancelar({
  id,
  volta,
  contexto = '',
}: {
  id: string;
  volta: string;
  contexto?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [state, action, pendente] = useActionState<LancamentoState, FormData>(
    cancelarLancamentoAction,
    {},
  );
  const form = useFocoNoErro(state);
  const painel = `cancelar-${id}`;
  const e = state.erros ?? {};
  return (
    <>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={painel}
        onClick={() => setAberto(!aberto)}
        data-guia="financeiro-cancelar"
        className={ACAO_DA_LINHA}
      >
        {MSG_FINANCEIRO.acoes.cancelar}
        {contexto && <span className="sr-only">{contexto}</span>}
      </button>
      {aberto && (
        <form
          id={painel}
          ref={form}
          key={state.envio}
          action={action}
          noValidate
          className={PAINEL_DA_LINHA}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="volta" value={volta} />
          <p id={`${painel}-aviso`}>{MSG_FINANCEIRO.avisoCancelar}</p>
          <Campo
            id={`${painel}-motivo`}
            name="motivo"
            rotulo={MSG_FINANCEIRO.acoes.motivo}
            autoComplete="off"
            defaultValue={state.valores?.motivo}
            erro={e.motivo}
          />
          <ErroGeral texto={e.geral} />
          <Botao variante="secundario" disabled={pendente} aria-describedby={`${painel}-aviso`}>
            {MSG_FINANCEIRO.acoes.confirmarCancelamento}
          </Botao>
        </form>
      )}
    </>
  );
}
