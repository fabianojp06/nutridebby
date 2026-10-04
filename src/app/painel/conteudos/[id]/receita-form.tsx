'use client';
import { useActionState, useId, useRef, useState } from 'react';
import { BuscaAlimento, Selo } from '@/app/painel/alimentos/busca-alimento';
import { casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import { MODO_PREPARO_MAX, INGREDIENTES_MAX, MEDIDA_TXT_MAX } from '@/modules/conteudo/constantes';
import { nutrientesPorPorcao, textoPorPorcao } from '@/modules/conteudo/receita-calculo';
import type { ReceitaLida } from '@/modules/conteudo/receitas';
import { lerQuantidade } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { salvarReceitaAction, type ReceitaState } from '../actions';

type Linha = ReceitaLida['ingredientes'][number] & { chave: string; gramasTexto: string; medidaTexto: string };
const num = (n: number) => formatarDecimal(n, casasDecimais(n));
const positivo = (t: string) => {
  const n = lerDecimal(t);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
};

/** US-051: rendimento, porção, tempo, modo de preparo e ingredientes (TACO + "Meu alimento"), com a conta por porção ao vivo. */
export function ReceitaForm({ id, inicial }: { id: string; inicial: ReceitaLida | null }) {
  const [s, enviar, enviando] = useActionState<ReceitaState, FormData>(salvarReceitaAction.bind(null, id), {});
  const [rendimento, setRendimento] = useState(inicial ? num(inicial.rendimentoG) : '');
  const [porcao, setPorcao] = useState(inicial ? num(inicial.porcaoG) : '');
  const [tempo, setTempo] = useState(inicial?.tempoMin ? String(inicial.tempoMin) : '');
  const [modo, setModo] = useState(inicial?.modoPreparo ?? '');
  // chave (e id dos campos) = useId + contador: igual no servidor e no cliente (sem erro de hidratação) e sem depender
  // de `crypto.randomUUID`, que o navegador só oferece em HTTPS/localhost
  const prefixo = useId();
  const iniciais = inicial?.ingredientes ?? [];
  const proxima = useRef(iniciais.length);
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    iniciais.map((i, k) => ({ ...i, chave: `${prefixo}-${k}`, gramasTexto: num(i.quantidadeG), medidaTexto: i.medidaCaseiraTxt ?? '' })),
  );
  const erro = (c: string) => s.erros?.[c];
  const calc = nutrientesPorPorcao(linhas.map((l) => ({ porCem: l.porCem, quantidadeG: lerQuantidade(l.gramasTexto) })), positivo(rendimento), positivo(porcao));
  const mudar = (chave: string, campo: 'gramasTexto' | 'medidaTexto', valor: string) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  const json = JSON.stringify(linhas.map((l) => ({ foodId: l.foodId, quantidadeG: l.gramasTexto, medida: l.medidaTexto })));
  const campo = (c: string, nome: string, rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <label htmlFor={nome} className="block font-medium">{rotulo}</label>
      <input id={nome} name={nome} inputMode="decimal" value={valor} onChange={(e) => set(e.target.value)} aria-invalid={erro(c) ? true : undefined} aria-describedby={erro(c) ? `${nome}-erro` : undefined} className="w-32 rounded border p-2" />
      {erro(c) && <p id={`${nome}-erro`} role="alert" className="text-sm text-red-700">{erro(c)}</p>}
    </div>
  );
  return (
    <section aria-labelledby="receita-titulo" className="space-y-4 rounded border p-4">
      <h2 id="receita-titulo" className="font-semibold">Receita</h2>
      <form action={enviar} className="space-y-4">
        <input type="hidden" name="ingredientes" value={json} />
        {erro('geral') && <p role="alert" className="text-red-700">{erro('geral')}</p>}
        <div className="flex flex-wrap gap-4">
          {campo('rendimento', 'rendimento', 'Rendimento total (g)', rendimento, setRendimento)}
          {campo('porcao', 'porcao', 'Porção (g)', porcao, setPorcao)}
          {campo('tempo', 'tempo', 'Tempo de preparo (min)', tempo, setTempo)}
        </div>
        <fieldset className="space-y-2" aria-describedby={erro('ingredientes') ? 'ingredientes-erro' : undefined}>
          <legend className="font-medium">Ingredientes</legend>
          <ul className="space-y-2">
            {linhas.map((l, k) => {
              const eq = erro(`ingrediente:${k}:quantidade`);
              const em = erro(`ingrediente:${k}:medida`);
              const msg = eq ?? erro(`ingrediente:${k}:alimento`) ?? em;
              return (
                <li key={l.chave} className="flex flex-wrap items-end gap-3">
                  <p className="min-w-48 flex-1">{l.nome} <Selo origem={l.origem} />{l.porCem.kcal === null && <span className="ml-2 text-sm text-zinc-600">{MSG_PLANO.semValor}</span>}</p>
                  <div className="space-y-1">
                    <label htmlFor={`${l.chave}-g`} className="block text-sm">{`Gramas de ${l.nome}`}</label>
                    <input id={`${l.chave}-g`} inputMode="decimal" value={l.gramasTexto} onChange={(e) => mudar(l.chave, 'gramasTexto', e.target.value)} aria-invalid={eq ? true : undefined} aria-describedby={eq ? `${l.chave}-erro` : undefined} className="w-24 rounded border p-2" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${l.chave}-m`} className="block text-sm">{`Medida caseira de ${l.nome} (opcional)`}</label>
                    <input id={`${l.chave}-m`} maxLength={MEDIDA_TXT_MAX} value={l.medidaTexto} onChange={(e) => mudar(l.chave, 'medidaTexto', e.target.value)} aria-invalid={em ? true : undefined} aria-describedby={em && !eq ? `${l.chave}-erro` : undefined} className="w-40 rounded border p-2" />
                  </div>
                  <button type="button" className="text-sm underline" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>{`Remover ${l.nome}`}</button>
                  {msg && <p id={`${l.chave}-erro`} role="alert" className="w-full text-sm text-red-700">{msg}</p>}
                </li>
              );
            })}
          </ul>
          {linhas.length < INGREDIENTES_MAX && (
            <BuscaAlimento
              rotulo="Adicionar ingrediente"
              aoEscolher={(a) => {
                const chave = `${prefixo}-${proxima.current++}`;
                setLinhas((ls) => [...ls, { foodId: a.id, nome: a.nome, origem: a.origem, porCem: a.porCem, quantidadeG: 0, medidaCaseiraTxt: null, chave, gramasTexto: '', medidaTexto: '' }]);
              }}
            />
          )}
          {erro('ingredientes') && <p id="ingredientes-erro" role="alert" className="text-sm text-red-700">{erro('ingredientes')}</p>}
        </fieldset>
        <p aria-live="polite" className="font-medium">{calc ? textoPorPorcao(calc) : ''}</p>
        <div className="space-y-1">
          <label htmlFor="modo" className="block font-medium">Modo de preparo</label>
          <textarea id="modo" name="modo" rows={6} maxLength={MODO_PREPARO_MAX} value={modo} onChange={(e) => setModo(e.target.value)} aria-invalid={erro('modo') ? true : undefined} aria-describedby={erro('modo') ? 'modo-erro' : undefined} className="w-full rounded border p-2" />
          {erro('modo') && <p id="modo-erro" role="alert" className="text-sm text-red-700">{erro('modo')}</p>}
        </div>
        <p role="status">{s.ok}</p>
        <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Salvar receita</button>
      </form>
    </section>
  );
}
