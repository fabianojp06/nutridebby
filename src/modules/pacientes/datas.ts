const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' que existe no calendário (recusa 2026-02-30) e a partir de 1900. */
export function dataValida(iso: string): boolean {
  const m = ISO.exec(iso);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return a >= 1900 && dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

/**
 * Anos completos na data `em` (RN-14: idade para fórmulas; RN-17: cadastro ≥ 18). Datas 'AAAA-MM-DD'.
 * Quem nasceu em 29/02 completa ano em 01/03 nos anos comuns.
 */
export function idadeEm(nascimento: string, em: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number);
  const [ae, me, de] = em.split('-').map(Number);
  return ae - an - (me < mn || (me === mn && de < dn) ? 1 : 0);
}

/** Hoje no fuso do tenant (RN-06), como 'AAAA-MM-DD' — nunca a data UTC do servidor. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** 'AAAA-MM-DD' → 'dd/mm/aaaa' (RNF-12). */
export function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
