import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { Botao, BotaoLink } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import { requireUser } from '@/lib/session';
import { listarContas, resumoDasContas, type ContaResumo } from '@/modules/plataforma/contas';
import { metricasPorTenant, type MetricasTenant } from '@/modules/plataforma/metricas';
import { MSG_CONTA_NAO_ENCONTRADA } from '@/modules/plataforma/tenant-status';
import { Convite } from './convite';
import { ResumoDoServidor } from './painel-infra';

export const dynamic = 'force-dynamic';

/** P16-17: na lista, só os avisos da criação e da conta que não existe; os das ações de uma conta ficam na página dela. */
const AVISOS: Record<string, { texto: string; erro?: boolean }> = {
  criada: { texto: 'Conta criada. O convite foi enviado para o e-mail da nutricionista.' },
  nao_encontrada: { texto: MSG_CONTA_NAO_ENCONTRADA, erro: true },
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const situacao = (c: ContaResumo) => (c.status === 'ativa' ? 'Ativa' : 'Suspensa');

/** "Abrir" com nome acessível único por conta (M22: o texto visível é o mesmo em toda linha). */
function Abrir({ c }: { c: ContaResumo }) {
  return (
    <BotaoLink href={`/admin/contas/${c.tenantId}`} variante="secundario">
      Abrir<span className="sr-only">{` a conta ${c.nomeExibicao}`}</span>
    </BotaoLink>
  );
}

function NomeDaConta({ c }: { c: ContaResumo }) {
  return (
    <>
      <span className="font-semibold">{c.nomeExibicao}</span> <span className="text-suave">({c.slug})</span>
      <span className="block break-all text-sm text-suave">{c.email ?? '—'}</span>
    </>
  );
}

/**
 * P16-17: lista enxuta das contas (6 colunas; no celular, cartões) — cotas, liberações, métricas e as ações de cada conta
 * ficam na página da conta; o servidor e a verificação em duas etapas, nas próprias abas. Mesma fonte de dados de antes.
 */
export default async function AdminHome({ searchParams }: PageProps<'/admin'>) {
  const { user } = await requireUser(['admin'], '/admin');
  const { aviso, busca, depois, antes } = await searchParams;
  const a = typeof aviso === 'string' ? AVISOS[aviso] : undefined;
  // D-P5: as métricas continuam vindo de todos os consultórios (função SECURITY DEFINER sem parâmetro); a página só desenha os 50 dela.
  // O resumo conta todas as contas (R19 do pre-flight), não só as da página ou da busca.
  const [pagina, metricas, resumo] = await Promise.all([listarContas(undefined, undefined, { busca, depois, antes }), metricasPorTenant(), resumoDasContas()]);
  const contas = pagina.contas;
  const m = (c: ContaResumo): MetricasTenant | undefined => metricas.get(c.tenantId);
  const linkDaPagina = (c: { depois?: string; antes?: string }) => {
    const q = new URLSearchParams();
    if (pagina.busca) q.set('busca', pagina.busca);
    if (c.depois) q.set('depois', c.depois);
    if (c.antes) q.set('antes', c.antes);
    return `/admin?${q.toString()}`;
  };
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-semibold">Contas</h1>
          <p className="text-sm text-suave">Conectado como {user.email}.</p>
        </div>
        <BotaoLink href="/admin/contas/nova">Nova conta</BotaoLink>
      </header>
      {a && <Aviso tipo={a.erro ? 'erro' : 'ok'}>{a.texto}</Aviso>}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl border border-borda bg-cartao px-4 py-2">
        <p className="text-sm font-medium">
          {`${plural(resumo.ativas, 'ativa', 'ativas')} · ${plural(resumo.suspensas, 'suspensa', 'suspensas')} · ${plural(resumo.convitesPendentes, 'convite pendente', 'convites pendentes')}`}
        </p>
        <ResumoDoServidor />
      </div>
      {/* P09-07: busca e páginas da lista (GET: a busca não é dado de saúde; GET_PERMITIDOS) */}
      <form method="get" action="/admin" role="search" className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="busca" className="block text-sm font-medium">Buscar por nome, endereço ou e-mail</label>
          <input id="busca" name="busca" type="search" maxLength={100} defaultValue={pagina.busca} className="min-h-11 w-72 max-w-full rounded-xl border border-campo bg-cartao px-3" />
        </div>
        <Botao variante="secundario">Buscar</Botao>
        {pagina.busca && <Link href="/admin" className="inline-flex min-h-11 items-center text-link underline">Limpar busca</Link>}
      </form>
      {contas.length === 0 && <p>Nenhuma conta encontrada.</p>}
      {contas.length > 0 && (
        <>
          {/* a partir de 640 px: a tabela; no celular, a mesma informação em cartões (sem rolagem horizontal da página) */}
          <div className="hidden overflow-x-auto rounded-3xl border border-borda bg-cartao sm:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Contas de nutricionista</caption>
              <thead className="border-b border-borda text-suave">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Conta</th>
                  <th scope="col" className="px-4 py-3 font-medium">Situação</th>
                  <th scope="col" className="px-4 py-3 font-medium">Convite</th>
                  <th scope="col" className="px-4 py-3 font-medium">Pacientes ativos</th>
                  <th scope="col" className="px-4 py-3 font-medium">Consultas no mês</th>
                  <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {contas.map((c) => (
                  <tr key={c.tenantId} className="border-t border-borda first:border-t-0">
                    <th scope="row" className="px-4 py-3 font-normal"><NomeDaConta c={c} /></th>
                    <td className="px-4 py-3"><Selo>{situacao(c)}</Selo></td>
                    <td className="px-4 py-3"><Convite c={c} /></td>
                    <td className="px-4 py-3">{m(c)?.pacientesAtivos ?? '—'}</td>
                    <td className="px-4 py-3">{m(c)?.consultasMes ?? '—'}</td>
                    <td className="px-4 py-3 text-right"><Abrir c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul aria-label="Contas de nutricionista" className="space-y-3 sm:hidden">
            {contas.map((c) => (
              <li key={c.tenantId} className="rounded-3xl border border-borda bg-cartao p-4">
                <p><NomeDaConta c={c} /></p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div><dt className="text-suave">Situação</dt><dd><Selo>{situacao(c)}</Selo></dd></div>
                  <div><dt className="text-suave">Convite</dt><dd><Convite c={c} /></dd></div>
                  <div><dt className="text-suave">Pacientes ativos</dt><dd>{m(c)?.pacientesAtivos ?? '—'}</dd></div>
                  <div><dt className="text-suave">Consultas no mês</dt><dd>{m(c)?.consultasMes ?? '—'}</dd></div>
                </dl>
                <div className="mt-3"><Abrir c={c} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
      {(pagina.anterior || pagina.proxima) && (
        <nav aria-label="Páginas da lista de contas" className="flex gap-4">
          {pagina.anterior && <Link href={linkDaPagina({ antes: pagina.anterior })} className="inline-flex min-h-11 items-center text-link underline">Anterior</Link>}
          {pagina.proxima && <Link href={linkDaPagina({ depois: pagina.proxima })} className="inline-flex min-h-11 items-center text-link underline">Próxima</Link>}
        </nav>
      )}
    </main>
  );
}
