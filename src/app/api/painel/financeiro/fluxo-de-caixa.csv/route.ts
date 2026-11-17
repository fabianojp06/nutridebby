import { requireApiNutri } from '@/lib/tenant-session';
import { exportarFluxoCsv } from '@/modules/financeiro/exportacao';
import { arquivoCsv, irPara, recusaNaNavegacao, recusaDeOrigem, RELATORIOS, semHead } from '../navegacao';

export const dynamic = 'force-dynamic';

/**
 * US-306: `?ano=AAAA` (2000 a 2100). Ano inválido → 303 para Relatórios (o link da tela sempre leva um ano da lista).
 * Pedido vindo de outro site, ou sem como confirmar a origem → 303 para Relatórios, sem `exportar` (`recusaDeOrigem`).
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return recusaNaNavegacao(acesso);
  const origem = recusaDeOrigem(req);
  if (origem) return origem;
  const texto = new URL(req.url).searchParams.get('ano') ?? '';
  const ano = Number(texto);
  if (!/^\d{4}$/.test(texto) || ano < 2000 || ano > 2100) return irPara(RELATORIOS);
  return arquivoCsv(await exportarFluxoCsv(acesso.ctx, ano), `fluxo-de-caixa-${ano}.csv`);
}

export async function HEAD() {
  return semHead();
}
