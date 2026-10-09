import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { daquiA } from '@/modules/portal/datas-portal';
import { rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { MSG_PLANO_PACIENTE, planoDoPaciente, versaoDaCopiaOffline } from '@/modules/portal/plano';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { GuardarPlano } from '../../plano-guardado';
import { molduraDaSecao } from '../../moldura';
import { AbrirRefeicaoDaUrl } from './abrir-refeicao-da-url';
import { RefeicaoDetalhe } from './refeicao-detalhe';

export const dynamic = 'force-dynamic';

/**
 * Plano 16 (US-196, F-Plano): as refeições em sanfona, a próxima aberta e destacada, tudo dentro da página. Sem
 * `respostasDeHoje` aqui: /p/plano é a cópia offline guardada no aparelho e "offline só o plano (sem diário…)" (§4.8, §10,
 * §11.7) — a marca "No diário" fica no mural e na refeição aberta (que não são guardadas); na sanfona o "Comi assim"
 * aparece sempre e, se a refeição já tiver resposta hoje, o toque devolve o registro existente (idempotente).
 */
export default async function MeuPlano({ searchParams }: PageProps<'/p/plano'>) {
  const acesso = await requirePaciente('/p/plano');
  const { ctx, tenant, vinculo } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const plano = await planoDoPaciente(ctx, tenant.fuso);
  const { pdf } = await searchParams;
  const agora = new Date();
  const minutosAgora = partesNoFuso(agora, tenant.fuso).minutos;
  const minutosAte = (horario: string) => {
    const [h, m] = horario.split(':').map(Number);
    const ate = h * 60 + m - minutosAgora;
    return ate >= 0 ? ate : ate + 24 * 60; // a "próxima" depois da última do dia é a primeira de amanhã
  };
  return (
    <>
      <Faixa {...moldura} atual="/p/plano" titulo={MSG_G.titulos.plano} />
      <main className="space-y-6 p-4">
        {/* D6: plano novo = id novo (e US-054: sugestões de receita mudaram = versão nova); o service worker só busca de
            novo se a versão ou o dono mudarem, ou 1 vez por dia */}
        <GuardarPlano dono={vinculo.patientId} versao={versaoDaCopiaOffline(plano)} />
        <AbrirRefeicaoDaUrl />
        {!plano ? (
          <p role="status">{MSG_PLANO_PACIENTE.semPlano}</p>
        ) : (
          <>
            <h2 className="font-portal-titulo text-xl font-bold">{plano.titulo}</h2>
            {plano.totalKcal && <p>{`Total do dia: ${plano.totalKcal}`}</p>}
            {pdf === 'preparando' && <p role="status">{MSG_PLANO_PACIENTE.pdfPreparando}</p>}
            <p className="flex flex-wrap gap-2">
              {plano.pdf !== 'indisponivel' && (
                <a href="/api/p/plano/pdf" className="inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4">Baixar PDF</a>
              )}
              {/* D3 (Plano 07): a lista de compras é derivada do plano publicado; G-D8 ★ = a: os conteúdos também moram aqui */}
              <Link href="/p/compras" className="inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4">Lista de compras</Link>
              <Link href="/p/conteudos" className="inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4">Conteúdos</Link>
            </p>
            <ol className="space-y-3">
              {plano.refeicoes.map((r) => {
                const proxima = r.id === plano.proximaRefeicaoId;
                return (
                  <li key={r.id}>
                    <details id={`ref-${r.id}`} open={proxima} className={proxima ? 'rounded-2xl border-2 border-p-marco bg-cartao ring-2 ring-p-marco-texto' : 'rounded-2xl border border-borda bg-cartao'}>
                      {/* sem flex/grid no summary: ele perde o display: list-item e o marcador ▶/▼ que diz que a refeição abre (molde ajuda-seguranca.tsx); h3 direto no summary (o modelo de conteúdo admite um título) */}
                      <summary className="min-h-11 cursor-pointer p-3">
                        <h3 className="inline font-portal-titulo text-lg font-bold">{rotuloDaRefeicao(r.nome, r.horario)}</h3>
                        {proxima && r.horario && <span className="ml-3 inline-block rounded-full bg-p-marco px-2 text-sm font-semibold text-p-marco-texto">{`Próxima, ${daquiA(minutosAte(r.horario))}`}</span>}
                      </summary>
                      <div className="px-3 pb-3">
                        <RefeicaoDetalhe refeicao={r} respondida={false} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            {plano.orientacoes && (
              <section aria-labelledby="orientacoes-plano" className="rounded-2xl bg-p-clara p-3">
                <h2 id="orientacoes-plano" className="font-semibold">Orientações do plano</h2>
                <p className="whitespace-pre-line wrap-break-word">{plano.orientacoes}</p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
