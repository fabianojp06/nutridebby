import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import sharp from 'sharp';
import { entrarComo } from './helpers';

/**
 * Plano 10A (T16): a nutricionista só do fluxo de documentos, com o 2FA já ativo no seed (scripts/e2e-seed.ts, E2E_DOCS —
 * copiada: importar o seed roda o seed). O Better Auth guarda o segredo em texto puro e usa os bytes UTF-8 dele como chave
 * do HMAC (o app autenticador recebe o base32 disso pela URI): por isso `Secret.fromUTF8`.
 */
export const DOCS = { email: 'docs-e2e@nutridebby.test', senha: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
const totp = new TOTP({ secret: Secret.fromUTF8(DOCS.totp), digits: 6, period: 30 });
const PERIODO_MS = 30_000;
const MSG_CODIGO_RECUSADO = 'Código inválido. Confira o horário do celular e tente de novo.'; // MSG_RECUSA.codigo_2fa
const MSG_OUTRO_ENVIO = 'Outro envio está em andamento. Tente de novo em instantes.'; // 429 da rota /digitalizada (um envio por usuária)

let passoUsado = -1;
/**
 * Código do 2FA para assinar. RN-145: o mesmo código não vale duas vezes em 90 s (confirmar-2fa.ts) — duas assinaturas
 * seguidas neste processo esperam o próximo passo de 30 s.
 */
async function codigoParaAssinar(): Promise<string> {
  if (Math.floor(Date.now() / PERIODO_MS) === passoUsado) await new Promise((r) => setTimeout(r, (passoUsado + 1) * PERIODO_MS - Date.now() + 250));
  passoUsado = Math.floor(Date.now() / PERIODO_MS);
  return totp.generate();
}

/** Login da E2E_DOCS: senha e o desafio do 2FA. O painel em tela de computador. */
export async function entrarComoDocs(browser: Browser, ip: string, opcoes: BrowserContextOptions = {}): Promise<Page> {
  const page = await entrarComo(browser, DOCS.email, DOCS.senha, ip, { viewport: { width: 1280, height: 900 }, ...opcoes });
  await expect(page).toHaveURL(/\/entrar\/2fa/);
  await page.getByLabel('Código do app autenticador').fill(totp.generate());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  return page;
}

/** R8 (d): a "foto" da página assinada — PNG branco 800 × 1100, gerado na hora (nada versionado, nenhum dado pessoal). */
export async function paginaAssinada() {
  const buffer = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return { name: 'pagina.png', mimeType: 'image/png', buffer };
}

/** O axe do painel (as mesmas regras do acessibilidade-painel.spec), também com o contraste "incompleto" como falha. */
export async function violacoesNoPainel(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

/**
 * O envio digitalizado (fotos + 2FA) do documento aberto em "Aguardando assinatura" — receita ou parecer (D2 = (a)).
 * Devolve o código de verificação como a tela mostra (XXXX-XXXX-XXXX). `noFormulario` roda com o formulário das fotos aberto.
 * Outra spec (outro processo do Playwright) pode assinar com a mesma conta no mesmo passo do TOTP: a recusa do código
 * repetido espera o próximo passo e envia de novo (no máximo 3 vezes; o acerto zera o contador de erros). Ou no mesmo
 * instante: o 429 "Outro envio está em andamento" (RNF-141, um envio por usuária, antes do 2FA) também espera o próximo
 * passo e envia de novo (no máximo 5 vezes).
 */
export async function assinarDigitalizada(page: Page, opcoes: { noFormulario?: () => Promise<void> } = {}): Promise<string> {
  await page.getByRole('button', { name: 'Enviar documento digitalizado (assinado à mão)' }).click();
  // WCAG 2.4.3 (sugestão da T9 do Plano 10A): o botão sai do DOM; o foco vai ao aviso da spec, não cai no <body>
  await expect(page.getByRole('note').filter({ hasText: 'O sistema não confere o conteúdo de documentos digitalizados.' })).toBeFocused();
  await opcoes.noFormulario?.();
  const foto = await paginaAssinada();
  for (let recusas = 0, ocupados = 0; ; ) {
    await page.getByLabel('Fotos das páginas (JPEG ou PNG, até 5)').setInputFiles(foto);
    await page.getByLabel('Código da verificação em duas etapas').fill(await codigoParaAssinar());
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/digitalizada')),
      page.getByRole('button', { name: 'Enviar', exact: true }).click(),
    ]);
    if (resposta.status() === 429 && ++ocupados < 5) {
      await expect(page.getByRole('alert').filter({ hasText: MSG_OUTRO_ENVIO })).toBeVisible();
      continue;
    }
    if (resposta.status() !== 422 || ((await resposta.json()) as { codigo?: string }).codigo !== 'codigo_2fa' || ++recusas === 3) break;
    await expect(page.getByRole('alert').filter({ hasText: MSG_CODIGO_RECUSADO })).toBeVisible();
  }
  await expect(page.getByText('Assinado em', { exact: true })).toBeVisible({ timeout: 60_000 });
  return (await page.getByText(/^Código de verificação: /).innerText()).replace('Código de verificação: ', '');
}

/**
 * US-142 a US-144: receita pela tela, do rascunho à assinatura digitalizada (a única do Plano 10A). Devolve o código de
 * verificação como a tela mostra (XXXX-XXXX-XXXX). `noFormulario` roda com o formulário das fotos aberto (o axe da spec).
 * O envio das fotos é o `assinarDigitalizada` (Plano 13: o parecer assina igual).
 */
export async function emitirReceita(page: Page, prontuario: string, opcoes: { noFormulario?: () => Promise<void> } = {}): Promise<string> {
  await page.goto(`${prontuario}/documentos`);
  await page.getByRole('button', { name: 'Nova receita' }).click();
  await expect(page).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Componente 1').fill('Vitamina D3');
  await page.getByLabel('Quantidade').fill('2000');
  await page.getByLabel('Unidade').selectOption('UI');
  await page.getByLabel('Forma de apresentação').fill('Cápsula');
  await page.getByLabel('Posologia').fill('1 cápsula ao dia, no almoço');
  await page.getByLabel('Justificativa de uso').fill('Exposição solar baixa');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
  await page.getByLabel(/Declaro que os itens são suplementos/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  return assinarDigitalizada(page, opcoes);
}
