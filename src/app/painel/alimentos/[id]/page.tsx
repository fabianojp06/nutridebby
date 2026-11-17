import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { formatarDecimal } from '@/lib/numero';
import { requireNutri } from '@/lib/tenant-session';
import { carregarAlimento } from '@/modules/alimentos/alimentos';
import { MSG_FONTES, semValorNa, textoDaCitacao } from '@/modules/alimentos/fontes';
import { gramasDaMedidaTexto } from '@/modules/alimentos/medidas-constantes';
import { cadastrarMedidaAction, duplicarAlimentoAction, excluirAlimentoAction, excluirMedidaAction } from '../actions';
import { Selo } from '../busca-alimento';
import { MedidaForm } from '../medida-form';
import { ExcluirAlimento } from './excluir-alimento';

export const dynamic = 'force-dynamic';

export default async function AlimentoPage({ params }: PageProps<'/painel/alimentos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/alimentos/${id}`);
  const a = await carregarAlimento(ctx, id);
  if (!a) notFound();
  const fonte = a.fonte;
  // RN-230: tabela pública (TACO, USDA, TBCA) é só leitura — decide a fonte, nunca o tenant_id
  const publica = fonte !== 'propria' ? fonte : null;
  const valor = (v: number | null, casas: number, unidade: string) => (v === null ? semValorNa(fonte) : `${formatarDecimal(v, casas)} ${unidade}`);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-6 p-4 md:p-6">
        <Link href="/painel/alimentos" className="text-sm underline">Voltar</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-titulo text-2xl font-semibold">{a.nome}</h1>
          <Selo fonte={a.fonte} />
        </div>
        {a.nomeOriginal && <p lang="en" className="text-sm text-suave">{a.nomeOriginal}</p>}
        {fonte === 'usda' && <p className="text-sm text-suave">{MSG_FONTES.traduzido}</p>}
        <p className="text-sm text-suave">{a.grupo}</p>
        <table className="w-full text-left">
          <caption className="sr-only">Valores por 100 g</caption>
          <tbody>
            <tr><th scope="row">Energia</th><td>{valor(a.porCem.kcal, 0, 'kcal')}</td></tr>
            <tr><th scope="row">Proteína</th><td>{valor(a.porCem.proteinaG, 1, 'g')}</td></tr>
            <tr><th scope="row">Carboidrato</th><td>{valor(a.porCem.carboidratoG, 1, 'g')}</td></tr>
            <tr><th scope="row">Lipídio</th><td>{valor(a.porCem.lipidioG, 1, 'g')}</td></tr>
            <tr><th scope="row">Fibra</th><td>{valor(a.porCem.fibraG, 1, 'g')}</td></tr>
          </tbody>
        </table>
        {publica ? (
          <div className="space-y-2">
            <form action={duplicarAlimentoAction.bind(null, a.id)}>
              <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Duplicar como meu alimento</button>
            </form>
            <p className="text-sm text-suave">{textoDaCitacao(publica)}</p>
          </div>
        ) : (
          <div className="flex gap-4">
            <Link href={`/painel/alimentos/${a.id}/editar`} className="text-link underline">Editar</Link>
            <ExcluirAlimento acao={excluirAlimentoAction.bind(null, a.id)} />
          </div>
        )}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Medidas caseiras</h2>
          {a.medidas.length === 0 ? (
            <p>Sem medida caseira: no plano, informe a quantidade em gramas ou cadastre uma medida abaixo.</p>
          ) : (
            <ul className="space-y-1">
              {a.medidas.map((m) => (
                <li key={`${m.origem}-${m.id ?? m.nome}`} className="flex items-center gap-3">
                  <span>{m.nome} — {gramasDaMedidaTexto(m.gramas)}</span>
                  <span className="text-xs text-suave">{m.origem}</span>
                  {m.id && (
                    <form action={excluirMedidaAction.bind(null, a.id, m.id)}>
                      <ConfirmarBotao mensagem={`Excluir a medida "${m.nome}"?`} rotulo={`Excluir a medida ${m.nome}`}>Excluir</ConfirmarBotao>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <MedidaForm acao={cadastrarMedidaAction.bind(null, a.id)} />
        </section>
      </main>
    </>
  );
}
