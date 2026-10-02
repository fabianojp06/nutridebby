import Link from 'next/link';
import { ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import type { Consulta } from '@/modules/agenda/consultas';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { selosDaConsulta } from './periodo';

export function ItemConsulta({ c, fuso, dentroDeBloqueio }: { c: Consulta; fuso: string; dentroDeBloqueio: boolean }) {
  const cancelada = c.status === 'cancelada';
  return (
    <li className={`rounded border p-2 text-sm ${cancelada ? 'text-zinc-500 line-through decoration-zinc-400' : ''}`}>
      <p className="font-medium">{`${partesNoFuso(c.inicio, fuso).hora}–${partesNoFuso(c.fim, fuso).hora}`}</p>
      <p><Link href={`/painel/agenda/consultas/${c.id}`} className="underline">{c.paciente}</Link>{` · ${ROTULO_MODALIDADE[c.modalidade]}`}</p>
      <ul className="mt-1 flex flex-wrap gap-1" aria-label="Situação">
        {selosDaConsulta(c, dentroDeBloqueio).map((s) => <li key={s} className="rounded bg-zinc-100 px-1.5 text-zinc-900 no-underline">{s}</li>)}
      </ul>
    </li>
  );
}
