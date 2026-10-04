import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { ehTipoConteudo, FILTROS_DO_FEED, MSG_CONTEUDO, ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { listarConteudosDoPainel } from '@/modules/conteudo/conteudos';
import { metricasDosConteudos, textoDaMetrica } from '@/modules/conteudo/metricas';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { Cabecalho } from '../cabecalho';

export const dynamic = 'force-dynamic';

export default async function Conteudos({ searchParams }: PageProps<'/painel/conteudos'>) {
  const { ctx, tenant } = await requireNutri('/painel/conteudos');
  const { tipo, excluido } = await searchParams;
  const filtro = ehTipoConteudo(tipo) ? tipo : undefined;
  const lista = await listarConteudosDoPainel(ctx, { tipo: filtro });
  const metricas = await metricasDosConteudos(ctx, lista.filter((c) => c.status === 'publicado'));
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Conteúdos</h1>
        {excluido === '1' && <p role="status">{MSG_CONTEUDO.excluido}</p>}
        <div className="flex flex-wrap gap-3">
          <Link href="/painel/conteudos/novo?tipo=video" className="rounded border px-3 py-1">Novo vídeo</Link>
          <Link href="/painel/conteudos/novo?tipo=receita" className="rounded border px-3 py-1">Nova receita</Link>
          <Link href="/painel/conteudos/novo?tipo=orientacao" className="rounded border px-3 py-1">Nova orientação</Link>
        </div>
        <nav aria-label="Filtrar conteúdos" className="flex gap-3 text-sm">
          <Link href="/painel/conteudos" aria-current={!filtro ? 'page' : undefined} className="aria-[current=page]:font-semibold">Todos</Link>
          {FILTROS_DO_FEED.map((f) => (
            <Link key={f.tipo} href={`/painel/conteudos?tipo=${f.tipo}`} aria-current={filtro === f.tipo ? 'page' : undefined} className="aria-[current=page]:font-semibold">{f.rotulo}</Link>
          ))}
        </nav>
        {lista.length === 0 ? (
          <p>Nenhum conteúdo ainda.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Tipo</th>
                <th scope="col">Situação</th>
                <th scope="col">Visualizações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2"><Link href={`/painel/conteudos/${c.id}`} className="underline">{c.titulo}</Link></td>
                  <td>{ROTULO_TIPO_CONTEUDO[c.tipo]}</td>
                  <td>{c.status === 'publicado' && c.publicadoEm ? `Publicado em ${formatarDataNoFuso(c.publicadoEm, tenant.fuso)}` : 'Rascunho'}</td>
                  <td>
                    {metricas.get(c.id) ? (
                      <Link href={`/painel/conteudos/${c.id}/visualizacoes`} className="underline" aria-label={`Ver quem viu: ${c.titulo}`}>
                        {textoDaMetrica(metricas.get(c.id)!)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
