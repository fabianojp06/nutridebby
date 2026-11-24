import { requireApiNutri } from '@/lib/tenant-session';
import { situacao } from '@/modules/mensagens/conversa';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * Plano 25, T6b (RN-452): "há novas?" da conversa aberta no painel — quantas mensagens do paciente vieram depois da última
 * mostrada (`depois`, um id resolvido no SQL com o tenant e o paciente; vazio = a tela estava vazia) e o "Lida". Só
 * `{ novas, ultimaLida }`: nada de texto, autor ou anexo; sem auditRead e sem mexer no marcador (o conteúdo só vem do render,
 * depois do toque em "Mostrar novas mensagens"). Consulta automática: confere a sessão sem renovar (P12-14).
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req, { renovar: false });
  if (!acesso.ok) return acesso.response;
  const q = new URL(req.url).searchParams;
  const depois = q.get('depois') || null;
  const { novas, ultimaLida } = await situacao(acesso.ctx, { patientId: q.get('paciente') ?? '', depois });
  return Response.json({ novas, ultimaLida }, { headers: SEM_CACHE });
}
