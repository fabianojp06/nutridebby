'use client';

import { distribuicaoMacros, gTexto, indicadorMeta, kcalTexto, type Nutrientes } from '@/modules/plano-alimentar/calculo';
import { MSG_DIAS, MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { formatarDecimal } from '@/lib/numero';

const COR = { verde: 'bg-ok-fundo text-ok', amarelo: 'bg-aviso-fundo text-aviso', vermelho: 'bg-erro-fundo text-erro' } as const;

type Props = {
  total: Nutrientes;
  meta: number | null;
  pesoKg: number | null;
  mostrarGkg: boolean;
  /**
   * Plano 19 (RN-247 a): em "Todos", com perfis de dia diferentes, o total de cada perfil ("seg a sex") no lugar do
   * total do dia — nunca a soma de todas as refeições — e o pedido para escolher um dia.
   */
  perfis?: { rotulo: string; total: Nutrientes }[];
};

/** US-022: total do dia × meta (RN-02, com texto, não só cor) e distribuição de macros. */
export function PainelTotais({ total, meta, pesoKg, mostrarGkg, perfis = [] }: Props) {
  if (perfis.length > 1) return <TotaisDosPerfis perfis={perfis} meta={meta} />;
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

/** A tabela dos perfis de dia: energia de cada um e o indicador da meta em texto (RN-02, WCAG 1.4.1). */
function TotaisDosPerfis({ perfis, meta }: { perfis: { rotulo: string; total: Nutrientes }[]; meta: number | null }) {
  return (
    <section aria-label="Totais do dia" className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
      <table className="text-sm">
        <caption className="sr-only">Total do dia em cada grupo de dias</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3 text-left">Dias</th>
            <th scope="col" className="pr-3 text-left">Total do dia</th>
            {meta !== null && <th scope="col" className="text-left">Meta: {kcalTexto(meta)} kcal</th>}
          </tr>
        </thead>
        <tbody>
          {perfis.map((p) => {
            const ind = indicadorMeta(p.total.kcal, meta);
            return (
              <tr key={p.rotulo}>
                <th scope="row" className="pr-3 text-left font-normal">{p.rotulo}</th>
                <td className="pr-3">{kcalTexto(p.total.kcal)} kcal</td>
                {meta !== null && <td>{ind ? <span className={`inline-block rounded px-2 py-0.5 font-semibold ${COR[ind.faixa]}`}>{ind.rotulo} ({ind.texto})</span> : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm text-suave">{MSG_DIAS.escolhaUmDia}</p>
    </section>
  );
}
