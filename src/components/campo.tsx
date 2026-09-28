import type { InputHTMLAttributes } from 'react';

type Props = { id: string; rotulo: string; erro?: string; dica?: string } & InputHTMLAttributes<HTMLInputElement>;

/** Campo acessível: label associada, dica e erro ligados por aria-describedby. */
export function Campo({ id, rotulo, erro, dica, ...input }: Props) {
  const descricao = [dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <input id={id} name={id} aria-invalid={erro ? true : undefined} aria-describedby={descricao} className="w-full rounded border p-2" {...input} />
      {dica && <p id={`${id}-dica`} className="text-sm text-zinc-600">{dica}</p>}
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}
