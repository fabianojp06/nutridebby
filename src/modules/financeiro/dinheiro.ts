/**
 * RN-326: dinheiro em centavos inteiros. A entrada aceita "1250", "1250,5", "1.250,50", "R$ 1.250,50" e o sinal "-" ou
 * "−" (o saldo do caixa pode ser negativo, RN-325); ponto só de milhar, vírgula só decimal, até 2 casas. Sem ponto
 * flutuante: os dígitos viram inteiro um a um, nunca por parseFloat/Number sobre o texto.
 */
const VALOR = /^([-−])?(?:R\$\s*)?([-−])?([1-9]\d{0,2}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
/** 13 dígitos de reais + 2 de centavos ainda cabem num inteiro seguro (a faixa de cada campo é conferida depois). */
const MAX_DIGITOS_REAIS = 13;

function inteiro(digitos: string): number {
  let n = 0;
  for (let i = 0; i < digitos.length; i++) n = n * 10 + (digitos.charCodeAt(i) - 48);
  return n;
}

export function paraCentavos(texto: string): { ok: true; centavos: number } | { ok: false; erro: 'vazio' | 'invalido' } {
  const t = texto.trim();
  if (!t) return { ok: false, erro: 'vazio' };
  const m = VALOR.exec(t);
  if (!m || (m[1] && m[2])) return { ok: false, erro: 'invalido' };
  const reais = m[3].replaceAll('.', '');
  if (reais.length > MAX_DIGITOS_REAIS) return { ok: false, erro: 'invalido' };
  const centavos = inteiro(reais) * 100 + inteiro((m[4] ?? '').padEnd(2, '0'));
  return { ok: true, centavos: (m[1] ?? m[2]) && centavos !== 0 ? -centavos : centavos };
}

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.250,00" (com o espaço não separável do Intl); negativo com o sinal de menos tipográfico: "−R$ 320,00". */
export function formatarReais(centavos: number): string {
  const texto = REAIS.format(Math.abs(centavos) / 100);
  return centavos < 0 ? `−${texto}` : texto;
}
