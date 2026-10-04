import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { listarModelos } from '@/modules/pacientes/anamnese';
import { arquivarModeloAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ModelosPage() {
  const { ctx } = await requireNutri('/painel/anamnese/modelos');
  const modelos = await listarModelos(ctx);
  return (
    <>
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Modelos de anamnese</h1>
          <Link href="/painel/anamnese/modelos/novo" className="rounded bg-emerald-700 px-4 py-2 text-white">Novo modelo</Link>
        </div>
        <ul className="divide-y">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>{`${m.nome}${m.padrao ? ' (padrão)' : ''} · ${m.perguntas} ${m.perguntas === 1 ? 'pergunta' : 'perguntas'}`}</span>
              <span className="flex gap-4">
                <Link href={`/painel/anamnese/modelos/${m.id}`} className="underline" aria-label={`Editar o modelo ${m.nome}`}>Editar</Link>
                <form action={arquivarModeloAction.bind(null, m.id)}>
                  <ConfirmarBotao mensagem="Arquivar este modelo? As anamneses já preenchidas não mudam." rotulo={`Arquivar o modelo ${m.nome}`}>Arquivar</ConfirmarBotao>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
