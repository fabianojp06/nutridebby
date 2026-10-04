'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Seções do prontuário. Cada tarefa acrescenta a sua ANTES de 'historico'. */
export const ABAS: readonly { seg: string; rotulo: string }[] = [
  { seg: '', rotulo: 'Resumo' },
  { seg: 'antropometria', rotulo: 'Antropometria' },
  { seg: 'gasto-energetico', rotulo: 'Gasto energético' },
  { seg: 'anamnese', rotulo: 'Anamnese' },
  { seg: 'atendimentos', rotulo: 'Atendimentos' },
  { seg: 'exames', rotulo: 'Exames' },
  { seg: 'evolucao', rotulo: 'Evolução' },
  { seg: 'privacidade', rotulo: 'Privacidade' },
  { seg: 'plano-alimentar', rotulo: 'Plano alimentar' },
  { seg: 'historico', rotulo: 'Histórico de acessos' },
];

export function Abas({ patientId }: { patientId: string }) {
  const atual = usePathname();
  const base = `/painel/pacientes/${patientId}`;
  return (
    <nav aria-label="Seções do prontuário" data-guia="abas-prontuario">
      <ul className="flex gap-1 overflow-x-auto border-b border-borda">
        {ABAS.map((a) => {
          const href = a.seg ? `${base}/${a.seg}` : base;
          const ativa = a.seg ? atual === href || atual.startsWith(`${href}/`) : atual === base;
          return (
            <li key={a.seg || 'resumo'}>
              <Link href={href} aria-current={ativa ? 'page' : undefined} className={`inline-flex min-h-11 items-center whitespace-nowrap px-3 focus-visible:outline-offset-[-3px] ${ativa ? 'border-b-2 border-marca font-semibold' : 'text-suave'}`}>
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
