/**
 * Links que vão ao paciente (e-mail, push) dizem de qual consultório são: com 2+ vínculos o cookie `nd_vinculo` pode
 * estar em outro, e o link abriria o dado do consultório errado (ou 404). O valor é só uma preferência: requirePaciente e
 * requireApiPaciente só o usam se for vínculo ativo da conta (reconferido nos vínculos da conta, vinculosComConsultorio, como o cookie).
 * Sem servidor nem Next: o worker (e-mail, push) também monta esses links.
 */
export const PARAM_VINCULO = 'v';

/** `caminho` (começando com "/", pode ter query) com o consultório do link. */
export function telaDoPortal(caminho: string, tenantId: string): string {
  return `${caminho}${caminho.includes('?') ? '&' : '?'}${PARAM_VINCULO}=${encodeURIComponent(tenantId)}`;
}
