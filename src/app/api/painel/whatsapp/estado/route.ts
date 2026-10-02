import { logger } from '@/lib/logger';
import { requireApiNutri } from '@/lib/tenant-session';
import { provedorDoApp, sincronizarEstado, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { WhatsappIndisponivelError } from '@/modules/notificacoes/whatsapp/provedor';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** Polling da tela de conexão (a cada 3 s enquanto o QR está na tela). Só estado e número: nada do provedor vaza. */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const provedor = provedorDoApp();
  try {
    const s = provedor ? await sincronizarEstado(acesso.ctx, provedor) : await situacaoDoWhatsapp(acesso.ctx, false);
    return Response.json({ estado: s.estado, numero: s.numero }, { headers: SEM_CACHE });
  } catch (e) {
    if (!(e instanceof WhatsappIndisponivelError)) throw e;
    logger.warn({ tenantId: acesso.ctx.tenantId, err: e.message }, 'WhatsApp indisponível no polling');
    const s = await situacaoDoWhatsapp(acesso.ctx, true);
    return Response.json({ estado: s.estado, numero: s.numero }, { headers: SEM_CACHE });
  }
}
