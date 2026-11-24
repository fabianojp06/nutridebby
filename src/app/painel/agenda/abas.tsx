import Link from 'next/link';
import { MSG_ANIVERSARIO, MSG_SOLICITACOES } from '@/modules/agenda/constantes';

export type AbaDaAgenda = 'agenda' | 'solicitacoes' | 'pendencias' | 'horarios' | 'locais' | 'aniversariantes';

/**
 * Plano 23 (spec §4.1): abas das telas da agenda, como links com `aria-current="page"` (não `role=tablist`, como a navegação
 * do Financeiro). Usadas só nas telas da agenda, nunca num `layout.tsx` (Nova consulta, a consulta e a impressão não têm
 * abas). Ordem final: Agenda · Solicitações ({n}) · Aniversariantes · Pendências · Horários · Locais. AG-D72: nenhum link
 * para página que ainda não existe — a T8 ligou "Solicitações ({n})" (só com a chave ligada ou `n > 0`: a tela passa o
 * número de `abaDeSolicitacoes`, ou `null` para tirar a aba) e a T10 liga "Aniversariantes" (`comAniversariantes`), uma
 * linha, depois de "Solicitações".
 */
const ABAS: readonly { id: AbaDaAgenda; href: string; rotulo: string }[] = [
  { id: 'agenda', href: '/painel/agenda', rotulo: 'Agenda' },
  { id: 'pendencias', href: '/painel/agenda/pendencias', rotulo: 'Pendências' },
  { id: 'horarios', href: '/painel/agenda/horarios', rotulo: 'Horários' },
  { id: 'locais', href: '/painel/agenda/locais', rotulo: 'Locais' },
];

export function AbasDaAgenda({ atual, solicitacoes = null, comAniversariantes = true }: { atual: AbaDaAgenda; solicitacoes?: number | null; comAniversariantes?: boolean }) {
  const abas = [
    ABAS[0],
    ...(solicitacoes === null ? [] : [{ id: 'solicitacoes' as const, href: '/painel/agenda/solicitacoes', rotulo: MSG_SOLICITACOES.aba(solicitacoes) }]),
    ...(comAniversariantes ? [{ id: 'aniversariantes' as const, href: '/painel/agenda/aniversariantes', rotulo: MSG_ANIVERSARIO.aba }] : []),
    ...ABAS.slice(1),
  ];
  return (
    <nav aria-label="Seções da agenda">
      <ul data-guia="abas-agenda" className="flex flex-wrap gap-x-1 border-b border-borda">
        {abas.map((a) => (
          <li key={a.id}>
            <Link href={a.href} aria-current={a.id === atual ? 'page' : undefined} className={`inline-flex min-h-11 items-center whitespace-nowrap px-3 focus-visible:outline-offset-[-3px] ${a.id === atual ? 'border-b-2 border-marca font-semibold' : 'text-suave underline-offset-4 hover:underline'}`}>{a.rotulo}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
