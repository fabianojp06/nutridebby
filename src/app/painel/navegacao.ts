/**
 * D20: os itens do topo. O resto das configurações fica no hub "Configurações". Puro (o MenuPainel é cliente). Plano 20
 * (RN-327): "Financeiro" para toda nutricionista, entre "Conteúdos" e "Configurações", sem contador. Plano 26 (§4.1):
 * "Relatórios" entre "Financeiro" e "Configurações".
 */
export const ITENS_DO_MENU = [
  { href: '/painel', rotulo: 'Início' },
  { href: '/painel/pacientes', rotulo: 'Pacientes' },
  { href: '/painel/agenda', rotulo: 'Agenda' },
  { href: '/painel/diarios', rotulo: 'Diários' },
  { href: '/painel/conteudos', rotulo: 'Conteúdos' },
  { href: '/painel/financeiro', rotulo: 'Financeiro' },
  // Plano 26 (§4.1): "Relatórios" entre "Financeiro" e "Configurações"; marca também a página de impressão
  { href: '/painel/relatorios', rotulo: 'Relatórios' },
  { href: '/painel/configuracoes', rotulo: 'Configurações' },
] as const;

/** Plano 12 (D11): "Exames recebidos" — 5º item, só com o recebimento ligado ou com envio aguardando (o layout decide). */
export const ITEM_EXAMES = { href: '/painel/exames-recebidos', rotulo: 'Exames recebidos' } as const;

/**
 * Plano 25 (§4.1, CH-D14): "Mensagens" — sempre na sessão `nutri`, no lugar de "Dúvidas dos pacientes" (Plano 15) e na
 * mesma posição, antes de "Conteúdos". A fila das dúvidas virou a aba "Dúvidas da IA Nutri" de Mensagens (a rota
 * /painel/duvidas fica e marca "Mensagens").
 */
export const ITEM_MENSAGENS = { href: '/painel/mensagens', rotulo: 'Mensagens' } as const;

export function itensDoMenu(o: { exames: boolean; mensagens: boolean }): { href: string; rotulo: string }[] {
  const base = o.exames ? [...ITENS_DO_MENU.slice(0, 4), ITEM_EXAMES, ...ITENS_DO_MENU.slice(4)] : [...ITENS_DO_MENU];
  if (!o.mensagens) return base;
  const i = base.findIndex((x) => x.href === '/painel/conteudos');
  return [...base.slice(0, i), ITEM_MENSAGENS, ...base.slice(i)];
}

/** US-162: "Exames recebidos (3)"; Plano 25 (RN-459): "Mensagens (2)"; sem pendentes, só o nome. */
export const rotuloDoItem = (rotulo: string, contador: number): string => (contador > 0 ? `${rotulo} (${contador})` : rotulo);

/** Telas que moram no hub "Configurações" (o item fica marcado nelas). */
/** Plano 22 (EP-D51): `/painel/exames` (catálogo e modelos de solicitação) no fim; `/painel/exames-recebidos` não casa (`dentro`). */
const DO_HUB = ['/painel/configuracoes', '/painel/whatsapp', '/painel/alimentos', '/painel/planos/modelos', '/painel/anamnese/modelos', '/painel/exames'];
const dentro = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`);

export function itemAtual(caminho: string): string | null {
  if (caminho === '/painel') return '/painel';
  if (DO_HUB.some((b) => dentro(caminho, b))) return '/painel/configuracoes';
  // Plano 25 (CH-D14): a fila "Dúvidas da IA Nutri" é uma aba de Mensagens
  if (dentro(caminho, '/painel/duvidas')) return ITEM_MENSAGENS.href;
  return [...ITENS_DO_MENU, ITEM_EXAMES, ITEM_MENSAGENS].find((i) => i.href !== '/painel' && dentro(caminho, i.href))?.href ?? null;
}

/**
 * Classes do item do menu. O ativo é pílula na cor do consultório E sublinhado em negrito: no escuro, a pílula (sempre a
 * cor original da marca) fica entre 1,3 e 2,6:1 contra o cartão, então a forma do texto é o sinal que não é cor
 * (WCAG 1.4.1/1.4.11), como nas abas do prontuário e na barra do portal.
 */
export function classeDoItem(ativo: boolean): string {
  const base = 'inline-flex min-h-11 items-center rounded-full px-4';
  return ativo
    ? `${base} bg-destaque font-semibold text-white underline decoration-2 underline-offset-4`
    : `${base} font-medium text-suave hover:bg-linha hover:text-texto`;
}

/** Avatar da conta (MenuConta) e círculo da marca sem logo (CabecalhoPainel): as duas primeiras palavras do nome. */
export function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
