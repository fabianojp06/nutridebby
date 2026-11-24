'use client';

import { useState, useTransition } from 'react';
import { DialogoConfirmar } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_MODELOS } from '@/modules/documentos/modelos-textos';

/**
 * Plano 22 (T10b, US-379): "Excluir" um item salvo ou um modelo de prescrição, com a confirmação "Excluir {nome}? As
 * receitas já emitidas não mudam." ("Excluir"/"Cancelar") no `DialogoConfirmar` (`ocupado` enquanto a action corre).
 * A action redireciona para a lista com "Item excluído."/"Modelo excluído.".
 */
export function ExcluirDaBiblioteca({ nome, excluir, idTitulo }: { nome: string; excluir: () => Promise<void>; idTitulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Botao type="button" variante="secundario" aria-label={MSG_MODELOS.excluirRotulo(nome)} onClick={() => setAberto(true)}>
        {MSG_MODELOS.excluir}
      </Botao>
      <DialogoConfirmar
        aberto={aberto}
        titulo={MSG_MODELOS.excluirRotulo(nome)}
        texto={MSG_MODELOS.confirmarExcluir(nome)}
        confirmar={MSG_MODELOS.excluir}
        cancelar={MSG_MODELOS.cancelar}
        perigo
        ocupado={pendente}
        aoFechar={() => setAberto(false)}
        aoConfirmar={() => iniciar(() => excluir())}
        focoAoFechar={() => document.getElementById(idTitulo)}
      />
    </>
  );
}
