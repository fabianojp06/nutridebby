import Link from 'next/link';
import { MSG_VISOES as M } from '@/modules/agenda/constantes';
import { diaCurto, partesNoFuso } from '@/modules/agenda/fuso';
import type { ItemDaAgenda, Marcador } from '@/modules/agenda/visoes';
import { MARCA } from './legenda';

/**
 * Plano 23 (US-404, RN-413, spec §7): o Mês. A partir de 768 px, `table` de segunda a domingo com `caption` "{mês} de
 * {ano}"; cada dia do mês tem o link para a visão Dia, "{n} consultas", até 3 nomes e "mais {n}", e os marcadores ligados.
 * Abaixo de 768 px, lista dos dias com consulta ou marcador (`h2` por dia). Canceladas já vêm fora (RN-413).
 */
type Props = {
  semanas: string[][];
  /** 'AAAA-MM' do mês mostrado (os dias de fora completam a primeira e a última semana, vazios). */
  mes: string;
  caption: string;
  hoje: string;
  fuso: string;
  itens: ItemDaAgenda[];
  marcadores: { aniversarios: Marcador[]; retornos: Marcador[] };
  hrefDoDia: (dia: string) => string;
};

const DIAS_DA_SEMANA: [string, string][] = [
  ['seg.', 'segunda-feira'], ['ter.', 'terça-feira'], ['qua.', 'quarta-feira'], ['qui.', 'quinta-feira'], ['sex.', 'sexta-feira'], ['sáb.', 'sábado'], ['dom.', 'domingo'],
];
const MAX_NOMES = 3;

export function GradeDoMes({ semanas, mes, caption, hoje, fuso, itens, marcadores, hrefDoDia }: Props) {
  const doDia = (dia: string) => itens.filter((c) => partesNoFuso(c.inicio, fuso).data === dia);
  const marcadoresDoDia = (dia: string) => [
    ...marcadores.retornos.filter((m) => m.data === dia).map((m) => ({ chave: `r-${m.patientId}`, texto: M.marcadorRetorno(m.nome), marca: MARCA.retornoPrevisto })),
    ...marcadores.aniversarios.filter((m) => m.data === dia).map((m) => ({ chave: `a-${m.patientId}`, texto: M.marcadorAniversario(m.nome), marca: MARCA.aniversario })),
  ];
  const diasDoMes = semanas.flat().filter((d) => d.startsWith(mes));
  const comConteudo = diasDoMes.filter((d) => doDia(d).length > 0 || marcadoresDoDia(d).length > 0);
  const nomeDoDia = (d: string) => `${Number(d.slice(8))}`;
  return (
    <>
      <table data-testid="agenda-mes" className="hidden w-full table-fixed border-collapse text-sm break-words md:table">
        <caption className="mb-2 text-left font-semibold">{caption}</caption>
        <thead>
          <tr>
            {DIAS_DA_SEMANA.map(([curto, longo]) => (
              <th key={curto} scope="col" className="border-b border-borda p-1 text-left">
                <abbr title={longo} className="no-underline">{curto}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((s) => (
            <tr key={s[0]}>
              {s.map((d) => {
                if (!d.startsWith(mes)) return <td key={d} className="h-24 border border-borda bg-fundo" />;
                const cs = doDia(d);
                const ms = marcadoresDoDia(d);
                return (
                  <td key={d} className="h-24 border border-borda p-1 align-top">
                    <Link href={hrefDoDia(d)} className={`inline-flex min-h-6 min-w-6 items-center font-semibold text-link underline ${d === hoje ? 'text-ok' : ''}`}>
                      {nomeDoDia(d)}
                      <span className="sr-only">{` ${diaCurto(d)}`}</span>
                    </Link>
                    {cs.length > 0 && (
                      <>
                        <p>{M.consultas(cs.length)}</p>
                        <ul className="text-suave">
                          {cs.slice(0, MAX_NOMES).map((c) => <li key={c.id} className="truncate">{c.paciente}</li>)}
                        </ul>
                        {cs.length > MAX_NOMES && <p className="text-suave">{M.mais(cs.length - MAX_NOMES)}</p>}
                      </>
                    )}
                    {ms.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {ms.map((m) => <li key={m.chave} className={`rounded p-0.5 ${m.marca}`}>{m.texto}</li>)}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div data-testid="agenda-mes-lista" className="space-y-4 md:hidden">
        <p className="font-semibold">{caption}</p>
        {comConteudo.length === 0 ? (
          <p className="text-sm text-suave">{M.semConsultasNoMes}</p>
        ) : (
          comConteudo.map((d) => {
            const cs = doDia(d);
            return (
              <section key={d} aria-labelledby={`mes-dia-${d}`} className="space-y-1 text-sm">
                <h2 id={`mes-dia-${d}`} className="font-semibold">
                  <Link href={hrefDoDia(d)} className={`inline-flex min-h-11 items-center text-link underline ${d === hoje ? 'text-ok' : ''}`}>{diaCurto(d)}</Link>
                </h2>
                {cs.length > 0 && <p>{M.consultas(cs.length)}</p>}
                {cs.length > 0 && <ul className="text-suave">{cs.map((c) => <li key={c.id}>{c.paciente}</li>)}</ul>}
                {marcadoresDoDia(d).length > 0 && (
                  <ul className="space-y-1">
                    {marcadoresDoDia(d).map((m) => <li key={m.chave} className={`rounded p-1 ${m.marca}`}>{m.texto}</li>)}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
