export type ItemPortal = { href: string; rotulo: string; /** Outras telas que marcam esta aba. */ tambem?: string[] };

/**
 * D23 (Plano 06): as abas do portal, em ordem — grade de 7 colunas (R16, 360 px). D3 (Plano 07): "Conteúdos" entrou no
 * lugar de "Compras"; a lista de compras é um link em "Plano" e marca essa aba. Depois do MVP ("Exames", "IA Nutri"),
 * decidir de novo o que sai da barra (ou um "Mais"). US-146 (Plano 10A): "Documentos" não é aba — marca "Perfil".
 */
export const ITENS_DO_PORTAL: ItemPortal[] = [
  { href: '/p/inicio', rotulo: 'Início' },
  { href: '/p/plano', rotulo: 'Plano', tambem: ['/p/compras'] },
  { href: '/p/diario', rotulo: 'Diário' },
  { href: '/p/conteudos', rotulo: 'Conteúdos' },
  { href: '/p/evolucao', rotulo: 'Evolução' },
  { href: '/p/agenda', rotulo: 'Agenda' },
  { href: '/p/perfil', rotulo: 'Perfil', tambem: ['/p/documentos'] },
];

const dentro = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** O item da aba atual (também nas subpáginas: /p/agenda/… marca "Agenda"; /p/compras marca "Plano"). */
export function itemAtual(pathname: string): string | null {
  return ITENS_DO_PORTAL.find((i) => dentro(pathname, i.href) || (i.tambem ?? []).some((t) => dentro(pathname, t)))?.href ?? null;
}
