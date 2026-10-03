export type ItemPortal = { href: string; rotulo: string };

/**
 * D23: as abas do portal, em ordem. Cada tarefa do Plano 06 acrescenta a sua; os planos seguintes também
 * ("Conteúdos", Plano 07; depois do MVP, "Exames" e "IA Nutri") — o layout não muda (grade de 7 colunas, R16).
 */
export const ITENS_DO_PORTAL: ItemPortal[] = [
  { href: '/p/inicio', rotulo: 'Início' },
  { href: '/p/plano', rotulo: 'Plano' },
  { href: '/p/diario', rotulo: 'Diário' },
  { href: '/p/evolucao', rotulo: 'Evolução' },
  { href: '/p/compras', rotulo: 'Compras' },
  { href: '/p/perfil', rotulo: 'Perfil' },
];

/** O item da aba atual (também nas subpáginas: /p/agenda/… marca "Agenda"). */
export function itemAtual(pathname: string): string | null {
  return ITENS_DO_PORTAL.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.href ?? null;
}
