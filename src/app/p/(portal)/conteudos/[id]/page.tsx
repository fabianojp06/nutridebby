import { notFound } from 'next/navigation';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { PlayerVideo } from '@/components/player-video';
import { requirePaciente } from '@/lib/paciente-session';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { MSG_PORTAL_CONTEUDO } from '@/modules/conteudo/constantes';
import { Markdown } from '@/modules/conteudo/markdown';
import { quantidadeDoItem } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { conteudoDoPaciente } from '@/modules/portal/conteudos';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { favoritoAction } from '../actions';
import { MarcarVisto } from '../marcar-visto';

export const dynamic = 'force-dynamic';

const g = (n: number) => formatarDecimal(n, casasDecimais(n));

/** US-050/051/052/055. Fora da audiência, em rascunho ou de outro consultório: 404 (US-053 "acesso direto pela URL"). */
export default async function ConteudoDoPaciente({ params, searchParams }: PageProps<'/p/conteudos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requirePaciente(`/p/conteudos/${id}`);
  // US-054: o cartão "Sugestão de receita" de "Meu plano" abre com ?de=plano — só aí a receita fora da audiência abre
  const doPlano = (await searchParams).de === 'plano';
  const c = await conteudoDoPaciente(ctx, id, undefined, { doPlano });
  if (!c) notFound();
  return (
    <>
      <CabecalhoDetalhe titulo={c.titulo} voltar={c.soPeloPlano ? { href: '/p/plano', secao: 'Plano' } : { href: '/p/conteudos', secao: 'Conteúdos' }} />
      <main className="space-y-4 p-6">
        {/* D14: só pela audiência — quem abre só pelo cartão do plano não registra visualização nem favorita */}
        {!c.soPeloPlano && <MarcarVisto id={c.id} />}
        {!c.soPeloPlano && (
          <form action={favoritoAction.bind(null, c.id, !c.favorito)}>
            <button className="min-h-11 rounded-xl border border-borda bg-cartao px-4">{c.favorito ? MSG_PORTAL_CONTEUDO.desfavoritar : MSG_PORTAL_CONTEUDO.favoritar}</button>
          </form>
        )}
        {c.tipo === 'video' && c.video ? <PlayerVideo video={c.video} titulo={c.titulo} /> : <CapaDoConteudo tipo={c.tipo} capaUrl={c.capaUrl} />}
        {c.resumo && <p>{c.resumo}</p>}
        {c.receita && (
          <>
            <p>{`Rendimento: ${g(c.receita.rendimentoG)} g · Porção: ${g(c.receita.porcaoG)} g`}</p>
            {c.receita.tempoMin && <p>{`Tempo de preparo: ${c.receita.tempoMin} min`}</p>}
            {c.porPorcao && <p className="font-medium">{c.porPorcao}</p>}
            <section aria-labelledby="ingredientes">
              <h2 id="ingredientes" className="font-semibold">
                Ingredientes
              </h2>
              <ul className="ml-5 list-disc">
                {c.receita.ingredientes.map((i, k) => (
                  <li key={k}>
                    {`${i.nome} — ${quantidadeDoItem(i)}`}
                    {/* D11 / RN-02: sem valor na tabela conta 0 na porção — a tela avisa, pela fonte do ingrediente (RN-230) */}
                    {i.porCem.kcal === null && <span className="ml-2 text-sm text-suave">{MSG_PLANO.semValor(i.fonte)}</span>}
                  </li>
                ))}
              </ul>
            </section>
            {/* US-051 "Vídeo opcional": o vídeo aparece acima do modo de preparo */}
            {c.video && <PlayerVideo video={c.video} titulo={c.titulo} />}
            {c.receita.modoPreparo && (
              <section aria-labelledby="modo-preparo" className="space-y-2">
                <h2 id="modo-preparo" className="font-semibold">
                  Modo de preparo
                </h2>
                <Markdown texto={c.receita.modoPreparo} className="space-y-2" />
              </section>
            )}
          </>
        )}
        {c.tipo === 'orientacao' && (
          <Markdown texto={c.corpoMd} className="space-y-3 [&_a]:underline [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc" />
        )}
        {c.temPdf && (
          <a href={`/api/p/conteudos/${c.id}/pdf`} className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4">
            {MSG_PORTAL_CONTEUDO.baixarPdf}
          </a>
        )}
      </main>
    </>
  );
}
