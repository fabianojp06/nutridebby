import type { Metadata } from 'next';
import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
import { requireNutri } from '@/lib/tenant-session';
import { pacientesParaNovaConversa } from '@/modules/mensagens/caixa';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { buscaDaUrl, comParametros, paginaDaUrl } from '../lista';

export const dynamic = 'force-dynamic';
/** §7.1: o título da aba do navegador é sempre "Mensagens". */
export const metadata: Metadata = { title: MSG_MENSAGENS.caixa.titulo };

const N = MSG_MENSAGENS.novaConversa;
const BASE = '/painel/mensagens/nova';
const CAMPO = 'min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto';

/**
 * CH-D66 (§4.1): escolher o paciente para abrir a conversa — titulares ativos e não anonimizados, com ou sem conversa, em
 * ordem alfabética do nome de registro, com a busca da lista de pacientes (formulário GET, sem JS), 50 por página com
 * "Mostrar mais". "Sem acesso ao app" para quem não tem conta. Só nome e acesso; sem auditRead (como a lista de pacientes,
 * regra 8). Cada linha é link sem prefetch para a conversa (abrir lê e audita, RN-473).
 */
export default async function NovaConversa({ searchParams }: PageProps<'/painel/mensagens/nova'>) {
  const { ctx } = await requireNutri('/painel/mensagens/nova');
  const sp = await searchParams;
  const busca = buscaDaUrl(sp.busca);
  const pagina = paginaDaUrl(sp.pagina);
  const lista = await pacientesParaNovaConversa(ctx, { busca, pagina });
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">{N.titulo}</h1>
      <form method="get" role="search" data-guia="busca-nova-conversa" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="busca" className="block font-medium">{N.buscarPaciente}</label>
          <input id="busca" name="busca" type="search" defaultValue={busca} maxLength={100} className={CAMPO} />
        </div>
        <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">{N.buscar}</button>
      </form>
      {lista.itens.length === 0 ? (
        <p>{N.nenhum}</p>
      ) : (
        <ul className="divide-y divide-linha overflow-hidden rounded-3xl border border-borda bg-cartao">
          {lista.itens.map((p) => (
            <li key={p.id}>
              <Link
                href={`/painel/mensagens/${p.id}`}
                prefetch={false}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-linha focus-visible:outline-offset-[-3px]"
              >
                <span>{p.nome}</span>
                {!p.temConta && <Selo>{N.semAcessoAoApp}</Selo>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {lista.haMais && (
        <p>
          <Link href={comParametros(BASE, { busca, pagina: pagina + 1 })} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
            {N.mostrarMais}
          </Link>
        </p>
      )}
    </main>
  );
}
