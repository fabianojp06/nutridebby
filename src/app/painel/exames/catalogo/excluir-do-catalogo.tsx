'use client';

import { useState, useTransition } from 'react';
import { DialogoConfirmar } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { excluirExameDoCatalogoAction } from './actions';

const E = MSG_EXAMES.erros;

/**
 * Plano 22 (T3, US-370 "Excluir do catálogo"): "Excluir" com a confirmação no `DialogoConfirmar` ("Excluir {nome} do
 * catálogo? Exames, modelos e documentos já gravados não mudam.", "Excluir"/"Cancelar"). Enquanto a action corre, o
 * diálogo fica `ocupado` (Esc e "Cancelar" não fecham). A action volta à lista: a linha some, e o foco vai ao título da
 * tela (`idTitulo`) — o botão que abriu saiu do DOM.
 */
export function ExcluirDoCatalogo({ id, nome, idTitulo }: { id: string; nome: string; idTitulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Botao type="button" variante="secundario" aria-label={MSG_EXAMES.catalogo.excluirRotulo(nome)} onClick={() => setAberto(true)}>
        {MSG_EXAMES.exameDoCatalogo.excluir}
      </Botao>
      <DialogoConfirmar
        aberto={aberto}
        titulo={MSG_EXAMES.catalogo.excluirRotulo(nome)}
        texto={E.confirmarExcluir(nome)}
        confirmar={E.confirmarExcluirSim}
        cancelar={E.cancelar}
        perigo
        ocupado={pendente}
        aoFechar={() => setAberto(false)}
        aoConfirmar={() => iniciar(() => excluirExameDoCatalogoAction(id))}
        focoAoFechar={() => document.getElementById(idTitulo)}
      />
    </>
  );
}
