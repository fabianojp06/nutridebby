'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { salvarConfiguracoesAction, type CampoDaConfiguracao, type ConfiguracaoState } from './actions';

const C = MSG_FINANCEIRO.configuracoes;
const SECAO = 'space-y-3 rounded-3xl border border-borda bg-cartao p-5';

/**
 * US-300: saldo do caixa (data e valor) e valor da consulta, num envio só. `noValidate`: as mensagens são as do módulo,
 * junto do campo (`role="alert"`, `aria-describedby`); depois de um erro o formulário remonta (`key`) com o que foi
 * digitado (`valores`), porque no React 19 os campos não controlados voltam ao padrão depois da action.
 */
export function FormSaldo({ inicial }: { inicial: Record<CampoDaConfiguracao, string> }) {
  const [state, action, pendente] = useActionState<ConfiguracaoState, FormData>(salvarConfiguracoesAction, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} noValidate className="space-y-4">
      <section aria-labelledby="saldo-titulo" data-guia="financeiro-saldo" className={SECAO}>
        <h2 id="saldo-titulo" className="font-titulo text-lg font-semibold">
          {C.saldo}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="saldoInicialEm" rotulo={C.dataSaldo} type="date" defaultValue={v.saldoInicialEm} erro={e.saldoInicialEm} />
          <Campo id="saldoInicial" rotulo={C.valorSaldo} inputMode="decimal" autoComplete="off" defaultValue={v.saldoInicial} erro={e.saldoInicial} dica={C.ajudaSaldo} />
        </div>
      </section>
      <section aria-labelledby="valor-consulta-titulo" data-guia="financeiro-valor-consulta" className={SECAO}>
        <h2 id="valor-consulta-titulo" className="font-titulo text-lg font-semibold">
          {C.valorConsulta}
        </h2>
        <div className="sm:max-w-sm">
          <Campo id="valorConsulta" rotulo={C.valorConsulta} inputMode="decimal" autoComplete="off" defaultValue={v.valorConsulta} erro={e.valorConsulta} dica={C.ajudaValorConsulta} />
        </div>
      </section>
      {e.geral && (
        <p role="alert" className="text-erro">
          {e.geral}
        </p>
      )}
      <Botao disabled={pendente}>{C.salvar}</Botao>
    </form>
  );
}
