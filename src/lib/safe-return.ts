const BASE = 'http://interno.invalid';

/** true se `p` é um caminho local que continua local quando resolvido (sem `//` nem `/\`). */
function isLocalPath(p: string): boolean {
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return false;
  try {
    return new URL(p, BASE).origin === BASE;
  } catch {
    return false;
  }
}

export function safeReturnPath(v: string | null | undefined): string | null {
  if (!v || !isLocalPath(v)) return null;
  const u = new URL(v, BASE);
  // A normalização do WHATWG pode transformar "/.//evil.com", "/a/..//evil.com" ou
  // "/%2e//evil.com" em "//evil.com": a SAÍDA também precisa ser um caminho local.
  const out = `${u.pathname}${u.search}`;
  return isLocalPath(out) ? out : null;
}

/** `path` com `?volta=` quando o destino de retorno é seguro; senão, só `path`. */
export function withReturnPath(path: string, volta: string | null | undefined): string {
  const safe = safeReturnPath(volta);
  return safe ? `${path}?volta=${encodeURIComponent(safe)}` : path;
}
