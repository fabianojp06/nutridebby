import Link from 'next/link';
import { BotaoLink } from '@/components/ui/botao';
import { requireNutri } from '@/lib/tenant-session';
import { listarCatalogo, nomesParaComecarFaltando } from '@/modules/exames/catalogo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { RetornoDaTela } from '../retorno';
import { marcadorDaUrl } from '../valores';
import { ExcluirDoCatalogo } from './excluir-do-catalogo';
import { NomesParaComecar } from './nomes-para-comecar';

export const dynamic = 'force-dynamic';

const C = MSG_EXAMES.catalogo;
const ID_DO_TITULO = 'titulo-catalogo';

/** O retorno das actions (`?ok=`): salvar e excluir levam o foco ao título; "Adicionar ao catálogo" devolve ao botão que abriu. */
function retorno(sp: Record<string, string | string[] | undefined>): { texto: string; focar: boolean } {
  if (sp.ok === 'salvo') return { texto: MSG_EXAMES.exameDoCatalogo.salvo, focar: true };
  if (sp.ok === 'excluido') return { texto: MSG_EXAMES.exameDoCatalogo.excluido, focar: true };
  const n = typeof sp.n === 'string' && /^\d{1,3}$/.test(sp.n) ? Number(sp.n) : null;
  if (sp.ok === 'adicionados' && n !== null && n > 0) return { texto: C.adicionados(n), focar: false };
  return { texto: '', focar: false };
}

/**
 * Plano 22 (T3, US-370, spec §4.1 e §7): o catálogo de exames do consultório — "Exame · Unidade · Faixas · Ação", o painel
 * com "Painel ({n} exames)", o vazio com "Nomes de exames para começar" (o botão fica enquanto houver nome da lista fora
 * do catálogo) e a região `role="status"` sempre montada acima da lista.
 */
export default async function CatalogoPage({ searchParams }: PageProps<'/painel/exames/catalogo'>) {
  const { ctx } = await requireNutri('/painel/exames/catalogo');
  const sp = await searchParams;
  const [lista, faltando] = await Promise.all([listarCatalogo(ctx), nomesParaComecarFaltando(ctx)]);
  const { texto, focar } = retorno(sp);
  const marcador = marcadorDaUrl(sp.r);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
          {C.titulo}
        </h1>
        <div className="flex flex-wrap gap-3">
          {faltando.length > 0 && <NomesParaComecar faltando={faltando.map((n) => ({ nome: n.nome, componentes: n.componentes }))} marcador={marcador} idTitulo={ID_DO_TITULO} />}
          <BotaoLink href="/painel/exames/catalogo/novo" data-guia="novo-exame-catalogo">
            {C.novo}
          </BotaoLink>
        </div>
      </div>
      <RetornoDaTela texto={texto} marcador={marcador} focarTitulo={focar ? ID_DO_TITULO : undefined} />
      {lista.length === 0 ? (
        <p>{C.vazio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{C.titulo}</caption>
            <thead className="text-sm text-suave">
              <tr>
                <th scope="col" className="px-2 py-1">{C.colunas.exame}</th>
                <th scope="col" className="px-2 py-1">{C.colunas.unidade}</th>
                <th scope="col" className="px-2 py-1">{C.colunas.faixas}</th>
                <th scope="col" className="px-2 py-1">{C.colunas.acao}</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="border-t border-linha">
                  <th scope="row" className="px-2 py-1 text-left font-normal">
                    <Link href={`/painel/exames/catalogo/${e.id}`} className="inline-flex min-h-11 items-center text-link underline focus-visible:outline-offset-[-3px]">
                      {e.nome}
                    </Link>
                    {e.componentes.length > 0 && <span className="block text-sm text-suave">{C.painel(e.componentes.length)}</span>}
                  </th>
                  <td className="px-2 py-1">{e.unidade ?? '—'}</td>
                  <td className="px-2 py-1">{e.faixas.length || C.semFaixas}</td>
                  <td className="px-2 py-1">
                    <ExcluirDoCatalogo id={e.id} nome={e.nome} idTitulo={ID_DO_TITULO} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
