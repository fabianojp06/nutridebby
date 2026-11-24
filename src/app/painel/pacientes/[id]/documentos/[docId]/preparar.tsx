import type { ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';

/**
 * US-143: a declaração (D5 da spec, rascunho) com a caixa obrigatória. Fica DENTRO do formulário do editor (ReceitaForm,
 * revisão da T6): o botão envia os itens e a justificativa que estão na tela, não a última versão salva. A caixa é
 * controlada pelo editor, e o formulário do editor cancela o reset automático do React 19 (`semResetAutomatico`, SUS-108),
 * que a levaria de volta ao estado da montagem depois de um erro.
 */
export function Preparar({ declaracao, marcada, aoMarcar, erro, aviso, pendente }: {
  declaracao: string; marcada: boolean; aoMarcar: (v: boolean) => void; erro?: string; aviso: ReactNode; pendente: boolean;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-borda bg-cartao p-4" data-guia="preparar-documento">
      <fieldset className="space-y-2">
        <legend className="font-semibold">Declaração</legend>
        <div className="flex items-start gap-2">
          <input id="declaracao" name="declaracao" type="checkbox" checked={marcada} onChange={(ev) => aoMarcar(ev.target.checked)} className="mt-1 size-5" aria-invalid={erro ? true : undefined} aria-describedby={erro ? 'declaracao-erro' : undefined} />
          <label htmlFor="declaracao">{declaracao}</label>
        </div>
        {erro && <p id="declaracao-erro" role="alert" className="text-sm text-erro">{erro}</p>}
      </fieldset>
      {aviso}
      <Botao name="intencao" value="preparar" disabled={pendente}>Preparar para assinatura</Botao>
    </div>
  );
}
