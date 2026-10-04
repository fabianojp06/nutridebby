'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import { formatarDecimal, lerDecimal } from '@/lib/numero';
import { CIRCUNFERENCIAS, MSG_ANTROPO } from '@/modules/pacientes/antropometria-constantes'; // nunca de antropometria.ts (servidor)
import { idadeEm } from '@/modules/pacientes/datas';
import { calcularGordura, DOBRAS, dobrasDoProtocolo, dobrasNormalizadas, imc, type Protocolo, type Sexo } from '@/modules/pacientes/formulas';
import type { AntropometriaState } from './actions';

type Props = {
  acao: (prev: AntropometriaState, formData: FormData) => Promise<AntropometriaState>;
  hoje: string;
  sexo: Sexo | null;
  dataNascimento: string | null;
  somenteLeitura: boolean;
  consultationId?: string;
};

export function AntropometriaForm({ acao, hoje, sexo, dataNascimento, somenteLeitura, consultationId }: Props) {
  const [state, action, pendente] = useActionState<AntropometriaState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-4">
      {consultationId && <input type="hidden" name="consultationId" value={consultationId} />}
      {consultationId && <p className="text-sm text-suave">Esta avaliação fica ligada ao atendimento.</p>}
      <fieldset disabled={somenteLeitura}>
        <Campos key={state.envio ?? 0} inicial={state.valores ?? { data: hoje, protocolo: 'nenhum' }} erros={state.erros ?? {}} hoje={hoje} sexo={sexo} dataNascimento={dataNascimento} />
      </fieldset>
      {state.erros?.geral && <p role="alert" className="text-erro">{state.erros.geral}</p>}
      {state.ok && <p role="status">{state.aviso ? `Avaliação salva. ${state.aviso}` : 'Avaliação salva.'}</p>}
      {!somenteLeitura && <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-110">Salvar avaliação</button>}
    </form>
  );
}

function Campos(props: { inicial: Record<string, string>; erros: Record<string, string>; hoje: string; sexo: Sexo | null; dataNascimento: string | null }) {
  const [v, setV] = useState<Record<string, string>>(props.inicial);
  const mudar = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((a) => ({ ...a, [k]: e.target.value }));
  const num = (k: string) => {
    const n = lerDecimal(v[k] ?? '');
    return typeof n === 'number' && !Number.isNaN(n) ? n : null;
  };
  const peso = num('pesoKg');
  const altura = num('alturaCm');
  const protocolo = (v.protocolo ?? 'nenhum') as Protocolo | 'nenhum';
  const visiveis = protocolo === 'nenhum' || !props.sexo ? DOBRAS : DOBRAS.filter((d) => dobrasDoProtocolo(protocolo, props.sexo!).includes(d.id));
  let previaGordura: string | null = null;
  // mesmas faixas e arredondamento do servidor: a prévia nunca mostra o que o servidor recusaria
  const dataOk = Boolean(v.data) && v.data <= props.hoje && (!props.dataNascimento || v.data >= props.dataNascimento);
  if (protocolo !== 'nenhum' && props.sexo && props.dataNascimento && dataOk) {
    const r = calcularGordura(protocolo, props.sexo, idadeEm(props.dataNascimento, v.data), dobrasNormalizadas(Object.fromEntries(DOBRAS.map((d) => [d.id, num(`dobra_${d.id}`)]))));
    previaGordura = r.ok ? `% de gordura: ${formatarDecimal(r.percGordura, 2)}` : MSG_ANTROPO.dobrasFaltando(dobrasDoProtocolo(protocolo, props.sexo).length);
  }
  const entrada = (k: string, rotulo: string, extra: { max?: string; type?: string; inputMode?: 'decimal' } = { inputMode: 'decimal' }) => (
    <div className="space-y-1" key={k}>
      <label htmlFor={k} className="block font-medium">{rotulo}</label>
      <input id={k} name={k} value={v[k] ?? ''} onChange={mudar(k)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...extra}
        aria-invalid={props.erros[k] ? true : undefined} aria-describedby={props.erros[k] ? `${k}-erro` : undefined} />
      {props.erros[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{props.erros[k]}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {entrada('data', 'Data da avaliação', { type: 'date', max: props.hoje })}
        {entrada('pesoKg', 'Peso (kg)')}
        {entrada('alturaCm', 'Altura (cm)')}
      </div>
      <p aria-live="polite">{peso !== null && altura !== null && peso >= 1 && peso <= 400 && altura >= 30 && altura <= 250 ? `IMC: ${formatarDecimal(imc(peso, altura), 2)}` : 'IMC: informe peso e altura'}</p>
      <fieldset className="space-y-2">
        <legend className="font-medium">Circunferências (cm)</legend>
        <div className="grid gap-3 sm:grid-cols-3">{CIRCUNFERENCIAS.map((c) => entrada(`circ_${c.id}`, c.rotulo))}</div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="protocolo" className="block font-medium">Protocolo de dobras</label>
        <select id="protocolo" name="protocolo" value={protocolo} onChange={mudar('protocolo')} className="rounded-xl border border-campo bg-cartao p-2 text-texto">
          <option value="nenhum">Nenhum</option>
          <option value="jp3">JP 3 dobras</option>
          <option value="jp7">JP 7 dobras</option>
        </select>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Dobras cutâneas (mm)</legend>
        <div className="grid gap-3 sm:grid-cols-3">{visiveis.map((d) => entrada(`dobra_${d.id}`, d.rotulo))}</div>
      </fieldset>
      {previaGordura && <p aria-live="polite">{previaGordura}</p>}
    </div>
  );
}
