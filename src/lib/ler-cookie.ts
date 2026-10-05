/**
 * Um cookie do cabeçalho `Cookie` (o valor pode ter "="). Sem `server-only` nem sessão: a rota do link do documento
 * (RN-158, sem login) o usa sem puxar a sessão do paciente (code review do PR #19, item 7); paciente-session.ts o reexporta.
 */
export function lerCookie(header: string | null, nome: string): string | undefined {
  for (const parte of (header ?? '').split(';')) {
    const [n, ...v] = parte.trim().split('=');
    if (n === nome) return v.join('=');
  }
  return undefined;
}
