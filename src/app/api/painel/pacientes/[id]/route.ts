import { requireApiNutri } from '@/lib/tenant-session';
import { buscarPaciente } from '@/modules/pacientes/pacientes';
import { formatarTelefone } from '@/modules/pacientes/telefone';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-006: paciente fora do tenant (a RLS esconde) ou id malformado → 404, nunca 403 nem 500. */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const p = await buscarPaciente(acesso.ctx, id);
  if (!p) return Response.json({ erro: 'Paciente não encontrado' }, { status: 404, headers: SEM_CACHE });
  return Response.json(
    {
      id: p.id,
      nome: p.nome,
      dataNascimento: p.dataNascimento,
      sexo: p.sexo,
      email: p.email,
      telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : null,
      status: p.status,
      acessoAtivo: p.userId !== null,
    },
    { headers: SEM_CACHE },
  );
}
