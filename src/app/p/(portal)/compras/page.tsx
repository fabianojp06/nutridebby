import { requirePaciente } from '@/lib/paciente-session';
import { DIAS_PADRAO, lerDias, listaDoPlano, MSG_COMPRAS } from '@/modules/portal/lista-compras';
import { ListaCompras } from './lista-compras';

export const dynamic = 'force-dynamic';

export default async function Compras({ searchParams }: PageProps<'/p/compras'>) {
  const { ctx } = await requirePaciente('/p/compras');
  const pedido = (await searchParams).dias;
  const dias = lerDias(typeof pedido === 'string' ? pedido : undefined);
  const lista = dias ? await listaDoPlano(ctx, dias) : null;
  return (
    <main className="space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Lista de compras</h1>
      <form method="get" className="flex items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="dias" className="block font-medium">Para quantos dias?</label>
          <input id="dias" name="dias" type="number" min={1} max={14} inputMode="numeric" defaultValue={dias ?? DIAS_PADRAO} aria-invalid={dias === null ? true : undefined} aria-describedby={dias === null ? 'dias-erro' : undefined} className="min-h-11 w-24 rounded-xl border border-campo bg-cartao text-texto p-2" />
        </div>
        <button className="min-h-11 rounded-xl border border-borda bg-cartao px-4">Gerar lista</button>
      </form>
      {dias === null && <p id="dias-erro" role="alert" className="text-erro">{MSG_COMPRAS.dias}</p>}
      {dias !== null && !lista && <p role="status">{MSG_COMPRAS.semPlano}</p>}
      {lista && <ListaCompras planoId={lista.planoId} grupos={lista.grupos} />}
    </main>
  );
}
