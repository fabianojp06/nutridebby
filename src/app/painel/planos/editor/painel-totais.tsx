'use client';

import { distribuicaoMacros, gTexto, indicadorMeta, kcalTexto, type Nutrientes } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { formatarDecimal } from '@/lib/numero';

const COR = { verde: 'bg-ok-fundo text-ok', amarelo: 'bg-aviso-fundo text-aviso', vermelho: 'bg-erro-fundo text-erro' } as const;

/** US-022: total do dia × meta (RN-02, com texto, não só cor) e distribuição de macros. */
export function PainelTotais({ total, meta, pesoKg, mostrarGkg }: { total: Nutrientes; meta: number | null; pesoKg: number | null; mostrarGkg: boolean }) {
  const ind = indicadorMeta(total.kcal, meta);
  const d = distribuicaoMacros(total, pesoKg);
  const linha = (rotulo: string, m: { g: number; gPorKg: number | null; pctVet: number | null }) => (
    <tr>
      <th scope="row" className="pr-3 text-left font-normal">{rotulo}</th>
      <td>{gTexto(m.g)} g</td>
      {mostrarGkg && <td>{m.gPorKg === null ? '—' : `${formatarDecimal(m.gPorKg, 2)} g/kg`}</td>}
      <td>{m.pctVet === null ? '—' : `${formatarDecimal(m.pctVet, 0)}% do VET`}</td>
    </tr>
  );
  return (
    <section aria-label="Totais do dia" className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
      <p className="text-lg">
        Total do dia: <strong>{kcalTexto(total.kcal)} kcal</strong>
        {meta !== null && <> · Meta: {kcalTexto(meta)} kcal</>}
      </p>
      {ind && (
        <p data-testid="indicador-meta" className={`inline-block rounded px-2 py-1 font-semibold ${COR[ind.faixa]}`}>
          {ind.rotulo} ({ind.texto})
        </p>
      )}
      <table className="text-sm">
        <caption className="sr-only">Distribuição de macronutrientes</caption>
        <tbody>
          {linha('Proteína', d.proteina)}
          {linha('Carboidrato', d.carboidrato)}
          {linha('Lipídio', d.lipidio)}
          <tr>
            <th scope="row" className="pr-3 text-left font-normal">Fibra</th>
            <td>{gTexto(d.fibraG)} g</td>
          </tr>
        </tbody>
      </table>
      {mostrarGkg && pesoKg === null && <p className="text-sm text-suave">{MSG_PLANO.semPeso}</p>}
    </section>
  );
}
