/**
 * Telefone digitado → E.164 (RNF-12). Sem "+", é brasileiro: DDD (11–99) + 8 dígitos (fixo, começa
 * com 2–5) ou 9 dígitos (celular, começa com 9); aceita "55" e "0" na frente. Com "+", só confere o
 * tamanho do E.164 (8 a 15 dígitos). Nada é inventado: número que não fecha vira null.
 */
export function normalizarTelefone(txt: string): string | null {
  const t = txt.trim();
  if (!t) return null;
  const digitos = t.replace(/\D/g, '');
  if (t.startsWith('+')) {
    if (digitos.startsWith('55')) return brasileiro(digitos.slice(2));
    return /^[1-9]\d{7,14}$/.test(digitos) ? `+${digitos}` : null;
  }
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return brasileiro(digitos.slice(2));
  return brasileiro(digitos.replace(/^0+/, ''));
}

function brasileiro(d: string): string | null {
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9][1-9]$/.test(d.slice(0, 2))) return null;
  const numero = d.slice(2);
  if (numero.length === 9 && numero[0] !== '9') return null;
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null;
  return `+55${d}`;
}

/** E.164 brasileiro → "(11) 91234-5678"; outros países ficam como estão. */
export function formatarTelefone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
