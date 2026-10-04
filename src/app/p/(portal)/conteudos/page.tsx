import Link from 'next/link';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { requirePaciente } from '@/lib/paciente-session';
import { ehTipoConteudo, FILTROS_DO_FEED, ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { feedDeConteudos, mensagemDoFeedVazio } from '@/modules/portal/conteudos';

export const dynamic = 'force-dynamic';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** US-055: feed, filtros "Vídeos / Receitas / Orientações", "Favoritos", busca e etiqueta do conteúdo. */
export default async function Conteudos({ searchParams }: PageProps<'/p/conteudos'>) {
  const { ctx } = await requirePaciente('/p/conteudos');
  const q = await searchParams;
  const t = um(q.tipo);
  const tipo = ehTipoConteudo(t) ? t : undefined;
  const busca = (um(q.busca) ?? '').slice(0, 100);
  const etiqueta = um(q.etiqueta) || undefined;
  const favoritos = um(q.favoritos) === '1';
  const { itens, etiquetas } = await feedDeConteudos(ctx, { tipo, busca, etiqueta, favoritos });
  const vazio = mensagemDoFeedVazio({ tipo, busca, etiqueta, favoritos });
  const aba = (href: string, rotulo: string, atual: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={atual ? 'page' : undefined}
      className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-3 aria-[current=page]:bg-destaque aria-[current=page]:text-white"
    >
      {rotulo}
    </Link>
  );
  return (
    <main className="space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Conteúdos</h1>
      <nav aria-label="Filtrar conteúdos" className="flex flex-wrap gap-2">
        {aba('/p/conteudos', 'Todos', !tipo && !favoritos)}
        {FILTROS_DO_FEED.map((f) => aba(`/p/conteudos?tipo=${f.tipo}`, f.rotulo, tipo === f.tipo && !favoritos))}
        {aba('/p/conteudos?favoritos=1', 'Favoritos', favoritos)}
      </nav>
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        {favoritos && <input type="hidden" name="favoritos" value="1" />}
        <div className="space-y-1">
          <label htmlFor="busca" className="block text-sm">
            Buscar
          </label>
          <input id="busca" name="busca" type="search" defaultValue={busca} maxLength={100} className="min-h-11 rounded-xl border border-campo bg-cartao text-texto px-2" />
        </div>
        {etiquetas.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="etiqueta" className="block text-sm">
              Etiqueta
            </label>
            <select id="etiqueta" name="etiqueta" defaultValue={etiqueta ?? ''} className="min-h-11 rounded-xl border border-campo bg-cartao text-texto px-2">
              <option value="">Todas</option>
              {etiquetas.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className="min-h-11 rounded-xl border border-borda bg-cartao px-4">Buscar</button>
      </form>
      {itens.length === 0 ? (
        <p role="status">{vazio}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {itens.map((c) => (
            <li key={c.id}>
              <Link href={`/p/conteudos/${c.id}`} className="block space-y-2 rounded-xl border border-borda bg-cartao p-3">
                <CapaDoConteudo tipo={c.tipo} capaUrl={c.capaUrl} />
                <p className="text-sm text-suave">
                  {ROTULO_TIPO_CONTEUDO[c.tipo]}
                  {c.novo && <span className="ml-2 rounded bg-aviso-fundo px-2 font-semibold text-aviso">Novo</span>}
                </p>
                <h2 className="font-semibold">{c.titulo}</h2>
                {c.resumo && <p className="text-sm">{c.resumo}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
