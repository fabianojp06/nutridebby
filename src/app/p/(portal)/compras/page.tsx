import { requirePaciente } from '@/lib/paciente-session';
import { DIAS_PADRAO, lerDias, listaDoPlano, MSG_COMPRAS } from '@/modules/portal/lista-compras';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { ListaCompras } from './lista-compras';

export const dynamic = 'force-dynamic';

export default async function Compras({ searchParams }: PageProps<'/p/compras'>) {
  const { ctx, tenant } = await requirePaciente('/p/compras');
  const pedido = (await searchParams).dias;
  const dias = lerDias(typeof pedido === 'string' ? pedido : undefined);
  // RN-248: a janela começa hoje, no fuso do consultório
  const lista = dias ? await listaDoPlano(ctx, tenant.fuso, dias) : null;
  return (
    <>
      <CabecalhoDetalhe titulo="Lista de compras" voltar={{ href: '/p/plano', secao: 'Plano' }} />
      <main className="space-y-4 p-6">
        <form method="get" className="flex items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="dias" className="block font-medium">Para quantos dias?</label>
            <input id="dias" name="dias" type="number" min={1} max={14} inputMode="numeric" defaultValue={dias ?? DIAS_PADRAO} aria-invalid={dias === null ? true : undefined} aria-describedby={dias === null ? 'dias-erro' : undefined} className="min-h-11 w-24 rounded-xl border border-campo bg-cartao text-texto p-2" />
          </div>
          <button className="min-h-11 rounded-xl border border-borda bg-cartao px-4">Gerar lista</button>
        </form>
        {dias === null && <p id="dias-erro" role="alert" className="text-erro">{MSG_COMPRAS.dias}</p>}
        {dias !== null && !lista && <p role="status">{MSG_COMPRAS.semPlano}</p>}
        {lista?.semAlimentos && <p role="status">{MSG_COMPRAS.semAlimentos}</p>}
        {lista && !lista.semAlimentos && (lista.grupos.length === 0 ? <p role="status">{MSG_COMPRAS.semRefeicaoNosDias}</p> : <ListaCompras planoId={lista.planoId} grupos={lista.grupos} />)}
        {lista?.textoLivreFora && <p className="text-sm text-suave">{MSG_COMPRAS.textoLivreFora}</p>}
      </main>
    </>
  );
}
