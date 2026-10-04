import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { criarAlimentoAction } from '../actions';
import { AlimentoForm } from '../alimento-form';

export const dynamic = 'force-dynamic';

export default async function NovoAlimentoPage() {
  await requireNutri('/painel/alimentos/novo');
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <Link href="/painel/alimentos" className="text-sm underline">Voltar</Link>
        <h1 className="font-titulo text-2xl font-semibold">Cadastrar meu alimento</h1>
        <AlimentoForm acao={criarAlimentoAction} inicial={{ nome: '', grupo: '', kcal: '', proteinaG: '', carboidratoG: '', lipidioG: '', fibraG: '' }} rotuloBotao="Salvar alimento" />
      </main>
    </>
  );
}
