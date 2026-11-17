import { expect, type Page } from '@playwright/test';

/**
 * Plano 18 (RNF-263 g): o caminho dos E2E para preencher o formulário "Novo paciente". Desde o PR 2 do Plano 18 o
 * formulário tem os rótulos novos ("Nome completo" ao lado de "Nome social (opcional)"; "Celular / WhatsApp (opcional)"),
 * e é só aqui que eles aparecem para quem só precisa de um paciente.
 * Os E2E novos (Planos 17, 19, 20…) cadastram paciente por aqui, nunca pelos rótulos direto.
 * `whatsappAutorizado`: marca "Paciente autorizou receber mensagens por WhatsApp" (só com o `telefone`).
 * Devolve o caminho do prontuário (`/painel/pacientes/{id}`).
 */
export async function criarPacientePeloFormulario(
  nutri: Page,
  dados: { nome: string; email: string; nascimento?: string; sexo?: 'Feminino' | 'Masculino'; telefone?: string; whatsappAutorizado?: boolean },
): Promise<string> {
  await nutri.goto('/painel/pacientes/novo');
  // Plano 18 (T7a): "Nome completo" ao lado de "Nome social (opcional)" — exact, porque o getByLabel casa por trecho
  await nutri.getByLabel('Nome completo', { exact: true }).fill(dados.nome);
  await nutri.getByLabel('Data de nascimento').fill(dados.nascimento ?? '1990-05-20');
  await nutri.getByLabel(dados.sexo ?? 'Feminino').check();
  await nutri.getByLabel('E-mail').fill(dados.email);
  if (dados.telefone) await nutri.getByLabel('Celular / WhatsApp (opcional)').fill(dados.telefone);
  if (dados.telefone && dados.whatsappAutorizado) await nutri.getByLabel('Paciente autorizou receber mensagens por WhatsApp').check();
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  return new URL(nutri.url()).pathname;
}
