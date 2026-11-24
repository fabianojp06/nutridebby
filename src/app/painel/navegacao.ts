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

/** Plano 15 (US-175): "Dúvidas dos pacientes" — com a IA Nutri ativada ou com dúvida aberta (o layout decide), antes de "Conteúdos". */
export const ITEM_DUVIDAS = { href: '/painel/duvidas', rotulo: 'Dúvidas dos pacientes' } as const;

/**
 * Plano 26 (RN-514, §4.1): o menu da recepção — Início, Pacientes, Agenda, Financeiro (só com a permissão) e Relatórios, na
 * ordem do menu da nutricionista. Nunca Diários, Exames recebidos, Dúvidas dos pacientes, Conteúdos e Configurações; os
 * contadores clínicos nem são lidos para ela (layout.tsx). Item novo de outro plano fica fora do menu dela por padrão.
 */
export const ITENS_DA_RECEPCAO: readonly string[] = ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/financeiro', '/painel/relatorios'];

/**
 * `papel` e `financeiro` (Plano 26): sem o papel, o menu da nutricionista, como antes (a permissão do Financeiro não se
 * aplica a ela). Na recepção, `exames` e `duvidas` são ignorados.
 */
export function itensDoMenu(o: { exames: boolean; duvidas?: boolean; papel?: 'nutri' | 'recepcao'; financeiro?: boolean }): { href: string; rotulo: string }[] {
  if (o.papel === 'recepcao') return ITENS_DO_MENU.filter((i) => ITENS_DA_RECEPCAO.includes(i.href) && (i.href !== '/painel/financeiro' || o.financeiro === true));
  const base = o.exames ? [...ITENS_DO_MENU.slice(0, 4), ITEM_EXAMES, ...ITENS_DO_MENU.slice(4)] : [...ITENS_DO_MENU];
  if (!o.duvidas) return base;
  const i = base.findIndex((x) => x.href === '/painel/conteudos');
  return [...base.slice(0, i), ITEM_DUVIDAS, ...base.slice(i)];
}

/** US-162: "Exames recebidos (3)"; US-175: "Dúvidas dos pacientes (2)"; sem pendentes, só o nome. */
export const rotuloDoItem = (rotulo: string, contador: number): string => (contador > 0 ? `${rotulo} (${contador})` : rotulo);

/** Telas que moram no hub "Configurações" (o item fica marcado nelas). */
/** Plano 22 (EP-D51): `/painel/exames` (catálogo e modelos de solicitação) no fim; `/painel/exames-recebidos` não casa (`dentro`). */
const DO_HUB = ['/painel/configuracoes', '/painel/whatsapp', '/painel/alimentos', '/painel/planos/modelos', '/painel/anamnese/modelos', '/painel/exames'];
const dentro = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`);

export function itemAtual(caminho: string): string | null {
  if (caminho === '/painel') return '/painel';
  // Plano 26 (§4.1): o cadastro do paciente pela recepção (/painel/cadastro/{id}) é da lista de pacientes
  if (caminho.startsWith('/painel/cadastro/')) return '/painel/pacientes';
  if (DO_HUB.some((b) => dentro(caminho, b))) return '/painel/configuracoes';
  return [...ITENS_DO_MENU, ITEM_EXAMES, ITEM_DUVIDAS].find((i) => i.href !== '/painel' && dentro(caminho, i.href))?.href ?? null;
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
