import { requireApiNutri } from '@/lib/tenant-session';
import { exportarFluxoCsv } from '@/modules/financeiro/exportacao';
import { arquivoCsv, irPara, recusaNaNavegacao, RELATORIOS } from '../navegacao';

export const dynamic = 'force-dynamic';

/** US-306: `?ano=AAAA` (2000 a 2100). Ano inválido → 303 para Relatórios (o link da tela sempre leva um ano da lista). */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return recusaNaNavegacao(acesso);
  const texto = new URL(req.url).searchParams.get('ano') ?? '';
  const ano = Number(texto);
  if (!/^\d{4}$/.test(texto) || ano < 2000 || ano > 2100) return irPara(RELATORIOS);
  return arquivoCsv(await exportarFluxoCsv(acesso.ctx, ano), `fluxo-de-caixa-${ano}.csv`);
}
