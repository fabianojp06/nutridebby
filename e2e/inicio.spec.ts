import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

// Plano 08, T15 (D21, D22): o Início em bento. IPs deste spec: 10.9.13.71 e .72.
test('Início em bento: "Seu dia", próxima consulta, hoje, diários, agenda do dia, app na semana, critérios de sucesso e atalhos', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.71');
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Seu dia, \S+$/ })).toBeVisible();
  await expect(page.getByText('Painel da nutricionista')).toHaveCount(0);

  // o cartão de destaque sempre tem para onde ir (consulta ou "Agendar") e marca o contêiner do foco branco (T12)
  const proxima = page.getByRole('region', { name: 'Próxima consulta' });
  await expect(proxima.getByRole('link', { name: /^(Abrir prontuário|Agendar)$/ })).toBeVisible();
  await expect(proxima).toHaveAttribute('data-sobre-marca', '');

  await expect(page.getByRole('region', { name: 'Hoje' }).getByText(/^\d+ consultas?$/)).toBeVisible();
  const diarios = page.getByRole('region', { name: 'Diários para ver' });
  await expect(diarios.getByText(/^\d+ registros? novos?$/)).toBeVisible();
  await expect(diarios.getByRole('link', { name: 'Abrir Diários' })).toHaveAttribute('href', '/painel/diarios');
  await expect(page.getByRole('region', { name: 'Agenda do dia' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pacientes no app esta semana' }).getByText(/^\d+ de \d+ pacientes abriram o app nos últimos 7 dias$/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Critérios de sucesso' }).getByText(/^Atendimentos registrados: \d+ de \d+ consultas realizadas \((\d+%|—)\)$/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agenda', exact: true }).getByText(/^Consultas do mês: \d+$/)).toBeVisible();

  const atalhos = page.getByRole('region', { name: 'Atalhos' });
  await expect(atalhos.getByRole('link', { name: 'Novo paciente' })).toHaveAttribute('href', '/painel/pacientes/novo');
  await expect(atalhos.getByRole('link', { name: 'Agendar' })).toHaveAttribute('href', '/painel/agenda/nova');
  await expect(atalhos.getByRole('link', { name: 'Novo conteúdo' })).toHaveAttribute('href', '/painel/conteudos/novo?tipo=video');
  await atalhos.getByRole('link', { name: 'Novo paciente' }).click();
  await expect(page).toHaveURL(/\/painel\/pacientes\/novo$/);
  await page.context().close();
});

test('Início no celular (360 e 320 px): os cartões empilham sem rolagem lateral', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.72', { viewport: { width: 360, height: 800 } });
  await expect(page).toHaveURL(/\/painel$/);
  for (const largura of [360, 320]) {
    await page.setViewportSize({ width: largura, height: 800 });
    await expect(page.getByRole('region', { name: 'Próxima consulta' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura} px`).toBe(true);
  }
  await page.context().close();
});
