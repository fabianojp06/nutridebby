'use client';

import { useActionState } from 'react';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { useStatusSalvamento } from './editor/salvamento-contexto';
import type { ModeloState } from './modelos/actions';

/**
 * US-024 "Salvar como modelo" (disponível em qualquer versão do plano). Copia o que está no banco: como o "Publicar",
 * fica desabilitado enquanto o salvamento automático do editor não terminou.
 */
export function SalvarComoModelo({ acao, tituloSugerido }: { acao: (s: ModeloState, fd: FormData) => Promise<ModeloState>; tituloSugerido: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const salvamento = useStatusSalvamento();
  const aguardando = salvamento !== 'salvo';
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {/* RN-256 (Plano 19): o modelo leva as observações e os textos das refeições (RNF-08) */}
      <p id="titulo-modelo-aviso" className="w-full text-sm text-suave">{MSG_PLANO.modeloComTextos}</p>
      <div className="space-y-1">
        <label htmlFor="titulo-modelo" className="block text-sm">Nome do modelo</label>
        <input id="titulo-modelo" name="titulo" defaultValue={tituloSugerido} aria-describedby="titulo-modelo-aviso" className="rounded-xl border border-campo bg-cartao p-2 text-texto" />
      </div>
      <button disabled={pendente || aguardando} className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha disabled:opacity-50">Salvar como modelo</button>
      {aguardando && salvamento !== 'salvando' && <p className="w-full text-sm text-suave">Só dá para continuar com as alterações salvas.</p>}
      {state.erro && <p role="alert" className="w-full text-sm text-erro">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full text-sm text-ok">{state.ok}</p>}
    </form>
  );
}
