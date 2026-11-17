import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { carregarReferencia } from '@/modules/alimentos/referencias';
import { MSG_REFERENCIAS, nomeDoCampoDaReferencia } from '@/modules/alimentos/referencias-constantes';
import { idValido } from '@/modules/pacientes/base';
import { excluirReferenciaAction, salvarReferenciaAction } from '../actions';
import { ExcluirReferencia, ReferenciaForm } from '../referencia-form';

export const dynamic = 'force-dynamic';

/** Valor gravado como o formulário mostra: vírgula decimal, sem arredondar (é o que a nutricionista digitou). */
const comoDigitado = (n: number | null | undefined) => (typeof n === 'number' ? String(n).replace('.', ',') : '');

/**
 * US-232: `novo` abre o formulário vazio ("Novo perfil"; salvar cria e vai para o id do perfil); um id do consultório
 * abre o perfil para alterar ou excluir. Outro texto, id de outro consultório (RLS) ou perfil excluído → 404.
 */
export default async function ReferenciaPage({ params }: PageProps<'/painel/planos/referencias/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/planos/referencias/${id}`);
  const novo = id === 'novo';
  if (!novo && !idValido(id)) notFound();
  const perfil = novo ? null : await carregarReferencia(ctx, id);
  if (!novo && !perfil) notFound();
  const inicial: Record<string, string> = perfil
    ? {
        nome: perfil.nome,
        fonte: perfil.fonte,
        ...Object.fromEntries(
          Object.entries(perfil.valores).flatMap(([chave, v]) => [
            [nomeDoCampoDaReferencia('meta', chave), comoDigitado(v.meta)],
            [nomeDoCampoDaReferencia('maximo', chave), comoDigitado(v.maximo)],
          ]),
        ),
      }
    : { nome: '', fonte: '' };
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <Link href="/painel/planos/referencias" className="text-sm underline">Voltar aos perfis</Link>
      <h1 className="font-titulo text-2xl font-semibold">{perfil ? perfil.nome : MSG_REFERENCIAS.novo}</h1>
      <ReferenciaForm acao={salvarReferenciaAction.bind(null, perfil ? perfil.id : null)} inicial={inicial} rotuloBotao="Salvar perfil" />
      {perfil && <ExcluirReferencia acao={excluirReferenciaAction.bind(null, perfil.id)} />}
    </main>
  );
}
