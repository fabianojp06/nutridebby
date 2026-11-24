import { requireApiPaciente } from '@/lib/paciente-session';
import { situacao } from '@/modules/mensagens/conversa';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * Plano 25, T7 (RN-452, US-443): "há novas?" da conversa aberta no app — quantas mensagens da nutricionista (e cópias de
 * recado) vieram depois da última mostrada (`depois`, um id resolvido no SQL com o tenant e o paciente DA SESSÃO; vazio = a
 * tela estava vazia) e o "Lida". Só `{ novas, ultimaLida }`: nada de texto, autor ou anexo; sem auditRead e sem mexer no
 * marcador (o conteúdo só vem do render, depois do toque em "Mostrar novas mensagens"). A consulta automática manda o
 * cabeçalho que não renova a sessão (requireApiUser). A recusa da sessão é a de sempre (401/403).
 */
export async function GET(req: Request) {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const depois = new URL(req.url).searchParams.get('depois') || null;
  const { novas, ultimaLida } = await situacao(acesso.ctx, { depois });
  return Response.json({ novas, ultimaLida }, { headers: SEM_CACHE });
}
