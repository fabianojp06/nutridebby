import { expect, type Page } from '@playwright/test';

/**
 * Plano 18 (T12a): as duas pacientes do cadastro complementar do seed (`E2E_CADASTRO_COMPLETO` e `E2E_CADASTRO_INCOMPLETO`
 * em scripts/e2e-seed.ts), copiadas — importar o seed roda o seed. A completa aparece na lista e no título da ficha pelo
 * nome social; o CPF é o do "CPF repetido" do cadastro.spec.
 */
export const SEMENTE_COMPLETA = {
  email: 'cadastro-completo-e2e@nutridebby.test',
  nome: 'João Cadastro Semente',
  nomeSocial: 'Joana Cadastro Semente',
  cpf: '180.180.180-06',
} as const;
export const SEMENTE_INCOMPLETA = { email: 'cadastro-incompleto-e2e@nutridebby.test', nome: 'Iris Cadastro Incompleto' } as const;

/** O caminho da ficha (`/painel/pacientes/{id}`) pela busca da lista (pelo e-mail; a linha mostra o nome exibido). */
export async function fichaPelaBusca(nutri: Page, email: string, nomeNaLista: string): Promise<string> {
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(email)}`);
  const link = nutri.getByRole('table').getByRole('link', { name: nomeNaLista, exact: true });
  await expect(link).toHaveAttribute('href', /^\/painel\/pacientes\/[0-9a-f-]{36}$/);
  return (await link.getAttribute('href'))!;
}
