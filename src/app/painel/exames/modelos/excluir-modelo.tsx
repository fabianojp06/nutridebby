'use client';

import { useState, useTransition } from 'react';
import { DialogoConfirmar } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { excluirModeloSolicitacaoAction } from './actions';

const M = MSG_EXAMES.modelosSolicitacao;

/** Plano 22 (T3, US-376): "Excluir" o modelo, com a confirmação no `DialogoConfirmar` (`ocupado` enquanto a action corre). */
export function ExcluirModelo({ id, nome, idTitulo }: { id: string; nome: string; idTitulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Botao type="button" variante="secundario" aria-label={M.excluirRotulo(nome)} onClick={() => setAberto(true)}>
        {MSG_EXAMES.exameDoCatalogo.excluir}
      </Botao>
      <DialogoConfirmar
        aberto={aberto}
        titulo={M.excluirRotulo(nome)}
        texto={M.confirmarExcluir(nome)}
        confirmar={MSG_EXAMES.erros.confirmarExcluirSim}
        cancelar={MSG_EXAMES.erros.cancelar}
        perigo
        ocupado={pendente}
        aoFechar={() => setAberto(false)}
        aoConfirmar={() => iniciar(() => excluirModeloSolicitacaoAction(id))}
        focoAoFechar={() => document.getElementById(idTitulo)}
      />
    </>
  );
}
