import Link from 'next/link';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { contadorDeDuvidas } from '@/modules/ia/nutri-paciente/duvidas';
import { contadorDeMensagens } from '@/modules/mensagens/caixa';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';

const M = MSG_MENSAGENS.menu;

export type ContagensDasAbas = { conversas: number; duvidas: { mostrar: boolean; n: number } };

/**
 * Os números das abas, sem auditRead (só contagem, RN-453): "Conversas ({n})" = conversas com mensagem do paciente não
 * lida; "Dúvidas da IA Nutri ({n})" = dúvidas abertas, e a aba só aparece com a IA Nutri ativada ou com dúvida aberta (a
 * regra de hoje do item do menu do Plano 15: a fila continua depois de desativar).
 */
export async function contagensDasAbas(ctx: TenantContext, tenant: Pick<TenantRow, 'iaNutriAtivadaEm'>): Promise<ContagensDasAbas> {
  const [conversas, abertas] = await Promise.all([contadorDeMensagens(ctx), contadorDeDuvidas(ctx)]);
  return { conversas, duvidas: { mostrar: !!tenant.iaNutriAtivadaEm || abertas > 0, n: abertas } };
}

/**
 * §4.1: as abas de Mensagens — só na caixa, na fila /painel/duvidas e (T10) em Recados; nunca na conversa. Links com
 * `aria-current="page"`, sublinhado e negrito na atual (não só cor), como as seções do Financeiro. Na própria fila, a aba
 * das dúvidas aparece mesmo sem IA Nutri e sem dúvida aberta (é a tela aberta).
 */
export function AbasDeMensagens({ atual, contagens }: { atual: 'conversas' | 'duvidas'; contagens: ContagensDasAbas }) {
  const { conversas, duvidas } = contagens;
  const abas = [
    { id: 'conversas', href: '/painel/mensagens', rotulo: conversas > 0 ? M.abaConversasComContador(conversas) : M.abaConversas },
    ...(duvidas.mostrar || atual === 'duvidas'
      ? [{ id: 'duvidas', href: '/painel/duvidas', rotulo: duvidas.n > 0 ? M.abaDuvidasComContador(duvidas.n) : M.abaDuvidas }]
      : []),
  ];
  return (
    <nav aria-label={M.rotuloDasAbas} data-guia="mensagens-abas">
      <ul className="flex flex-wrap border-b border-borda">
        {abas.map((a) => {
          const ativa = a.id === atual;
          return (
            <li key={a.id}>
              <Link
                href={a.href}
                prefetch={false}
                aria-current={ativa ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap px-3 ${ativa ? 'border-b-2 border-marca font-semibold' : 'text-suave hover:text-texto'}`}
              >
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
