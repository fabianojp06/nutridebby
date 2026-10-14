'use client';

import { EstadoTarefa } from '@/app/painel/ia/estado-tarefa';

/** RNF-100: acompanha a leitura do laudo (EstadoTarefa) e recarrega a página quando a situação muda. */
export function EstadoIa({ tarefaId }: { tarefaId: string }) {
  return <EstadoTarefa url={`/api/painel/ia/tarefas/${tarefaId}`} />;
}
