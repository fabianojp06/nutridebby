'use client';
import { useActionState } from 'react';
import { comentarAction, type ComentarioState } from './actions';

export function ComentarioForm({ id, atual }: { id: string; atual: string | null }) {
  const [s, enviar, enviando] = useActionState<ComentarioState, FormData>(comentarAction.bind(null, id), {});
  return (
    <form action={enviar} className="space-y-2">
      <label htmlFor="comentario" className="block font-medium">Comentar</label>
      <textarea id="comentario" name="comentario" rows={3} maxLength={1000} defaultValue={s.valor ?? atual ?? ''} aria-invalid={s.erro ? true : undefined} aria-describedby={s.erro ? 'comentario-erro' : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
      {s.erro && <p id="comentario-erro" role="alert" className="text-sm text-erro">{s.erro}</p>}
      {s.ok && <p role="status">{s.ok}</p>}
      <button disabled={enviando} className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">Salvar comentário</button>
    </form>
  );
}
