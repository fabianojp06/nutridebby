'use client';

import { useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_RESUMO } from '@/modules/ia/constantes';

/**
 * US-120 "Copiar": o texto montado (seções e frases, com os rótulos das fontes) vai para a área de transferência; nada é
 * gravado no prontuário. "Texto copiado." é anunciado na região `role="status"`, que já existe vazia antes do clique.
 */
export function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Botao
        type="button"
        variante="secundario"
        onClick={async () => {
          setCopiado(false);
          try {
            await navigator.clipboard.writeText(texto);
            setCopiado(true);
          } catch {
            // sem permissão da área de transferência (ou fora de HTTPS): nada a anunciar
          }
        }}
      >
        {MSG_RESUMO.copiar}
      </Botao>
      <p role="status" className="text-sm">{copiado ? MSG_RESUMO.copiado : ''}</p>
    </div>
  );
}
