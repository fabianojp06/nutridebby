import { requireApiNutri } from '@/lib/tenant-session';
import { statusDoPdf } from '@/modules/plano-alimentar/carregar';
import { PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * US-026: estado da geração do PDF, para o painel liberar o "Baixar PDF" sem recarregar a página inteira
 * (cada recarga audita a leitura do paciente e do plano). `?paciente=` precisa ser o paciente do plano. P12-14: polling
 * não é uso — confere a sessão sem renovar.
 */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/planos/[id]/pdf'>) {
  const acesso = await requireApiNutri(req, { renovar: false });
  if (!acesso.ok) return acesso.response;
  const paciente = new URL(req.url).searchParams.get('paciente') ?? '';
  const pdfStatus = await statusDoPdf(acesso.ctx, (await params).id, paciente);
  if (pdfStatus === undefined) return Response.json({ erro: new PlanoNaoEncontradoError().message }, { status: 404, headers: SEM_CACHE });
  return Response.json({ pdfStatus }, { headers: SEM_CACHE });
}
