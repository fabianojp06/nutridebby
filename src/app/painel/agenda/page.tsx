import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { faixaDaGrade, gradeDoMes, nomeDoMesDoAno, type Visao } from '@/modules/agenda/calendario';
import { MSG_VISOES as M } from '@/modules/agenda/constantes';
import { diaCurto, partesNoFuso } from '@/modules/agenda/fuso';
import { agendaDoPeriodo, hrefDaAgenda, lerFiltros } from '@/modules/agenda/visoes';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { AbasDaAgenda } from './abas';
import { FiltrosDaAgendaForm } from './filtros';
import { GradeDoMes } from './grade-mes';
import { GradeDaSemana } from './grade-semana';
import { ItemConsulta } from './item-consulta';
import { LegendaDaAgenda } from './legenda';

export const dynamic = 'force-dynamic';

const VISOES: Visao[] = ['dia', 'semana', 'mes', 'lista'];
const LINK = 'inline-flex min-h-11 items-center text-link underline';

/**
 * Plano 23 (US-404 a US-406, §4.1, §7): a agenda em Dia e Semana (grade de horas), Mês e Lista, com os filtros na URL
 * (formulário GET, sem JavaScript), a legenda e o link da impressão. Uma transação (`agendaDoPeriodo`), sem leitura
 * auditada (AG-D30). Todos os links passam por `hrefDaAgenda` (I-05).
 */
export default async function AgendaPage({ searchParams }: PageProps<'/painel/agenda'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda');
  const hoje = hojeNoFuso(tenant.fuso);
  const f = lerFiltros(await searchParams, hoje); // teto de datas da agenda: 9999-12-31 → hoje, nunca 500
  const a = await agendaDoPeriodo(ctx, tenant, f);
  const p = a.periodo;
  const rotulo = f.visao === 'dia' ? diaCurto(p.de) : f.visao === 'mes' ? nomeDoMesDoAno(p.de) : `${formatarData(p.de)} a ${formatarData(p.ate)}`;
  const marcadores = { aniversarios: a.aniversarios, retornos: a.retornos };
  const faixa = () => {
    const doPeriodo = a.itens.filter((c) => p.dias.includes(partesNoFuso(c.inicio, tenant.fuso).data));
    const minutos = doPeriodo.map((c) => {
      const ini = partesNoFuso(c.inicio, tenant.fuso);
      const fim = partesNoFuso(c.fim, tenant.fuso);
      return { inicioMin: ini.minutos, fimMin: fim.data === ini.data ? fim.minutos : 0 }; // passa da meia-noite: até 24h
    });
    return faixaDaGrade(a.regras, p.dias, minutos, f.horas24);
  };
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-semibold">Agenda</h1>
        <Link data-guia="nova-consulta" href={`/painel/agenda/nova?data=${f.data}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Nova consulta</Link>
      </div>
      <AbasDaAgenda atual="agenda" />
      <nav aria-label="Período da agenda" data-guia="periodo-agenda" className="flex flex-wrap items-center gap-x-3 text-sm">
        {VISOES.map((v) => (
          <Link key={v} href={hrefDaAgenda({ ...f, visao: v })} aria-current={v === f.visao ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${v === f.visao ? 'font-semibold' : 'text-link underline'}`}>{M.visoes[v]}</Link>
        ))}
        <span aria-hidden="true">·</span>
        <Link href={hrefDaAgenda({ ...f, data: p.anterior })} className={LINK}>{M.anterior}<span className="sr-only">{` (${M.vizinhos[f.visao].anterior})`}</span></Link>
        <Link href={hrefDaAgenda({ ...f, data: hoje })} className={LINK}>{M.hoje}</Link>
        <Link href={hrefDaAgenda({ ...f, data: p.proximo })} className={LINK}>{M.proximo}<span className="sr-only">{` (${M.vizinhos[f.visao].proximo})`}</span></Link>
        <span>{rotulo}</span>
        <Link prefetch={false} href={hrefDaAgenda(f, '/painel/agenda/imprimir')} className={`${LINK} md:ml-auto`}>{M.imprimir}</Link>
      </nav>
      <FiltrosDaAgendaForm f={f} opcoes={a.opcoes} hoje={hoje} />
      {f.visao === 'lista' ? (
        a.itens.length === 0 ? <p>{M.semConsultas}</p> : (
          <ul className="space-y-2">
            {a.itens.map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={false} comData tipo={c.tipoConsulta} selos={c.selos} />)}
          </ul>
        )
      ) : f.visao === 'mes' ? (
        <GradeDoMes
          semanas={gradeDoMes(p.de)}
          mes={p.de.slice(0, 7)}
          caption={nomeDoMesDoAno(p.de)}
          hoje={hoje}
          fuso={tenant.fuso}
          itens={a.itens}
          marcadores={marcadores}
          hrefDoDia={(d) => hrefDaAgenda({ ...f, visao: 'dia', data: d })}
        />
      ) : (
        <GradeDaSemana
          dias={p.dias}
          hoje={hoje}
          fuso={tenant.fuso}
          faixa={faixa()}
          caption={f.visao === 'dia' ? `Agenda de ${diaCurto(p.de)}` : `Agenda de ${rotulo}`}
          itens={a.itens}
          bloqueios={a.bloqueios}
          marcadores={marcadores}
        />
      )}
      <LegendaDaAgenda />
    </main>
  );
}
