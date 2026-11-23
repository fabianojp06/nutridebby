'use client';
import { useActionState, useState } from 'react';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { pausarAction, type EstadoDaPausa } from './actions';
import { ComLinkDoPerfil } from './link-do-perfil';

const P = MSG_MENSAGENS.pausa;

/**
 * US-450 (RN-442, §6.2): "Pausar conversa" e o diálogo (o `Dialogo` compartilhado; nunca a confirmação nativa do navegador), com o lembrete
 * "Combine com o paciente como o acompanhamento continua." no texto. Pausou → a página com `?ok=pausada`; sem carimbo
 * (CH-D74), o texto com o link ao Perfil dentro do diálogo.
 */
export function PausarDialogo({ patientId, nome }: { patientId: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pausando] = useActionState<EstadoDaPausa | null, FormData>(pausarAction.bind(null, patientId), null);
  const fechar = () => {
    if (!pausando) setAberto(false);
  };
  return (
    <>
      <Botao type="button" variante="secundario" data-guia="pausar-conversa" onClick={() => setAberto(true)}>
        {P.botao}
      </Botao>
      <Dialogo aberto={aberto} titulo={P.botao} descricao={P.confirmar(nome)} aoFechar={fechar} ocupado={pausando} rodape={null}>
        <form action={acao} className="space-y-4">
          {estado?.erro && (
            <p role="alert" className="text-erro">
              {estado.semCarimbo ? <ComLinkDoPerfil texto={estado.erro} /> : estado.erro}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Botao type="button" variante="secundario" onClick={fechar} aria-disabled={pausando || undefined} className="aria-disabled:opacity-60" data-foco-inicial="">
              {P.cancelar}
            </Botao>
            <Botao
              type="submit"
              variante="escuro"
              aria-disabled={pausando || undefined}
              onClick={(e) => {
                if (pausando) e.preventDefault();
              }}
              className="aria-disabled:opacity-60"
            >
              {P.pausar}
            </Botao>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
