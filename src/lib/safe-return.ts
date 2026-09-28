export function safeReturnPath(v: string | null | undefined): string | null {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  try {
    const u = new URL(v, 'http://interno.invalid');
    return u.origin === 'http://interno.invalid' ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

/** `path` com `?volta=` quando o destino de retorno é seguro; senão, só `path`. */
export function withReturnPath(path: string, volta: string | null | undefined): string {
  const safe = safeReturnPath(volta);
  return safe ? `${path}?volta=${encodeURIComponent(safe)}` : path;
}
