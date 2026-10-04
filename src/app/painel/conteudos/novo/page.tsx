import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { opcoesDeAudiencia } from '@/modules/conteudo/audiencia';
import { ehTipoConteudo } from '@/modules/conteudo/constantes';
import { criarConteudoAction } from '../actions';
import { ConteudoForm } from '../conteudo-form';

export const dynamic = 'force-dynamic';

/** Os mesmos textos dos links da lista. */
const TITULO_NOVO = { video: 'Novo vídeo', receita: 'Nova receita', orientacao: 'Nova orientação' } as const;

export default async function NovoConteudo({ searchParams }: PageProps<'/painel/conteudos/novo'>) {
  const { ctx } = await requireNutri('/painel/conteudos/novo');
  const { tipo } = await searchParams;
  if (!ehTipoConteudo(tipo)) notFound();
  const opcoes = await opcoesDeAudiencia(ctx);
  const vazio = { titulo: '', resumo: '', link: '', corpo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <Link href="/painel/conteudos" className="text-sm underline">Voltar aos conteúdos</Link>
        <h1 className="font-titulo text-2xl font-semibold">{TITULO_NOVO[tipo]}</h1>
        <ConteudoForm tipo={tipo} inicial={vazio} opcoes={opcoes} acao={criarConteudoAction.bind(null, tipo)} botao="Criar" />
      </main>
    </>
  );
}
