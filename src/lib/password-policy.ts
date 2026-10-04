export function validatePasswordPolicy(pw: string, common?: ReadonlySet<string>): string | null {
  if (pw.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (pw.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  if (!/\p{L}/u.test(pw) || !/\p{Nd}/u.test(pw)) {
    return 'A senha precisa ter pelo menos 1 letra e 1 número.';
  }
  if (common?.has(pw.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  return null;
}
