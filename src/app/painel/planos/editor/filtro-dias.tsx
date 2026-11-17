'use client';

import { DIA_CURTO, ORDEM_DIAS } from '@/modules/plano-alimentar/dias';
import type { FiltroDia } from './estado';

const OPCOES: FiltroDia[] = ['todos', ...ORDEM_DIAS];

/**
 * RN-247 (a), US-236: "Dias: Todos · seg · … · dom", botões de alternância (`aria-pressed`, RNF-232), e a legenda com o
 * total de cada perfil de dia ("seg a sex: 1.820 kcal · sáb e dom: 2.050 kcal", "dom: sem refeições"). Escolher um dia
 * não é edição do plano: muda só o que a tela mostra.
 */
export function FiltroDias({ filtro, aoEscolher, legenda }: { filtro: FiltroDia; aoEscolher: (f: FiltroDia) => void; legenda: string[] }) {
  return (
    <div data-guia="dias-refeicao" className="space-y-1">
      <div role="group" aria-labelledby="filtro-dias-rotulo" aria-describedby="filtro-dias-legenda" className="flex flex-wrap items-center gap-2">
        <span id="filtro-dias-rotulo" className="font-medium">Dias</span>
        {OPCOES.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={filtro === d}
            onClick={() => aoEscolher(d)}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 ${filtro === d ? 'border-marca bg-destaque font-semibold text-white' : 'border-campo bg-cartao text-texto hover:bg-linha'}`}
          >
            {d === 'todos' ? 'Todos' : DIA_CURTO[d]}
          </button>
        ))}
      </div>
      <p id="filtro-dias-legenda" className="text-sm text-suave">{legenda.join(' · ')}</p>
    </div>
  );
}
