'use client';

import { useRef, type FormEvent } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';

/**
 * US-170 (D6, D33): a caixa "Liberar a IA Nutri para este paciente" — marcada = liberado. Com o peso oculto no app, a
 * confirmação aparece SÓ ao marcar uma caixa que estava desmarcada (desmarcar nunca pergunta); confirmada, a action recebe
 * `confirmarPesoOculto`. Já liberado, a confirmação foi dada antes. `antes` diz à action o estado em que a tela abriu.
 */
export function LiberacaoForm({ acao, liberado, pesoOculto }: { acao: (fd: FormData) => Promise<void>; liberado: boolean; pesoOculto: boolean }) {
  const confirmado = useRef<HTMLInputElement>(null);
  const aoEnviar = (e: FormEvent<HTMLFormElement>) => {
    const marcada = (e.currentTarget.elements.namedItem('liberar') as HTMLInputElement).checked;
    let confirmou = liberado;
    if (pesoOculto && marcada && !liberado) {
      confirmou = window.confirm(MSG_IA_NUTRI.pesoOculto);
      if (!confirmou) {
        e.preventDefault();
        return;
      }
    }
    if (confirmado.current) confirmado.current.value = marcada && confirmou ? '1' : '';
  };
  return (
    <form action={acao} onSubmit={aoEnviar} className="space-y-2">
      <input type="hidden" name="antes" value={liberado ? '1' : '0'} />
      <input ref={confirmado} type="hidden" name="confirmarPesoOculto" defaultValue="" />
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" name="liberar" defaultChecked={liberado} className="mt-1 h-6 w-6" aria-describedby={pesoOculto ? 'ia-nutri-peso-oculto' : undefined} />
        {MSG_IA_NUTRI.liberar}
      </label>
      {pesoOculto && (
        <p id="ia-nutri-peso-oculto" className="text-sm text-suave">
          {MSG_IA_NUTRI.pesoOculto}
        </p>
      )}
      <Botao variante="secundario">Salvar</Botao>
    </form>
  );
}
