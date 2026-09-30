'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import type { TenantRow } from '@/db/schema';
import { COR_PADRAO, FUSOS_BRASIL } from '@/modules/plataforma/marca-constantes';
import { salvarPerfilAction, type PerfilState } from '../actions';

export function PerfilForm({ tenant }: { tenant: TenantRow }) {
  const [state, action, pendente] = useActionState<PerfilState, FormData>(salvarPerfilAction, {});
  const e = state.erros ?? {};
  // T10-R2/PF-N9: em erro, `state.valores` manda inteiro — inclusive campo opcional limpo de
  // propósito (endereço, link) — nunca cai de volta no valor salvo por causa de string vazia.
  const v = state.valores;
  return (
    <form action={action} className="space-y-4">
      <Campo id="nomeExibicao" rotulo="Nome de exibição" required defaultValue={v ? v.nomeExibicao : tenant.nomeExibicao} erro={e.nomeExibicao} />
      <Campo id="crn" rotulo="CRN" required defaultValue={v ? v.crn : (tenant.crn ?? '')} erro={e.crn} dica="Ex.: CRN-3 12345" />
      <Campo id="corPrimaria" rotulo="Cor principal" required defaultValue={v ? v.corPrimaria : (tenant.corPrimaria ?? COR_PADRAO)} erro={e.corPrimaria}
        dica="Formato #RRGGBB. O texto sobre a cor é branco, então ela precisa de contraste de pelo menos 4,5:1." />
      <Campo id="enderecoConsultorio" rotulo="Endereço do consultório" defaultValue={v ? v.enderecoConsultorio : (tenant.enderecoConsultorio ?? '')} erro={e.enderecoConsultorio} />
      <Campo id="linkOnlinePadrao" rotulo="Link padrão da consulta online" type="url" defaultValue={v ? v.linkOnlinePadrao : (tenant.linkOnlinePadrao ?? '')} erro={e.linkOnlinePadrao} />
      <Campo id="antecedenciaMinH" rotulo="Antecedência mínima para agendar (horas)" inputMode="numeric" defaultValue={v ? v.antecedenciaMinH : String(tenant.antecedenciaMinH)} erro={e.antecedenciaMinH} />
      <Campo id="cancelamentoMinH" rotulo="Cancelar ou remarcar até (horas antes)" inputMode="numeric" defaultValue={v ? v.cancelamentoMinH : String(tenant.cancelamentoMinH)} erro={e.cancelamentoMinH} />
      <div className="space-y-1">
        <label htmlFor="fuso" className="block font-medium">Fuso horário</label>
        <select id="fuso" name="fuso" defaultValue={v ? v.fuso : tenant.fuso} aria-invalid={e.fuso ? true : undefined} aria-describedby={e.fuso ? 'fuso-erro' : undefined} className="w-full rounded border p-2">
          {FUSOS_BRASIL.map((f) => <option key={f} value={f}>{f.replace('America/', '').replace('_', ' ')}</option>)}
        </select>
        {e.fuso && <p id="fuso-erro" role="alert" className="text-sm text-red-700">{e.fuso}</p>}
      </div>
      <div className="flex items-center gap-2">
        <input id="agendamentoPublicoAtivo" name="agendamentoPublicoAtivo" type="checkbox" defaultChecked={v ? v.agendamentoPublicoAtivo === 'on' : tenant.agendamentoPublicoAtivo} />
        <label htmlFor="agendamentoPublicoAtivo">Permitir agendamento pela página pública</label>
      </div>
      {state.ok && <p role="status">Perfil salvo.</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar perfil</button>
    </form>
  );
}
