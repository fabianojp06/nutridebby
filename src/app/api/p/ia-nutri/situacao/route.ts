import { requireApiPaciente } from '@/lib/paciente-session';
import { situacoesDasPerguntas } from '@/modules/ia/nutri-paciente/conversa';

export const dynamic = 'force-dynamic';

/**
 * RNF-160 / §4.2: a consulta automática da conversa da IA Nutri enquanto a pergunta está "Pensando…" — só `[{ id, status }]`
 * das perguntas da sessão de paciente, sem auditRead (só estado, molde de /api/p/exames/situacoes). A recusa da sessão é a
 * de sempre (401/403).
 */
export async function GET(req: Request): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  return Response.json(await situacoesDasPerguntas(acesso.ctx), { headers: { 'cache-control': 'no-store' } });
}
