import { PainelTotais } from '@/app/painel/planos/editor/painel-totais';
import { Aviso } from '@/components/ui/aviso';
import { MSG_RASCUNHO_IA } from '@/modules/ia/constantes';
import type { PreviaRascunho } from '@/modules/ia/rascunho-ia';
import { quantidadeDoItem, totalDoDia } from '@/modules/plano-alimentar/calculo';

/**
 * US-121 "Prévia" (RN-02, RN-116): as refeições por horário, os itens em gramas e medida caseira e as substituições
 * ("ou …"); os totais, o indicador da meta (rótulo e texto, nunca só a cor) e os percentuais saem de `calculo.ts`, com o
 * mesmo painel do editor — nenhum número dito pelo modelo. O texto da IA (título, refeições, orientações) é texto puro.
 */
export function Previa({ previa }: { previa: PreviaRascunho }) {
  const { plano } = previa;
  const refeicoes = [...plano.refeicoes].sort((a, b) => a.horario.localeCompare(b.horario));
  const total = totalDoDia(plano.refeicoes.map((r) => ({ itens: r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId })) })));
  return (
    <section aria-labelledby="previa-titulo" className="space-y-4">
      <h3 id="previa-titulo" className="text-lg font-semibold">{MSG_RASCUNHO_IA.previa}</h3>
      <Aviso tipo="aviso">{MSG_RASCUNHO_IA.faixa}</Aviso>
      {previa.descartados > 0 && <p className="text-sm">{MSG_RASCUNHO_IA.descartados(previa.descartados)}</p>}
      {previa.foraDoCatalogo > 0 && <p className="text-sm">{MSG_RASCUNHO_IA.foraDoCatalogo(previa.foraDoCatalogo)}</p>}
      <p className="font-semibold wrap-break-word">{plano.titulo}</p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {refeicoes.map((r) => (
            <section key={r.id} aria-labelledby={`ref-${r.id}`} className="space-y-1 rounded-2xl border border-borda bg-cartao p-3">
              <h4 id={`ref-${r.id}`} className="font-semibold">{r.horario ? `${r.nome} · ${r.horario}` : r.nome}</h4>
              <ul className="space-y-1">
                {r.itens
                  .filter((i) => i.substituiItemId === null)
                  .map((i) => (
                    <li key={i.id}>
                      {`${i.nome} — ${quantidadeDoItem(i)}`}
                      {r.itens.some((s) => s.substituiItemId === i.id) && (
                        <ul className="ml-4 text-suave">
                          {r.itens
                            .filter((s) => s.substituiItemId === i.id)
                            .map((s) => (
                              <li key={s.id}>{`ou ${s.nome} — ${quantidadeDoItem(s)}`}</li>
                            ))}
                        </ul>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {plano.orientacoes && (
            <section aria-labelledby="previa-orientacoes" className="space-y-1">
              <h4 id="previa-orientacoes" className="font-semibold">Orientações</h4>
              <p className="whitespace-pre-line wrap-break-word">{plano.orientacoes}</p>
            </section>
          )}
        </div>
        <PainelTotais total={total} meta={plano.metaKcal} pesoKg={null} mostrarGkg={false} />
      </div>
    </section>
  );
}
