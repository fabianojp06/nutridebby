import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { listarModelos } from '@/modules/pacientes/anamnese';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { MSG_MODELO_IA } from '@/modules/plano-alimentar/constantes';
import { arquivarModeloAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ModelosPage() {
  const { ctx, tenant } = await requireNutri('/painel/anamnese/modelos');
  const modelos = await listarModelos(ctx);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-titulo text-2xl font-semibold">Modelos de anamnese</h1>
          <Link href="/painel/anamnese/modelos/novo" className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Novo modelo</Link>
        </div>
        <ul className="divide-y divide-linha">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="flex flex-wrap items-baseline gap-2">
                <span>{`${m.nome}${m.padrao ? ' (padrão)' : ''} · ${m.perguntas} ${m.perguntas === 1 ? 'pergunta' : 'perguntas'}`}</span>
                {/* US-123: a origem em texto (não só cor) */}
                {m.sugestaoIa && <span className="rounded-full border border-aviso bg-aviso-fundo px-2 text-sm text-aviso">{MSG_MODELO_IA.marca}</span>}
                {m.aprovadoEm && <span className="text-sm text-suave">{MSG_MODELO_IA.aprovadoEm(formatarDataNoFuso(m.aprovadoEm, tenant.fuso))}</span>}
              </span>
              <span className="flex gap-4">
                <Link href={`/painel/anamnese/modelos/${m.id}`} className="text-link underline" aria-label={`Editar o modelo ${m.nome}`}>Editar</Link>
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
