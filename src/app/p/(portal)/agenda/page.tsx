import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { formatarQuando, quandoComFuso } from '@/modules/agenda/fuso';
import { consultasDoPaciente, type ConsultaDoPaciente } from '@/modules/portal/agenda';
import { QuandoLocal } from '../../quando-local';

export const dynamic = 'force-dynamic';

const SITUACAO: Record<string, string> = { agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou' };

export default async function Agenda() {
  const { ctx, tenant } = await requirePaciente('/p/agenda');
  const { proximas, anteriores, podeAgendar } = await consultasDoPaciente(ctx, tenant, new Date());
  const linha = (c: ConsultaDoPaciente) => (
    <li key={c.id}>
      <Link href={`/p/agenda/${c.id}`} className="flex min-h-11 items-center underline">
        <QuandoLocal semFuso={formatarQuando(c.inicio, tenant.fuso)} comFuso={quandoComFuso(c.inicio, tenant.fuso)} fuso={tenant.fuso} />
        {` · ${ROTULO_MODALIDADE[c.modalidade]} · ${SITUACAO[c.status]}`}
      </Link>
    </li>
  );
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Minhas consultas</h1>
      {podeAgendar ? (
        <p><Link href="/p/agenda/nova" className="inline-flex min-h-11 items-center rounded bg-emerald-700 px-4 text-white">Agendar consulta</Link></p>
      ) : (
        <p>{MSG_AGENDA.limitePublico}</p> // T-1: no teto (RN-16) o botão levaria a uma recusa
      )}
      <section aria-labelledby="proximas">
        <h2 id="proximas" className="text-lg font-semibold">Próximas</h2>
        {proximas.length ? <ul>{proximas.map(linha)}</ul> : <p>Nenhuma consulta marcada.</p>}
      </section>
      {anteriores.length > 0 && (
        <section aria-labelledby="anteriores">
          <h2 id="anteriores" className="text-lg font-semibold">Anteriores</h2>
          <ul>{anteriores.map(linha)}</ul>
        </section>
      )}
    </main>
  );
}
