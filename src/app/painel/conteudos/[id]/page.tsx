import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { PlayerVideo } from '@/components/player-video';
import { requireNutri } from '@/lib/tenant-session';
import { opcoesDeAudiencia } from '@/modules/conteudo/audiencia';
import { MSG_CONTEUDO, ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { carregarConteudoDoPainel } from '@/modules/conteudo/conteudos';
import { carregarReceitaDoPainel } from '@/modules/conteudo/receitas';
import { excluirConteudoAction, salvarConteudoAction } from '../actions';
import { ArquivosDoConteudo } from '../arquivos';
import { ConteudoForm } from '../conteudo-form';
import { PublicarForm } from '../publicar-form';
import { ReceitaForm } from './receita-form';

export const dynamic = 'force-dynamic';

export default async function ConteudoPage({ params, searchParams }: PageProps<'/painel/conteudos/[id]'>) {
  const { id } = await params;
  const { ocupado } = await searchParams;
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  const c = await carregarConteudoDoPainel(ctx, id);
  if (!c) notFound();
  const opcoes = await opcoesDeAudiencia(ctx);
  const inicial = {
    titulo: c.titulo,
    resumo: c.resumo,
    link: c.link,
    corpo: c.corpoMd,
    etiquetas: c.etiquetas.join(', '),
    visibilidade: c.visibilidade,
    pacientes: c.audiencia.pacientes,
    tags: c.audiencia.etiquetas,
  };
  return (
    <>
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <Link href="/painel/conteudos" className="text-sm underline">Voltar aos conteúdos</Link>
        <h1 className="text-2xl font-semibold">{c.titulo}</h1>
        <p>{`${ROTULO_TIPO_CONTEUDO[c.tipo]} · ${c.status === 'publicado' ? 'Publicado' : 'Rascunho'}`}</p>
        {c.tipo === 'video' && <CapaDoConteudo tipo={c.tipo} capaUrl={c.capaUrl} className="max-w-xs" />}
        {c.video && <PlayerVideo video={c.video} titulo={c.titulo} />}
        <ConteudoForm tipo={c.tipo} inicial={inicial} opcoes={opcoes} acao={salvarConteudoAction.bind(null, c.id)} botao="Salvar" />
        {c.tipo === 'receita' && <ReceitaForm id={c.id} inicial={await carregarReceitaDoPainel(ctx, c.id)} />}
        {c.tipo !== 'video' && <ArquivosDoConteudo id={c.id} tipo={c.tipo} capaUrl={c.capaUrl} pdfUrl={c.pdfUrl} />}
        <PublicarForm id={c.id} publicado={c.status === 'publicado'} />
        {c.status === 'publicado' && <Link href={`/painel/conteudos/${c.id}/visualizacoes`} className="underline">Ver quem viu</Link>}
        {ocupado === '1' && <p role="alert" className="text-red-700">{MSG_CONTEUDO.ocupado}</p>}
        <form action={excluirConteudoAction.bind(null, c.id)}>
          <ConfirmarBotao mensagem="Excluir este conteúdo? A sugestão de receita sai dos planos.">Excluir conteúdo</ConfirmarBotao>
        </form>
      </main>
    </>
  );
}
