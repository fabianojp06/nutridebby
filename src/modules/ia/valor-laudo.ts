/**
 * RN-111 (spec v0.3): o número de um valor impresso no laudo, sem chute. Diferente do lerDecimal (src/lib/numero.ts), que
 * lê "250.000" como 250: aqui um ponto seguido de exatamente 3 dígitos, sem vírgula, é AMBÍGUO (milhar ou decimal) e a
 * linha fica bloqueada até a nutricionista editar. Do mesmo jeito, uma vírgula seguida de exatamente 3 dígitos, sem ponto
 * ("250,000", "1,500"), é ambígua: milhar no padrão americano ou decimal (code review do PR #23). Sem imports: a tabela de conferência (navegador) e o servidor (D10)
 * usam a mesma regra.
 */
export type ValorLido = { tipo: 'numero'; valor: number } | { tipo: 'ambiguo' } | { tipo: 'nao_numerico' };

const NAO: ValorLido = { tipo: 'nao_numerico' };
const MAX = 1e15; // como exames.ts: acima disso o número perde precisão

export function lerValorLaudo(texto: string): ValorLido {
  const t = texto.normalize('NFC').replace(/\s+/g, '');
  if (!/^-?[\d.,]+$/.test(t)) return NAO; // comparadores (<, >, ≤, ≥), texto ("Não reagente"), vazio
  const negativo = t.startsWith('-');
  const s = negativo ? t.slice(1) : t;
  let normalizado: string;
  if (s.includes(',')) {
    // vírgula = decimal (uma só); pontos antes dela são de milhar, em grupos de 3
    const partes = s.split(',');
    if (partes.length !== 2) return NAO;
    const [inteira, decimal] = partes;
    if (!/^\d+$/.test(decimal) || !(/^\d+$/.test(inteira) || /^\d{1,3}(\.\d{3})+$/.test(inteira))) return NAO;
    if (!inteira.includes('.') && decimal.length === 3) return { tipo: 'ambiguo' };
    normalizado = `${inteira.replace(/\./g, '')}.${decimal}`;
  } else {
    const partes = s.split('.');
    if (partes.length === 1) {
      if (!/^\d+$/.test(s)) return NAO;
      normalizado = s;
    } else if (partes.length === 2) {
      const [a, b] = partes;
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return NAO;
      if (b.length === 3) return { tipo: 'ambiguo' };
      normalizado = `${a}.${b}`;
    } else {
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return NAO; // dois ou mais pontos: só milhar em grupos de 3
      normalizado = s.replace(/\./g, '');
    }
  }
  const v = Number(normalizado);
  if (!Number.isFinite(v) || Math.abs(v) >= MAX) return NAO;
  return { tipo: 'numero', valor: negativo ? -v : v };
}
