import { requireApiNutri } from '@/lib/tenant-session';
import { revisaoDoPlano } from '@/modules/plano-alimentar/carregar';
import { PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * D7: só a revisão do plano, para o editor conferir ao abrir se a página veio do cache do "Voltar" do navegador
 * (conteúdo e revisão velhos davam um falso "alterado em outra aba"). Sem auditoria: não é dado de saúde.
 * `?paciente=` precisa ser o paciente do plano; modelo vai sem ele.
 */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/planos/[id]/revisao'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const paciente = new URL(req.url).searchParams.get('paciente');
  const revisao = await revisaoDoPlano(acesso.ctx, (await params).id, paciente);
  if (revisao === undefined) return Response.json({ erro: new PlanoNaoEncontradoError().message }, { status: 404, headers: SEM_CACHE });
  return Response.json({ revisao }, { headers: SEM_CACHE });
}
