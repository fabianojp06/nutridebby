import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano, paraCliente } from '@/modules/plano-alimentar/carregar';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { salvarRascunho } from '@/modules/plano-alimentar/rascunho';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };
const LIMITE_CORPO = 512 * 1024;
const json = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: SEM_CACHE });

export async function GET(req: Request, { params }: RouteContext<'/api/painel/planos/[id]'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const plano = await carregarPlano(acesso.ctx, (await params).id);
  return plano ? json(200, paraCliente(plano)) : json(404, { erro: new PlanoNaoEncontradoError().message });
}

/** US-022 "Salvamento automático" (D7). P09-01: só da própria origem (o editor manda o `fetch` do próprio app). */
export async function PUT(req: Request, { params }: RouteContext<'/api/painel/planos/[id]'>) {
  if (!mesmaOrigem(req)) return json(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  let entrada: unknown;
  try {
    // lê no máximo LIMITE_CORPO bytes (não confia no Content-Length); acima disso, 413 sem carregar o resto
    entrada = JSON.parse((await lerCorpoLimitado(req, LIMITE_CORPO)).toString('utf8'));
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, { erro: MSG_PLANO.grande });
    return json(422, { erros: { geral: MSG_PLANO.invalido } });
  }
  try {
    return json(200, await salvarRascunho(acesso.ctx, id, entrada));
  } catch (e) {
    if (e instanceof PlanoError) return json(422, { erros: e.erros });
    // 409 com o motivo: o editor para nos três, mas só o `conflito` é "alterado em outra aba"
    if (e instanceof ConflitoRevisaoError) return json(409, { erro: e.message, codigo: 'conflito' });
    if (e instanceof PacienteBloqueadoError) return json(409, { erro: e.message, codigo: 'bloqueado' });
    if (e instanceof PlanoNaoEditavelError) return json(409, { erro: e.message, codigo: 'nao_editavel' });
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) return json(404, { erro: new PlanoNaoEncontradoError().message });
    throw e;
  }
}
