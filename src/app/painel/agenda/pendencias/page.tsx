import { requireNutri } from '@/lib/tenant-session';
import { contarPendenciasDePresenca, MSG_PRESENCA, pendenciasDePresenca } from '@/modules/agenda/presenca';
import { AbasDaAgenda } from '../abas';
import { ItemConsulta } from '../item-consulta';

export const dynamic = 'force-dynamic';

/** US-037 "Pendências": consultas que terminaram há mais de 24 h sem "Realizada" nem "Faltou" (D21). */
export default async function PendenciasPage() {
  const { ctx, tenant } = await requireNutri('/painel/agenda/pendencias');
  const agora = new Date();
  const total = await contarPendenciasDePresenca(ctx, agora);
  const lista = await pendenciasDePresenca(ctx, agora);
  return (
    <>
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="font-titulo text-2xl font-semibold">{MSG_PRESENCA.pendencias(total)}</h1>
        <AbasDaAgenda atual="pendencias" />
        {lista.length > 0 && <ul className="space-y-2" aria-label="Consultas sem registro de presença">{lista.map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={false} comData />)}</ul>}
      </main>
    </>
  );
}
