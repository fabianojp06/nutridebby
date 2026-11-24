import type { ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';

/** Revisão da P22-09: o aviso de quando a declaração da tela muda depois de confirmada (a receita com a fórmula, EP-D56). */
export const MSG_DECLARACAO_MUDOU = 'A declaração mudou: confirme de novo.';

/** A caixa da declaração que muda com o conteúdo da tela (ReceitaForm): `vista` é o texto mostrado ao lado da caixa. */
export type EstadoDaDeclaracao = { vista: string; marcada: boolean; mudou: boolean };

/**
 * Revisão da P22-09: a confirmação vale só para o texto que estava na tela. Se a declaração muda (a fórmula entra ou sai),
 * a caixa volta desmarcada e, se estava marcada, o aviso `MSG_DECLARACAO_MUDOU` aparece até ela marcar de novo. Voltar ao
 * texto de antes não remarca a caixa sozinha.
 */
export function seguirDeclaracao(d: EstadoDaDeclaracao, atual: string): EstadoDaDeclaracao {
  if (d.vista === atual) return d;
  return { vista: atual, marcada: false, mudou: d.marcada || d.mudou };
}

/** Marcar ou desmarcar a caixa: o aviso de mudança sai. */
export const marcarDeclaracao = (d: EstadoDaDeclaracao, marcada: boolean): EstadoDaDeclaracao => ({ ...d, marcada, mudou: false });

/**
 * US-143: a declaração (D5 da spec, rascunho) com a caixa obrigatória. Fica DENTRO do formulário do editor (ReceitaForm,
 * revisão da T6): o botão envia os itens e a justificativa que estão na tela, não a última versão salva. A caixa é
 * controlada pelo editor, e o formulário do editor cancela o reset automático do React 19 (`semResetAutomatico`, SUS-108),
 * que a levaria de volta ao estado da montagem depois de um erro.
 */
export function Preparar({ declaracao, marcada, aoMarcar, erro, aviso, pendente, mudou }: {
  declaracao: string; marcada: boolean; aoMarcar: (v: boolean) => void; erro?: string; aviso: ReactNode; pendente: boolean;
  /** Só a receita (a declaração muda com o conteúdo): a região `role="status"` existe desde o início, para o leitor de tela ouvir o aviso. */
  mudou?: boolean;
}) {
  const descr = [erro ? 'declaracao-erro' : undefined, mudou ? 'declaracao-mudou' : undefined].filter(Boolean).join(' ');
  return (
    <div className="space-y-3 rounded-2xl border border-borda bg-cartao p-4" data-guia="preparar-documento">
      <fieldset className="space-y-2">
        <legend className="font-semibold">Declaração</legend>
        <div className="flex items-start gap-2">
          <input id="declaracao" name="declaracao" type="checkbox" checked={marcada} onChange={(ev) => aoMarcar(ev.target.checked)} className="mt-1 size-5" aria-invalid={erro ? true : undefined} aria-describedby={descr || undefined} />
          <label htmlFor="declaracao">{declaracao}</label>
        </div>
        {mudou !== undefined && <p id="declaracao-mudou" role="status" className="text-sm">{mudou ? MSG_DECLARACAO_MUDOU : null}</p>}
        {erro && <p id="declaracao-erro" role="alert" className="text-sm text-erro">{erro}</p>}
      </fieldset>
      {aviso}
      <Botao name="intencao" value="preparar" disabled={pendente}>Preparar para assinatura</Botao>
    </div>
  );
}
