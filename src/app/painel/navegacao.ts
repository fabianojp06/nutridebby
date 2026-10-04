/** D20: os seis itens do topo. O resto das configurações fica no hub "Configurações". Puro (o MenuPainel é cliente). */
export const ITENS_DO_MENU = [
  { href: '/painel', rotulo: 'Início' },
  { href: '/painel/pacientes', rotulo: 'Pacientes' },
  { href: '/painel/agenda', rotulo: 'Agenda' },
  { href: '/painel/diarios', rotulo: 'Diários' },
  { href: '/painel/conteudos', rotulo: 'Conteúdos' },
  { href: '/painel/configuracoes', rotulo: 'Configurações' },
] as const;

/** Telas que moram no hub "Configurações" (o item fica marcado nelas). */
const DO_HUB = ['/painel/configuracoes', '/painel/whatsapp', '/painel/alimentos', '/painel/planos/modelos', '/painel/anamnese/modelos'];
const dentro = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`);

export function itemAtual(caminho: string): string | null {
  if (caminho === '/painel') return '/painel';
  if (DO_HUB.some((b) => dentro(caminho, b))) return '/painel/configuracoes';
  return ITENS_DO_MENU.find((i) => i.href !== '/painel' && dentro(caminho, i.href))?.href ?? null;
}

/** Avatar da conta (MenuConta) e círculo da marca sem logo (CabecalhoPainel): as duas primeiras palavras do nome. */
export function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
