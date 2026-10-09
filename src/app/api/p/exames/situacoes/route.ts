import { requireApiPaciente } from '@/lib/paciente-session';
import { situacoesDosMeusEnvios } from '@/modules/portal/exames-enviados';

export const dynamic = 'force-dynamic';

/**
 * Hotfix de 09/10/2026: a consulta automática de `/p/exames` enquanto algum envio está "Processando…" — só `[{ id, status }]`
 * dos envios da sessão de paciente, sem auditRead (só estado, como a do estado da tarefa de IA). A tela chama com o
 * cabeçalho de consulta automática (não renova a sessão); a recusa da sessão é a de sempre (401/403).
 */
export async function GET(req: Request): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  return Response.json(await situacoesDosMeusEnvios(acesso.ctx), { headers: { 'cache-control': 'no-store' } });
}
