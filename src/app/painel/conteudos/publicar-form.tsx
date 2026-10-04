'use client';
import { useActionState } from 'react';
import { despublicarConteudoAction, publicarConteudoAction, type ConteudoState } from './actions';

/**
 * D17: "Publicar" no rascunho; "Despublicar" no publicado. A Tarefa 10 acrescenta "Avisar pacientes".
 * A action chama `revalidatePath`: o refresh rende a página de novo já com `publicado = true`, e o estado do
 * `useActionState` continua (mesmo componente, mesma posição). Por isso o `role="status"` fica FORA dos dois ramos —
 * senão "Conteúdo publicado. Aviso enviado para N pacientes." (D5) nunca aparece. Só mostra o `ok` no ramo publicado:
 * depois de "Despublicar", o "Conteúdo publicado." antigo não volta no ramo do rascunho.
 */
export function PublicarForm({ id, publicado }: { id: string; publicado: boolean }) {
  const [s, publicar, enviando] = useActionState<ConteudoState, FormData>(publicarConteudoAction.bind(null, id), {});
  const erro = s.erros?.geral ?? s.erros?.visibilidade;
  return (
    <div className="space-y-2">
      {!publicado && erro && <p role="alert" className="text-red-700">{erro}</p>}
      <p role="status">{publicado ? s.ok : undefined}</p>
      {publicado ? (
        <form action={despublicarConteudoAction.bind(null, id)}>
          <button className="rounded border px-4 py-2">Despublicar</button>
        </form>
      ) : (
        <form action={publicar} className="space-y-2">
          <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Publicar</button>
        </form>
      )}
    </div>
  );
}
