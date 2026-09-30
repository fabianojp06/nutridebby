'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Seções do prontuário. Cada tarefa acrescenta a sua ANTES de 'historico'. */
export const ABAS: readonly { seg: string; rotulo: string }[] = [
  { seg: '', rotulo: 'Resumo' },
  { seg: 'antropometria', rotulo: 'Antropometria' },
  { seg: 'gasto-energetico', rotulo: 'Gasto energético' },
  { seg: 'anamnese', rotulo: 'Anamnese' },
  { seg: 'historico', rotulo: 'Histórico de acessos' },
];

export function Abas({ patientId }: { patientId: string }) {
  const atual = usePathname();
  const base = `/painel/pacientes/${patientId}`;
  return (
    <nav aria-label="Seções do prontuário">
      <ul className="flex flex-wrap gap-1 border-b">
        {ABAS.map((a) => {
          const href = a.seg ? `${base}/${a.seg}` : base;
          const ativa = a.seg ? atual === href || atual.startsWith(`${href}/`) : atual === base;
          return (
            <li key={a.seg || 'resumo'}>
              <Link href={href} aria-current={ativa ? 'page' : undefined} className={`block px-3 py-2 ${ativa ? 'border-b-2 border-emerald-700 font-semibold' : ''}`}>
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
