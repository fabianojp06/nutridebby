'use client';

import { useActionState, useState } from 'react';
import { arredondar, formatarDecimal, lerDecimal } from '@/lib/numero';
import { compararTmb, FATOR_MAX, FATOR_MIN, FORMULAS_TMB, gastoTotal, kcal, type FormulaTmb, type Sexo } from '@/modules/pacientes/formulas';
import type { CalculoState } from './actions';

type Props = {
  acao: (prev: CalculoState, formData: FormData) => Promise<CalculoState>;
  sexo: Sexo;
  idade: number;
  pesoKg: number | null;
  alturaCm: number | null;
};

const valido = (n: number | null, min: number, max: number): n is number => typeof n === 'number' && !Number.isNaN(n) && n >= min && n <= max;

/** US-014 "Comparar fórmulas": as 3 TMB lado a lado enquanto digita; salva a escolhida com o fator. */
export function CalculoForm({ acao, sexo, idade, pesoKg, alturaCm }: Props) {
  const [state, action, pendente] = useActionState<CalculoState, FormData>(acao, {});
  const [peso, setPeso] = useState(pesoKg === null ? '' : formatarDecimal(pesoKg, 2)); // peso é numeric(5,2): 60,25 não pode virar 60,3 na TMB
  const [altura, setAltura] = useState(alturaCm === null ? '' : formatarDecimal(alturaCm, 1));
  const [fator, setFator] = useState('1,20');
  const [formula, setFormula] = useState<FormulaTmb>('mifflin');
  const p = lerDecimal(peso);
  const a = lerDecimal(altura);
  const f = lerDecimal(fator);
  // mesmos arredondamentos que o servidor grava (peso 2 casas, altura 1)
  const comparacao = valido(p, 1, 400) && valido(a, 30, 250) ? compararTmb({ sexo, pesoKg: arredondar(p, 2), alturaCm: arredondar(a, 1), idade }) : null;
  const e = state.erros ?? {};
  const erroDe = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['pesoKg', 'Peso (kg)', peso, setPeso],
            ['alturaCm', 'Altura (cm)', altura, setAltura],
            ['fator', 'Fator de atividade', fator, setFator],
          ] as const
        ).map(([k, rotulo, valor, set]) => (
          <div key={k} className="space-y-1">
            <label htmlFor={k} className="block font-medium">{rotulo}</label>
            <input id={k} name={k} inputMode="decimal" value={valor} onChange={(ev) => set(ev.target.value)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...erroDe(k)} />
            {e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>}
          </div>
        ))}
      </div>
      <p className="text-sm text-suave">{`Idade usada: ${idade} anos. Fator de ${formatarDecimal(FATOR_MIN, 2)} a ${formatarDecimal(FATOR_MAX, 2)}.`}</p>
      <fieldset>
        <legend className="font-medium">Fórmula</legend>
        <table className="w-full text-left">
          <caption className="sr-only">Comparação das fórmulas de taxa metabólica basal</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Usar</th>
              <th scope="col">Fórmula</th>
              <th scope="col">TMB (kcal)</th>
              <th scope="col">GET (kcal)</th>
            </tr>
          </thead>
          <tbody>
            {FORMULAS_TMB.map((fo) => {
              const t = comparacao?.[fo.id];
              return (
                <tr key={fo.id} className="border-t border-linha">
                  <td>
                    <input id={`formula-${fo.id}`} name="formula" type="radio" value={fo.id} checked={formula === fo.id} onChange={() => setFormula(fo.id)} />
                  </td>
                  <td><label htmlFor={`formula-${fo.id}`}>{fo.nome}</label></td>
                  <td>{t === undefined ? '—' : String(kcal(t))}</td>
                  <td>{t === undefined || !valido(f, FATOR_MIN, FATOR_MAX) ? '—' : String(kcal(gastoTotal(t, arredondar(f, 2))))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {e.formula && <p role="alert" className="text-sm text-erro">{e.formula}</p>}
      </fieldset>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {state.ok && <p role="status">{`Cálculo salvo: TMB ${state.ok.tmb} kcal, GET ${state.ok.get} kcal.`}</p>}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Salvar cálculo</button>
    </form>
  );
}
