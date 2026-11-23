'use client';

import { Botao } from '@/components/ui/botao';
import { MSG_RELATORIOS } from '@/modules/relatorios/constantes';

/** RN-495 "Imprimir ou salvar em PDF": o diálogo de impressão do navegador (nenhum arquivo vai ao servidor, RE-D9). */
export function BotaoImprimir() {
  return (
    <Botao type="button" onClick={() => window.print()}>
      {MSG_RELATORIOS.impressao.imprimir}
    </Botao>
  );
}
