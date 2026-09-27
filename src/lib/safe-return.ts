export function safeReturnPath(v: string | null | undefined): string | null {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  try {
    const u = new URL(v, 'http://interno.invalid');
    return u.origin === 'http://interno.invalid' ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}
