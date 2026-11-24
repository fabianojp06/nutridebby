import type { Metadata } from 'next';
import Link from 'next/link';
import { BotaoLink } from '@/components/ui/botao';
import { requireNutri } from '@/lib/tenant-session';
import { caixaDeMensagens } from '@/modules/mensagens/caixa';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { classeDoItem } from '../navegacao';
import { AbasDeMensagens, contagensDasAbas } from './abas';
import { buscaDaUrl, comParametros, ListaDaCaixa, paginaDaUrl } from './lista';

export const dynamic = 'force-dynamic';
/** §7.1: o título da aba do navegador é sempre "Mensagens", nunca o nome do paciente. */
export const metadata: Metadata = { title: MSG_MENSAGENS.caixa.titulo };

const C = MSG_MENSAGENS.caixa;
const BASE = '/painel/mensagens';
const CAMPO = 'min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto';

/**
 * US-442 (§4.1, §7.1): a caixa — as abas, o filtro "Todas"/"Não lidas" (links-pílula com aria-current) e a busca num
 * formulário GET (funciona sem JS), a lista (risco não lido no topo, depois a mais recente) e "Mostrar mais" (?pagina=, 50
 * por página). Só as conversas liberadas ou com mensagem individual (CH-D42). Sem auditRead e nunca o texto das mensagens
 * (RN-453): abrir a conversa é que lê.
 */
export default async function Mensagens({ searchParams }: PageProps<'/painel/mensagens'>) {
  const { ctx, tenant } = await requireNutri('/painel/mensagens');
  const sp = await searchParams;
  const filtro = sp.filtro === 'nao-lidas' ? 'nao-lidas' : 'todas';
  const busca = buscaDaUrl(sp.busca);
  const pagina = paginaDaUrl(sp.pagina);
  const [caixa, contagens] = await Promise.all([caixaDeMensagens(ctx, { filtro, busca, pagina }), contagensDasAbas(ctx, tenant)]);
  const naUrl = filtro === 'nao-lidas' ? 'nao-lidas' : undefined;
  const vazio = filtro === 'nao-lidas' ? C.vazioDoFiltro : busca ? MSG_MENSAGENS.novaConversa.nenhum : C.vazio;
  const pilulas = [
    { valor: 'todas', rotulo: C.filtroTodas, href: comParametros(BASE, { busca }) },
    { valor: 'nao-lidas', rotulo: C.filtroNaoLidas, href: comParametros(BASE, { filtro: 'nao-lidas', busca }) },
  ] as const;
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-semibold">{C.titulo}</h1>
        <BotaoLink href="/painel/mensagens/nova" prefetch={false} data-guia="nova-conversa">
          {C.novaConversa}
        </BotaoLink>
      </div>
      <AbasDeMensagens atual="conversas" contagens={contagens} />
      <div data-guia="mensagens-filtro" className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label={C.rotuloDoFiltro}>
          <ul className="flex flex-wrap gap-1">
            {pilulas.map((p) => (
              <li key={p.valor}>
                <Link href={p.href} prefetch={false} aria-current={filtro === p.valor ? 'page' : undefined} className={classeDoItem(filtro === p.valor)}>
                  {p.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          {naUrl && <input type="hidden" name="filtro" value={naUrl} />}
          <div className="space-y-1">
            <label htmlFor="busca" className="block font-medium">{C.buscarPaciente}</label>
            <input id="busca" name="busca" type="search" defaultValue={busca} maxLength={100} className={CAMPO} />
          </div>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">{C.buscar}</button>
        </form>
      </div>
      {caixa.itens.length === 0 ? <p>{vazio}</p> : <ListaDaCaixa itens={caixa.itens} agora={new Date()} fuso={tenant.fuso} />}
      {caixa.haMais && (
        <p>
          <Link href={comParametros(BASE, { filtro: naUrl, busca, pagina: pagina + 1 })} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
            {C.mostrarMais}
          </Link>
        </p>
      )}
    </main>
  );
}
