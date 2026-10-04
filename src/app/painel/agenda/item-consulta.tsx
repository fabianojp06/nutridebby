import Link from 'next/link';
import { ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import type { Consulta } from '@/modules/agenda/consultas';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { selosDaConsulta } from './periodo';

/** `comData`: listas de vários dias (pendências de presença) mostram o dia junto do horário. */
export function ItemConsulta({ c, fuso, dentroDeBloqueio, comData = false }: { c: Consulta; fuso: string; dentroDeBloqueio: boolean; comData?: boolean }) {
  // só o horário e o nome ficam riscados: o selo da situação ("Cancelada pelo paciente") continua legível (revisão da T4)
  const riscado = c.status === 'cancelada' ? 'text-suave line-through decoration-suave' : '';
  return (
    <li className="rounded-2xl border border-borda bg-cartao p-2 text-sm text-texto">
      <p className={`font-medium ${riscado}`}>{`${comData ? formatarQuando(c.inicio, fuso) : partesNoFuso(c.inicio, fuso).hora}–${partesNoFuso(c.fim, fuso).hora}`}</p>
      <p className={riscado}><Link href={`/painel/agenda/consultas/${c.id}`} className="text-link underline">{c.paciente}</Link>{` · ${ROTULO_MODALIDADE[c.modalidade]}`}</p>
      <ul className="mt-1 flex flex-wrap gap-1" aria-label="Situação">
        {selosDaConsulta(c, dentroDeBloqueio).map((s) => <li key={s} className="rounded bg-linha px-1.5 text-texto">{s}</li>)}
      </ul>
    </li>
  );
}
