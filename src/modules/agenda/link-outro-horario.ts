import type { TenantRow } from '@/db/schema';
import { urlDoApp } from '@/lib/url-do-app';
import { telaDoPortal } from '@/modules/portal/link-portal';

/**
 * Plano 23 (RN-428): o link "Escolha outro horário" do pedido não confirmado — `/p/agenda/nova` do consultório quando o
 * pedido veio do portal; da página pública, `/n/<slug>` só com a página ligada (`agendamento_publico_ativo`); sem ela, nulo
 * (o e-mail sai só com a primeira frase). Arquivo puro (T7): `solicitacoes.ts` monta o da pessoa nova sem importar
 * `notificacoes/mensagens.ts` (grafo de imports do plano); `mensagens.ts` reexporta.
 */
export function linkDeOutroHorario(o: { daPagina: boolean; tenant: Pick<TenantRow, 'id' | 'slug' | 'agendamentoPublicoAtivo'> }, appUrl: string): string | null {
  if (!o.daPagina) return urlDoApp(appUrl, telaDoPortal('/p/agenda/nova', o.tenant.id));
  return o.tenant.agendamentoPublicoAtivo ? urlDoApp(appUrl, `/n/${o.tenant.slug}`) : null;
}
