/**
 * Plano 18 (RN-262): CEP do cadastro complementar. Gravado só com os 8 dígitos; puro (o formulário, o painel e a
 * exportação usam). O CEP nunca vai para log, URL nem mensagem (as mensagens de erro nunca repetem o valor).
 */

/** Tira pontos, traço e espaços (como `normalizarCpf`); `null` se não sobrarem exatamente 8 dígitos (0–9). */
export function normalizarCep(s: string): string | null {
  const d = s.replace(/[.\-\s]/g, '');
  return /^[0-9]{8}$/.test(d) ? d : null;
}

/** 8 dígitos → `00000-000` (qualquer outra coisa volta como está). */
export function formatarCep(digitos: string): string {
  const m = /^(\d{5})(\d{3})$/.exec(digitos);
  return m ? `${m[1]}-${m[2]}` : digitos;
}
