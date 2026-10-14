'use client';

import { useActionState } from 'react';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { AREA_ROTULO, AREAS_MODELOS_IA, MSG_MODELOS_IA } from '@/modules/ia/constantes';
import { pedirModelosAction, type PedirModelosState } from './actions';

/**
 * US-123 "Gerar": a área (lista fechada) e o botão. `falhou`: o texto da US-123 "Falha", quando a última geração de
 * alguma área falhou e nada está em andamento.
 */
export function ModelosIaForm({ falhou }: { falhou: string | null }) {
  const [state, action, pendente] = useActionState<PedirModelosState, FormData>(pedirModelosAction, {});
  return (
    <form action={action} className="space-y-2">
      {falhou && !state.erro && <Aviso tipo="aviso">{falhou}</Aviso>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="area-modelos" className="block text-sm">{MSG_MODELOS_IA.area}</label>
          <select
            id="area-modelos"
            name="area"
            className="min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto"
            aria-invalid={state.erro ? true : undefined}
            aria-describedby={state.erro ? 'modelos-ia-erro' : undefined}
          >
            {AREAS_MODELOS_IA.map((a) => <option key={a} value={a}>{AREA_ROTULO[a]}</option>)}
          </select>
        </div>
        <Botao disabled={pendente}>{MSG_MODELOS_IA.gerar}</Botao>
      </div>
      {state.erro && <p id="modelos-ia-erro" role="alert" className="text-erro">{state.erro}</p>}
    </form>
  );
}
