export type SecaoPortal = { href: string; rotulo: string; /** Outras telas que marcam esta seção (RN-191, §4.1). */ tambem: readonly string[] };

/**
 * Plano 16 (RN-190, §4.1): as cinco seções do layout G, nessa ordem, na faixa do topo (sai a barra de 7 abas do rodapé,
 * D23 do Plano 06). Nenhuma URL muda (C-195): as telas que não são seção marcam a seção pelo `tambem`. "Exames" só com o
 * recebimento ligado ou com envio (RN-192, G-D9 ★): `secoesDoPortal`. Conteúdos dentro de Plano (G-D8 ★ = a).
 */
export const SECOES_DO_PORTAL: readonly SecaoPortal[] = [
  // Plano 25 (CH-D15, CH-D48): a conversa (/p/mensagens) é tela de detalhe de Hoje, o destino do "Voltar"
  { href: '/p/inicio', rotulo: 'Hoje', tambem: ['/p/diario', '/p/mensagens'] },
  { href: '/p/jornada', rotulo: 'Jornada', tambem: ['/p/evolucao', '/p/agenda'] },
  { href: '/p/plano', rotulo: 'Plano', tambem: ['/p/compras', '/p/conteudos'] },
  { href: '/p/exames', rotulo: 'Exames', tambem: [] },
  { href: '/p/perfil', rotulo: 'Eu', tambem: ['/p/documentos', '/p/meus-dados', '/p/ajuda'] },
];

/** As seções que este paciente vê (RN-192): sem o recebimento e sem envio, "Exames" some (a rota continua abrindo pelo endereço). */
export function secoesDoPortal(o: { exames: boolean }): SecaoPortal[] {
  return SECOES_DO_PORTAL.filter((s) => s.href !== '/p/exames' || o.exames);
}

const dentro = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** A seção de uma rota do portal (também nas subpáginas e nas telas do `tambem`). */
export function secaoDe(pathname: string): SecaoPortal | null {
  return SECOES_DO_PORTAL.find((s) => dentro(pathname, s.href) || s.tambem.some((t) => dentro(pathname, t))) ?? null;
}

/** O `href` da seção marcada (aria-current) numa rota; null fora do portal. */
export function itemAtual(pathname: string): string | null {
  return secaoDe(pathname)?.href ?? null;
}
