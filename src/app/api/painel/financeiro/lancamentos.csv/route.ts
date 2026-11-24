import { requireApiNutri } from '@/lib/tenant-session';
import { exportarLancamentosCsv } from '@/modules/financeiro/exportacao';
import { periodoValido } from '@/modules/financeiro/meses';
import { arquivoCsv, irPara, recusaNaNavegacao, recusaDeOrigem, RELATORIOS, semHead } from '../navegacao';

export const dynamic = 'force-dynamic';

/**
 * US-306 / RN-321: `?de=AAAA-MM-DD&ate=AAAA-MM-DD&pacientes=0|1` (Plano 23: `&local=<id>|sem_local`). Período inválido (data que não existe, "De" depois de
 * "Até" ou mais de 366 dias) → 303 para Relatórios com `?erro=periodo` (o formulário confere antes; isto é a defesa).
 * Pedido vindo de outro site, ou sem como confirmar a origem → 303 para Relatórios, sem `exportar` (`recusaDeOrigem`).
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return recusaNaNavegacao(acesso);
  const origem = recusaDeOrigem(req, 'lancamentos');
  if (origem) return origem;
  const q = new URL(req.url).searchParams;
  const de = q.get('de') ?? '';
  const ate = q.get('ate') ?? '';
  if (!periodoValido(de, ate)) return irPara(`${RELATORIOS}?erro=periodo`);
  const local = q.get('local') || undefined; // Plano 23 (RN-437): um local ou `sem_local`; outro valor é ignorado (filtroDeLocal)
  const csv = await exportarLancamentosCsv(acesso.ctx, acesso.tenant, { de, ate, comPacientes: q.get('pacientes') === '1', localId: local });
  return arquivoCsv(csv, `lancamentos-${de}-a-${ate}.csv`);
}

export async function HEAD() {
  return semHead();
}
