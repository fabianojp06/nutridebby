/**
 * Plano 18 (RN-261, RN-262): CPF do cadastro complementar. Gravado só com os 11 dígitos; o dígito verificador é conferido
 * aqui, no servidor. O CPF só aparece no campo do Perfil/Novo paciente e no `dados.json` da exportação: nunca na lista, em
 * URL, em log, no Sentry nem em mensagem (as mensagens de erro nunca repetem o valor).
 */

/** Tira pontos, traço e espaços; `null` se não sobrarem exatamente 11 dígitos (0–9). */
export function normalizarCpf(s: string): string | null {
  const d = s.replace(/[.\-\s]/g, '');
  return /^[0-9]{11}$/.test(d) ? d : null;
}

function digitoVerificador(base: string): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Os 11 dígitos já normalizados, com os dois verificadores certos; 11 dígitos iguais são inválidos. */
export function cpfValido(digitos: string): boolean {
  if (!/^[0-9]{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  return digitoVerificador(digitos.slice(0, 9)) === Number(digitos[9]) && digitoVerificador(digitos.slice(0, 10)) === Number(digitos[10]);
}

/** 11 dígitos → `000.000.000-00` (qualquer outra coisa volta como está). */
export function formatarCpf(digitos: string): string {
  const m = /^(\d{3})(\d{3})(\d{3})(\d{2})$/.exec(digitos);
  return m ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : digitos;
}
