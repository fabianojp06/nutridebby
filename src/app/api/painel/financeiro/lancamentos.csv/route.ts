import { requireApiNutri } from '@/lib/tenant-session';
import { LocalDoFiltroInvalidoError } from '@/modules/financeiro/erros';
import { exportarLancamentosCsv } from '@/modules/financeiro/exportacao';
import { periodoValido } from '@/modules/financeiro/meses';
import { SEM_LOCAL } from '@/modules/financeiro/tipos';
import { idValido } from '@/modules/pacientes/base';
import { arquivoCsv, irPara, recusaNaNavegacao, recusaDeOrigem, RELATORIOS, semHead, sufixoDoLocal } from '../navegacao';

export const dynamic = 'force-dynamic';

/**
 * US-306 / RN-321: `?de=AAAA-MM-DD&ate=AAAA-MM-DD&pacientes=0|1` (Plano 23: `&local=<id>|sem_local`; fora das opções,
 * 303 para Relatórios com `?erro=local`, sem exportar; o recorte vai no nome do arquivo). Período inválido (data que não existe, "De" depois de
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
  // Plano 23 (RN-437, AG-D79): um local das opções ou `sem_local`; outro valor volta com `?erro=local`, sem exportar
  const localId = q.get('local') || undefined;
  if (localId !== undefined && localId !== SEM_LOCAL && !idValido(localId)) return irPara(`${RELATORIOS}?erro=local`);
  let r: Awaited<ReturnType<typeof exportarLancamentosCsv>>;
  try {
    r = await exportarLancamentosCsv(acesso.ctx, acesso.tenant, { de, ate, comPacientes: q.get('pacientes') === '1', localId });
  } catch (e) {
    if (e instanceof LocalDoFiltroInvalidoError) return irPara(`${RELATORIOS}?erro=local`);
    throw e;
  }
  return arquivoCsv(r.csv, `lancamentos-${de}-a-${ate}${sufixoDoLocal(r.local)}.csv`);
}

export async function HEAD() {
  return semHead();
}
