'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import type { TipoLancamento } from '@/db/schema/financeiro';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import {
  desfazerRecebimentoAction,
  receberLancamentoAction,
  type LancamentoState,
} from './actions';
import { ACAO_DA_LINHA, ErroGeral, OpcoesDeForma, PAINEL_DA_LINHA, Selecao } from './comum';

const A = MSG_FINANCEIRO.acoes;
const DO_TIPO: Record<TipoLancamento, string> = {
  entrada: ' o recebimento',
  saida: ' o pagamento',
};

type Props = {
  id: string;
  tipo: TipoLancamento;
  /** Já recebido/pago: o botão é "Desfazer recebimento/pagamento". */
  recebido: boolean;
  /** A data sugerida (hoje no fuso do consultório). */
  hoje: string;
  /** A tela para onde a action volta (a lista com os filtros, ou a edição). */
  volta: string;
  /** Na lista: o que identifica a linha no nome acessível do botão (WCAG 2.5.3: começa pelo texto visível). */
  contexto?: string;
};

/** Foco no primeiro campo com erro, ou no erro geral (o botão fica desabilitado durante o envio e perderia o foco). */
export function useFocoNoErro(state: LancamentoState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.erros)
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-erro-geral]')?.focus();
  }, [state]);
  return form;
}

/**
 * O alvo do manual guiado (`data-guia`) vai em todas as linhas: o tour marca o primeiro da tela.
 *
 * US-302: "Marcar como recebido/pago" abre, abaixo da linha, a data (hoje) e a forma, com "Confirmar"; recebido ou pago,
 * o botão é "Desfazer recebimento/pagamento". Deu certo → a action volta à mesma tela com `?ok=` (foco no h1 e a mensagem
 * na região fixa, §7, mesmo que a linha saia da lista filtrada); recusado → o erro junto do campo, com o digitado.
 */
export function Receber(props: Props) {
  return props.recebido ? <Desfazer {...props} /> : <MarcarComoRecebido {...props} />;
}

function MarcarComoRecebido({ id, tipo, hoje, volta, contexto = '' }: Props) {
  const [aberto, setAberto] = useState(false);
  const [state, action, pendente] = useActionState<LancamentoState, FormData>(
    receberLancamentoAction,
    {},
  );
  const form = useFocoNoErro(state);
  const painel = `receber-${id}`;
  const v = state.valores ?? { pagoEm: hoje, forma: '' };
  const e = state.erros ?? {};
  return (
    <>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={painel}
        onClick={() => setAberto(!aberto)}
        data-guia="financeiro-receber"
        className={ACAO_DA_LINHA}
      >
        {A.marcarPago[tipo]}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              id={`${painel}-pagoEm`}
              name="pagoEm"
              rotulo={MSG_FINANCEIRO.campos.dataDoPagamento[tipo]}
              type="date"
              defaultValue={v.pagoEm}
              erro={e.pagoEm}
            />
            <Selecao
              id={`${painel}-forma`}
              name="forma"
              rotulo={MSG_FINANCEIRO.campos.forma}
              defaultValue={v.forma}
              erro={e.forma}
            >
              <OpcoesDeForma />
            </Selecao>
          </div>
          <ErroGeral texto={e.geral} />
          <Botao variante="secundario" disabled={pendente}>
            Confirmar
            <span className="sr-only">{DO_TIPO[tipo]}</span>
          </Botao>
        </form>
      )}
    </>
  );
}

function Desfazer({ id, tipo, volta, contexto = '' }: Props) {
  const [state, action, pendente] = useActionState<LancamentoState, FormData>(
    desfazerRecebimentoAction,
    {},
  );
  // a única recusa é a geral (cancelado ou anonimizado no meio): o foco vai a ela
  const form = useFocoNoErro(state);
  return (
    <form ref={form} action={action} className="contents">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="volta" value={volta} />
      <button disabled={pendente} data-guia="financeiro-receber" className={ACAO_DA_LINHA}>
        {A.desfazer[tipo]}
        {contexto && <span className="sr-only">{contexto}</span>}
      </button>
      {state.erros?.geral && (
        <span className="basis-full">
          <ErroGeral texto={state.erros.geral} />
        </span>
      )}
    </form>
  );
}
