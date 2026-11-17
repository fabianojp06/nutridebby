import { requireApiNutri } from '@/lib/tenant-session';
import { exportarLancamentosCsv } from '@/modules/financeiro/exportacao';
import { periodoValido } from '@/modules/financeiro/meses';
import { arquivoCsv, irPara, recusaNaNavegacao, RELATORIOS } from '../navegacao';

export const dynamic = 'force-dynamic';

/**
 * US-306 / RN-321: `?de=AAAA-MM-DD&ate=AAAA-MM-DD&pacientes=0|1`. Período inválido (data que não existe, "De" depois de
 * "Até" ou mais de 366 dias) → 303 para Relatórios com `?erro=periodo` (o formulário confere antes; isto é a defesa).
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return recusaNaNavegacao(acesso);
  const q = new URL(req.url).searchParams;
  const de = q.get('de') ?? '';
  const ate = q.get('ate') ?? '';
  if (!periodoValido(de, ate)) return irPara(`${RELATORIOS}?erro=periodo`);
  const csv = await exportarLancamentosCsv(acesso.ctx, acesso.tenant, { de, ate, comPacientes: q.get('pacientes') === '1' });
  return arquivoCsv(csv, `lancamentos-${de}-a-${ate}.csv`);
}
