import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_PLANO_PACIENTE, planoDoPaciente, versaoDaCopiaOffline } from '@/modules/portal/plano';
import { GuardarPlano } from '../../plano-guardado';

export const dynamic = 'force-dynamic';

export default async function MeuPlano({ searchParams }: PageProps<'/p/plano'>) {
  const { ctx, tenant, vinculo } = await requirePaciente('/p/plano');
  const plano = await planoDoPaciente(ctx, tenant.fuso);
  const { pdf } = await searchParams;
  return (
    <main className="space-y-6 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Plano</h1>
      {/* D6: plano novo = id novo (e US-054: sugestões de receita mudaram = versão nova); o service worker só busca de
          novo se a versão ou o dono mudarem, ou 1 vez por dia */}
      <GuardarPlano dono={vinculo.patientId} versao={versaoDaCopiaOffline(plano)} />
      {!plano ? (
        <p role="status">{MSG_PLANO_PACIENTE.semPlano}</p>
      ) : (
        <>
          <h2 className="text-lg">{plano.titulo}</h2>
          {plano.totalKcal && <p>{`Total do dia: ${plano.totalKcal}`}</p>}
          {pdf === 'preparando' && <p role="status">{MSG_PLANO_PACIENTE.pdfPreparando}</p>}
          {plano.pdf !== 'indisponivel' && (
            <a href="/api/p/plano/pdf" className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4">Baixar PDF</a>
          )}
          {/* D3 (Plano 07): a lista de compras saiu da barra de abas; é derivada do plano publicado */}
          <Link href="/p/compras" className="ml-4 inline-flex min-h-11 items-center underline">Lista de compras</Link>
          <ol className="space-y-4">
            {plano.refeicoes.map((r) => {
              const proxima = r.id === plano.proximaRefeicaoId;
              return (
                <li key={r.id} aria-labelledby={`ref-${r.id}`} className={proxima ? 'rounded-xl border-2 border-marca bg-cartao p-3' : 'rounded-xl border border-borda bg-cartao p-3'}>
                  <h3 id={`ref-${r.id}`} className="font-semibold">
                    {`${r.nome} · ${r.horario}`}
                    {proxima && <span className="ml-2 rounded-full bg-ok-fundo px-2 text-sm font-semibold text-ok">Próxima refeição</span>}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {r.itens.map((i) => (
                      <li key={i.id}>
                        {i.substituicoes.length ? (
                          <details>
                            {/* WCAG 2.5.3: o nome acessível começa pelo texto visível; o "ver substituições" vai só para o leitor de tela */}
                            <summary className="min-h-11 cursor-pointer">
                              {`${i.nome} — ${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}
                              <span className="sr-only"> (ver substituições)</span>
                            </summary>
                            <p className="mt-1 text-sm font-medium">Substituições</p>
                            <ul className="ml-4 list-disc text-sm">
                              {i.substituicoes.map((s) => <li key={s.id}>{`${s.nome} — ${s.quantidade}${s.kcal ? ` · ${s.kcal}` : ''}`}</li>)}
                            </ul>
                          </details>
                        ) : (
                          <span>{`${i.nome} — ${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {r.observacao && <p className="mt-2 text-sm italic">{r.observacao}</p>}
                  {r.receita && (
                    <p className="mt-2 rounded bg-ok-fundo p-2 text-sm">
                      <span className="font-semibold">Sugestão de receita: </span>
                      {/* ?de=plano: a receita fora da audiência só abre por aqui (RN-12, exceção — D2) */}
                      <Link href={`/p/conteudos/${r.receita.id}?de=plano`} className="underline">{r.receita.titulo}</Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {plano.orientacoes && (
            <section aria-labelledby="orientacoes-plano">
              <h2 id="orientacoes-plano" className="font-semibold">Orientações</h2>
              <p className="whitespace-pre-line">{plano.orientacoes}</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
