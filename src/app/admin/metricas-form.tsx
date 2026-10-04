'use client';

import { useActionState } from 'react';
import { salvarMetricasAction, type MetricasState } from './actions';

/** D15: base do CS-03 (P-15, informada pela Debby no E-08) e início do uso (CS-01). */
export function MetricasForm({ tenantId, conta, taxaBase, goLiveEm }: { tenantId: string; conta: string; taxaBase: number | null; goLiveEm: string | null }) {
  const [state, action, pendente] = useActionState<MetricasState, FormData>(salvarMetricasAction.bind(null, tenantId), {});
  const id = `metricas-${tenantId}`;
  const erroEm = (campo: MetricasState['campo']) =>
    state.erro && state.campo === campo ? { 'aria-invalid': true, 'aria-describedby': `${id}-erro` } : {};
  return (
    <form action={action} className="space-y-1">
      <label htmlFor={`${id}-taxa`} className="block text-sm">Taxa de faltas antes do sistema (%)<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={`${id}-taxa`} name="taxaBase" inputMode="decimal" defaultValue={taxaBase === null ? '' : String(taxaBase).replace('.', ',')} className="w-24 rounded border p-1" {...erroEm('taxaBase')} />
      <label htmlFor={`${id}-data`} className="block text-sm">Início do uso<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={`${id}-data`} name="goLiveEm" type="date" defaultValue={goLiveEm ?? ''} className="rounded border p-1" {...erroEm('goLiveEm')} />
      <button disabled={pendente} className="block underline">Salvar<span className="sr-only">{` as métricas de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="text-red-700">{state.erro}</span>}
      {state.ok && <span role="status">Métricas salvas.</span>}
    </form>
  );
}
