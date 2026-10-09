'use client';

import { useActionState } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import { salvarMetricasAction, type MetricasState } from './actions';

/** D15: base do CS-03 (P-15, informada pela Debby no E-08) e início do uso (CS-01). */
export function MetricasForm({ tenantId, conta, taxaBase, goLiveEm }: { tenantId: string; conta: string; taxaBase: number | null; goLiveEm: string | null }) {
  const [state, action, pendente] = useActionState<MetricasState, FormData>(salvarMetricasAction.bind(null, tenantId), {});
  const id = `metricas-${tenantId}`;
  const erroEm = (campo: MetricasState['campo']) =>
    state.erro && state.campo === campo ? { 'aria-invalid': true, 'aria-describedby': `${id}-erro` } : {};
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-taxa`} className="block text-sm font-medium">Taxa de faltas antes do sistema (%)<span className="sr-only">{` de ${conta}`}</span></label>
        <input id={`${id}-taxa`} name="taxaBase" inputMode="decimal" defaultValue={taxaBase === null ? '' : String(taxaBase).replace('.', ',')} className="min-h-11 w-28 rounded-xl border border-campo bg-cartao px-3" {...erroEm('taxaBase')} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-data`} className="block text-sm font-medium">Início do uso<span className="sr-only">{` de ${conta}`}</span></label>
        <input id={`${id}-data`} name="goLiveEm" type="date" defaultValue={goLiveEm ?? ''} className="min-h-11 rounded-xl border border-campo bg-cartao px-3" {...erroEm('goLiveEm')} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pendente} className={classeDoBotao('secundario')}>Salvar<span className="sr-only">{` as métricas de ${conta}`}</span></button>
        {state.erro && <span id={`${id}-erro`} role="alert" className="text-sm text-erro">{state.erro}</span>}
        {state.ok && <span role="status" className="text-sm">Métricas salvas.</span>}
      </div>
    </form>
  );
}
