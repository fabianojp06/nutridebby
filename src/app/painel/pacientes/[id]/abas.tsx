'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Seções do prontuário. Cada tarefa acrescenta a sua ANTES de 'historico'. `nome`: nome acessível quando o rótulo visível é
 * curto (Plano 18, D12: "Histórico", lido "Histórico de acessos" — começa pelo texto visível, WCAG 2.5.3).
 */
export const ABAS: readonly { seg: string; rotulo: string; nome?: string }[] = [
  { seg: '', rotulo: 'Início' },
  { seg: 'perfil', rotulo: 'Perfil' },
  { seg: 'antropometria', rotulo: 'Antropometria' },
  { seg: 'gasto-energetico', rotulo: 'Gasto energético' },
  { seg: 'anamnese', rotulo: 'Anamnese' },
  { seg: 'atendimentos', rotulo: 'Atendimentos' },
  { seg: 'exames', rotulo: 'Exames' },
  { seg: 'evolucao', rotulo: 'Evolução' },
  { seg: 'privacidade', rotulo: 'Privacidade' },
  { seg: 'plano-alimentar', rotulo: 'Plano alimentar' },
  { seg: 'documentos', rotulo: 'Documentos' },
  { seg: 'ia-nutri', rotulo: 'IA Nutri' },
  { seg: 'historico', rotulo: 'Histórico', nome: 'Histórico de acessos' },
];

/** Páginas que saem do Início sem aba própria (Plano 18): o "No app do paciente" e o resumo da IA (US-120). */
const DO_INICIO = ['app', 'resumo-ia'];

/**
 * `documentos`: D20 (Plano 10A) — a aba só existe com os documentos assinados liberados pelo admin. `iaNutri`: Plano 15
 * (US-175, DP-17) — a aba só existe com a IA Nutri ativada no consultório ou com o paciente que já teve participação.
 */
export function Abas({ patientId, documentos, iaNutri = false }: { patientId: string; documentos: boolean; iaNutri?: boolean }) {
  const atual = usePathname();
  const base = `/painel/pacientes/${patientId}`;
  return (
    <nav aria-label="Seções do prontuário" data-guia="abas-prontuario">
      {/* 13 abas (Documentos, Plano 10A; IA Nutri, Plano 15; Início e Perfil, Plano 18): sem o gap e com px-1.25 (5 px), cabem
          inteiras a partir de 1280 px. Medido com 12 abas: 1213 de 1232 px (com px-2 eram 1285 e a última ficava cortada —
          "incomplete" no axe). Plano 18: "Perfil" soma cerca de 46 px, "Histórico" no lugar de "Histórico de acessos" tira
          cerca de 85 e "Início" no lugar de "Resumo", poucos — perto de 1170 de 1232 px, conferido pelo axe a 1280 px em
          e2e/acessibilidade-painel.spec.ts. Uma 14ª aba não cabe (R-266); mais estreito, a faixa rola */}
      <ul className="flex overflow-x-auto border-b border-borda">
        {ABAS.filter((a) => (a.seg !== 'documentos' || documentos) && (a.seg !== 'ia-nutri' || iaNutri)).map((a) => {
          const href = a.seg ? `${base}/${a.seg}` : base;
          const ativa = a.seg ? atual === href || atual.startsWith(`${href}/`) : atual === base || DO_INICIO.some((s) => atual === `${base}/${s}`);
          return (
            <li key={a.seg || 'inicio'}>
              <Link href={href} aria-label={a.nome} aria-current={ativa ? 'page' : undefined} className={`inline-flex min-h-11 items-center whitespace-nowrap px-1.25 focus-visible:outline-offset-[-3px] ${ativa ? 'border-b-2 border-marca font-semibold' : 'text-suave'}`}>
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
