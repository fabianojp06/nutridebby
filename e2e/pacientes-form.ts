import { expect, type Page } from '@playwright/test';

/**
 * Plano 18 (RNF-263 g): o único lugar dos E2E que preenche o formulário "Novo paciente". O PR 2 do Plano 18 troca os
 * rótulos do formulário ("Nome" vira "Nome completo", ao lado de "Nome social"; o telefone muda): só este helper muda.
 * Os E2E novos (Planos 17, 19, 20…) cadastram paciente por aqui, nunca pelos rótulos direto.
 * Devolve o caminho do prontuário (`/painel/pacientes/{id}`).
 */
export async function criarPacientePeloFormulario(
  nutri: Page,
  dados: { nome: string; email: string; nascimento?: string; sexo?: 'Feminino' | 'Masculino'; telefone?: string },
): Promise<string> {
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(dados.nome);
  await nutri.getByLabel('Data de nascimento').fill(dados.nascimento ?? '1990-05-20');
  await nutri.getByLabel(dados.sexo ?? 'Feminino').check();
  await nutri.getByLabel('E-mail').fill(dados.email);
  if (dados.telefone) await nutri.getByLabel('Telefone (opcional)').fill(dados.telefone);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  return new URL(nutri.url()).pathname;
}
