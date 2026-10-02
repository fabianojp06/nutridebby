import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { listarAgenda } from '@/modules/agenda/consultas';
import { listarBloqueios } from '@/modules/agenda/disponibilidade';
import { diaCurto, inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { sobrepoe } from '@/modules/agenda/horarios';
import { dataValida, formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { Cabecalho } from '../cabecalho';
import { ItemConsulta } from './item-consulta';
import { lerVisao, periodoDaVisao, type Visao } from './periodo';

export const dynamic = 'force-dynamic';

const VISOES: [Visao, string][] = [['dia', 'Dia'], ['semana', 'Semana'], ['lista', 'Lista']];

export default async function AgendaPage({ searchParams }: PageProps<'/painel/agenda'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda');
  const sp = await searchParams;
  const visao = lerVisao(sp.visao);
  const hoje = hojeNoFuso(tenant.fuso);
  const data = typeof sp.data === 'string' && dataValida(sp.data) ? sp.data : hoje;
  const p = periodoDaVisao(visao, data);
  const de = inicioDoDia(p.dias[0], tenant.fuso);
  const ate = inicioDoDia(somarDias(p.dias.at(-1)!, 1), tenant.fuso);
  const [consultas, bloqueios] = await Promise.all([listarAgenda(ctx, de, ate), listarBloqueios(ctx, de, ate)]);
  const emBloqueio = (c: (typeof consultas)[number]) => bloqueios.some((b) => sobrepoe(b, c));
  const doDia = (dia: string) => consultas.filter((c) => partesNoFuso(c.inicio, tenant.fuso).data === dia);
  const href = (v: Visao, d: string) => `/painel/agenda?visao=${v}&data=${d}`;
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <div className="flex gap-3 text-sm">
            <Link href="/painel/agenda/horarios" className="underline">Horários de atendimento</Link>
            <Link href={`/painel/agenda/nova?data=${data}`} className="rounded bg-emerald-700 px-3 py-1.5 text-white">Nova consulta</Link>
          </div>
        </div>
        <nav aria-label="Período da agenda" className="flex flex-wrap items-center gap-3 text-sm">
          {VISOES.map(([v, r]) => <Link key={v} href={href(v, data)} aria-current={v === visao ? 'page' : undefined} className={v === visao ? 'font-semibold' : 'underline'}>{r}</Link>)}
          <span aria-hidden="true">·</span>
          <Link href={href(visao, hoje)} className="underline">Hoje</Link>
          <Link href={href(visao, p.anterior)} className="underline">Anterior</Link>
          <Link href={href(visao, p.proximo)} className="underline">Próximo</Link>
          <span>{visao === 'dia' ? diaCurto(data) : `${formatarData(p.dias[0])} a ${formatarData(p.dias.at(-1)!)}`}</span>
        </nav>
        {visao === 'lista' ? (
          consultas.length === 0 ? <p>Nenhuma consulta neste período.</p> : (
            <ul className="space-y-2">
              {consultas.map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={emBloqueio(c)} />)}
            </ul>
          )
        ) : (
          <div className={`grid gap-3 ${visao === 'semana' ? 'md:grid-cols-7' : ''}`}>
            {p.dias.map((dia) => (
              <section key={dia} aria-labelledby={`dia-${dia}`} className="space-y-2">
                <h2 id={`dia-${dia}`} className={`text-sm font-semibold ${dia === hoje ? 'text-emerald-800' : ''}`}>{diaCurto(dia)}{dia === hoje ? ' (hoje)' : ''}</h2>
                {bloqueios.filter((b) => sobrepoe(b, { inicio: inicioDoDia(dia, tenant.fuso), fim: inicioDoDia(somarDias(dia, 1), tenant.fuso) })).map((b) => (
                  <p key={b.id} className="rounded bg-amber-50 p-2 text-sm text-amber-900">{b.motivo ? `Bloqueado: ${b.motivo}` : 'Bloqueado'}</p>
                ))}
                <ul className="space-y-2">
                  {doDia(dia).map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={emBloqueio(c)} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
