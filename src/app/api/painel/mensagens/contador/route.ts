import { requireApiNutri } from '@/lib/tenant-session';
import { contadorDeDuvidas } from '@/modules/ia/nutri-paciente/duvidas';
import { contadorDeMensagens } from '@/modules/mensagens/caixa';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * Plano 25 (RN-459, CH-D43): o número do item "Mensagens" do menu para a consulta de 60 s do painel — conversas com
 * mensagem do paciente não lida + dúvidas abertas da IA Nutri. Só `{ n }`: nada de nome, texto ou id; sem auditRead (como
 * a caixa e a fila, RN-453). Consulta automática: confere a sessão sem renovar (P12-14). GET sem efeito: a guarda de mesma
 * origem não se aplica.
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req, { renovar: false });
  if (!acesso.ok) return acesso.response;
  const [naoLidas, abertas] = await Promise.all([contadorDeMensagens(acesso.ctx), contadorDeDuvidas(acesso.ctx)]);
  return Response.json({ n: naoLidas + abertas }, { headers: SEM_CACHE });
}
