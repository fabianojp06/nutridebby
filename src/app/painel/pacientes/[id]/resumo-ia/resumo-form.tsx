'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_RESUMO } from '@/modules/ia/constantes';
import type { ResumoState } from './actions';

type Acao = (s: ResumoState, fd: FormData) => Promise<ResumoState>;

/**
 * US-120: "Incluir notas privadas" (desmarcada, A-D8 = (b)) e "Gerar resumo". Com `deNovo`, é o "Gerar de novo" do resumo
 * aberto: a mesma escolha das notas vai escondida e o pronto é descartado no pedido. O erro do pedido (texto pronto:
 * sem autorização, prontuário vazio, cota…) aparece logo abaixo, anunciado (`role="alert"`).
 */
export function ResumoForm({ acao, deNovo }: { acao: Acao; deNovo?: { notas: boolean } }) {
  const [state, action, pendente] = useActionState<ResumoState, FormData>(acao, {});
  const idErro = deNovo ? 'resumo-de-novo-erro' : 'resumo-erro';
  return (
    <form action={action} className="space-y-2">
      {deNovo ? (
        <>
          <input type="hidden" name="deNovo" value="1" />
          {deNovo.notas && <input type="hidden" name="notas" value="on" />}
        </>
      ) : (
        <div className="flex min-h-11 items-center gap-2">
          <input type="checkbox" id="notas" name="notas" className="size-5" />
          <label htmlFor="notas" className="inline-flex min-h-11 items-center">{MSG_RESUMO.incluirNotas}</label>
        </div>
      )}
      <Botao variante={deNovo ? 'secundario' : 'primario'} disabled={pendente} aria-describedby={state.erro ? idErro : undefined}>
        {deNovo ? MSG_RESUMO.gerarDeNovo : MSG_RESUMO.gerar}
      </Botao>
      {state.erro && <p id={idErro} role="alert" className="text-sm text-erro">{state.erro}</p>}
    </form>
  );
}
