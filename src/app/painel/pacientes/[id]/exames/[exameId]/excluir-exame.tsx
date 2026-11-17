'use client';

import { useState, useTransition } from 'react';
import { DialogoConfirmar } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { excluirExameDoDetalheAction } from './actions';

/**
 * Plano 22 (T5a, spec §7 "Detalhe do exame"): "Excluir" no detalhe, com a confirmação no `DialogoConfirmar` (o mesmo texto
 * da lista: "Excluir este exame e o laudo?"; com o exame no app, o aviso da T6 entra no texto). Enquanto a action corre, o
 * diálogo fica `ocupado`; a action volta à aba Exames.
 */
export function ExcluirExame({ patientId, exameId, rotulo, noApp }: { patientId: string; exameId: string; rotulo: string; noApp: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const texto = noApp ? `Excluir este exame e o laudo? ${MSG_EXAMES.exame.avisoExcluirNoApp}` : 'Excluir este exame e o laudo?';
  return (
    <>
      <Botao type="button" variante="secundario" aria-label={rotulo} onClick={() => setAberto(true)}>
        Excluir
      </Botao>
      <DialogoConfirmar
        aberto={aberto}
        titulo={rotulo}
        texto={texto}
        confirmar="Excluir"
        cancelar={MSG_EXAMES.erros.cancelar}
        perigo
        ocupado={pendente}
        aoFechar={() => setAberto(false)}
        aoConfirmar={() => iniciar(() => excluirExameDoDetalheAction(patientId, exameId))}
      />
    </>
  );
}
