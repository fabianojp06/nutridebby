import Link from 'next/link';
import { hhmmDe } from '@/modules/agenda/calendario';
import { MSG_VISOES as M } from '@/modules/agenda/constantes';
import type { BloqueioSalvo } from '@/modules/agenda/disponibilidade';
import { diaCurto, inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { ROTULO_TIPO_CONSULTA, SELO_PRESENCA_A_REGISTRAR } from '@/modules/agenda/status';
import type { ItemDaAgenda, Marcador } from '@/modules/agenda/visoes';
import { MARCA } from './legenda';

/**
 * Plano 23 (US-404, spec §7): Dia e Semana em grade de horas. A `table` (a partir de 768 px) tem `caption`, `th scope="col"`
 * nos dias e `th scope="row"` nas horas; cada consulta aparece uma vez, na linha da hora em que começa, com o horário
 * visível ("08:40–09:30"; a de mais de 1 h, "09:00 (até 10:30)"). O link é nomeado pelo conteúdo visível (horário, paciente,
 * tipo, local e situação), sem `aria-label`. Abaixo de 768 px, a mesma agenda em lista por dia (`h2` por dia); as duas
 * versões ficam no HTML (`hidden md:table` / `md:hidden`), cada uma com o seu `data-testid`.
 */
type Props = {
  dias: string[];
  hoje: string;
  fuso: string;
  faixa: { de: number; ate: number };
  caption: string;
  itens: ItemDaAgenda[];
  bloqueios: BloqueioSalvo[];
  marcadores: { aniversarios: Marcador[]; retornos: Marcador[] };
};

const p2 = (n: number) => String(n).padStart(2, '0');

/** "08:40–09:30", ou "09:00 (até 10:30)" quando a consulta dura mais de 1 h (atravessa linhas da grade). */
function horarioDoItem(c: ItemDaAgenda, fuso: string): string {
  const ini = partesNoFuso(c.inicio, fuso).hora;
  const fim = partesNoFuso(c.fim, fuso).hora;
  return c.fim.getTime() - c.inicio.getTime() > 3_600_000 ? M.ate(ini, fim) : `${ini}–${fim}`;
}

/** `grande`: na lista do celular, alvo de 44 px; na grade, o mínimo da WCAG 2.5.8 (24 px). */
function ItemDaGrade({ c, fuso, grande = false }: { c: ItemDaAgenda; fuso: string; grande?: boolean }) {
  const marca = c.selos.includes(SELO_PRESENCA_A_REGISTRAR) ? MARCA.presenca : MARCA[c.tipoConsulta];
  return (
    <Link href={`/painel/agenda/consultas/${c.id}`} className={`block ${grande ? 'min-h-11' : 'min-h-6'} rounded-lg p-1.5 text-texto hover:underline ${marca}`}>
      <span className="block font-medium">{horarioDoItem(c, fuso)}</span>
      <span className="block">{c.paciente}</span>
      <span className="block">{[ROTULO_TIPO_CONSULTA[c.tipoConsulta], ...(c.local ? [c.local.nome] : [])].join(' · ')}</span>
      <span className="block text-suave">{c.selos.join(' · ')}</span>
    </Link>
  );
}

/** O bloqueio recortado ao dia: "Bloqueado: {motivo}" e o horário dentro do dia. */
type BloqueioDoDia = { id: string; texto: string; horario: string; inicioMin: number };
function bloqueiosDoDia(bloqueios: BloqueioSalvo[], dia: string, fuso: string): BloqueioDoDia[] {
  const ini = inicioDoDia(dia, fuso);
  const fim = inicioDoDia(somarDias(dia, 1), fuso);
  return bloqueios
    .filter((b) => b.inicio < fim && b.fim > ini)
    .map((b) => {
      const de = b.inicio > ini ? partesNoFuso(b.inicio, fuso).minutos : 0;
      const ate = b.fim < fim ? partesNoFuso(b.fim, fuso).minutos : 24 * 60;
      return { id: b.id, texto: M.bloqueado(b.motivo), horario: `${hhmmDe(de)}–${hhmmDe(ate)}`, inicioMin: de };
    });
}

function Bloqueio({ b }: { b: BloqueioDoDia }) {
  return (
    <p className={`rounded-lg p-1.5 ${MARCA.bloqueio}`}>
      <span className="block font-medium">{b.horario}</span>
      <span className="block">{b.texto}</span>
    </p>
  );
}

function MarcadoresDoDia({ dia, marcadores }: { dia: string; marcadores: Props['marcadores'] }) {
  const lista = [
    ...marcadores.retornos.filter((m) => m.data === dia).map((m) => ({ chave: `r-${m.patientId}`, texto: M.marcadorRetorno(m.nome), marca: MARCA.retornoPrevisto })),
    ...marcadores.aniversarios.filter((m) => m.data === dia).map((m) => ({ chave: `a-${m.patientId}`, texto: M.marcadorAniversario(m.nome), marca: MARCA.aniversario })),
  ];
  if (!lista.length) return null;
  return (
    <ul className="space-y-1">
      {lista.map((m) => <li key={m.chave} className={`rounded-lg p-1 ${m.marca}`}>{m.texto}</li>)}
    </ul>
  );
}

export function GradeDaSemana({ dias, hoje, fuso, faixa, caption, itens, bloqueios, marcadores }: Props) {
  const doDia = (dia: string) => itens.filter((c) => partesNoFuso(c.inicio, fuso).data === dia);
  const horas = Array.from({ length: faixa.ate - faixa.de }, (_, i) => faixa.de + i);
  const naLinha = (min: number) => Math.min(Math.max(Math.floor(min / 60), faixa.de), faixa.ate - 1);
  const comMarcadores = marcadores.aniversarios.length + marcadores.retornos.length > 0;
  const titulo = (dia: string) => `${diaCurto(dia)}${dia === hoje ? ` ${M.hojeMarca}` : ''}`;
  return (
    <>
      <table data-testid="agenda-grade" className="hidden w-full table-fixed border-collapse text-sm break-words md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-14 border-b border-borda p-1 text-left font-normal text-suave">{M.hora}</th>
            {dias.map((d) => (
              <th key={d} scope="col" className={`border-b border-borda p-1 text-left ${d === hoje ? 'text-ok' : ''}`}>{titulo(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comMarcadores && (
            <tr>
              <th scope="row" className="border-b border-borda p-1 text-left align-top font-normal text-suave">{M.marcadores}</th>
              {dias.map((d) => <td key={d} className="border-b border-borda p-1 align-top"><MarcadoresDoDia dia={d} marcadores={marcadores} /></td>)}
            </tr>
          )}
          {horas.map((h) => (
            <tr key={h}>
              <th scope="row" className="border-b border-borda p-1 text-left align-top font-normal text-suave">{`${p2(h)}h`}</th>
              {dias.map((d) => {
                const bs = bloqueiosDoDia(bloqueios, d, fuso).filter((b) => naLinha(b.inicioMin) === h);
                const cs = doDia(d).filter((c) => naLinha(partesNoFuso(c.inicio, fuso).minutos) === h);
                return (
                  <td key={d} className="h-12 border-b border-l border-borda p-1 align-top">
                    {(bs.length > 0 || cs.length > 0) && (
                      <div className="space-y-1">
                        {bs.map((b) => <Bloqueio key={b.id} b={b} />)}
                        {cs.map((c) => <ItemDaGrade key={c.id} c={c} fuso={fuso} />)}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div data-testid="agenda-lista-dias" className="space-y-4 md:hidden">
        {dias.map((d) => {
          const cs = doDia(d);
          const bs = bloqueiosDoDia(bloqueios, d, fuso);
          return (
            <section key={d} aria-labelledby={`lista-dia-${d}`} className="space-y-2">
              <h2 id={`lista-dia-${d}`} className={`text-sm font-semibold ${d === hoje ? 'text-ok' : ''}`}>{titulo(d)}</h2>
              <MarcadoresDoDia dia={d} marcadores={marcadores} />
              {bs.map((b) => <Bloqueio key={b.id} b={b} />)}
              {cs.length === 0 && bs.length === 0 ? (
                <p className="text-sm text-suave">{M.semConsultasNoDia}</p>
              ) : (
                <ul className="space-y-2">
                  {cs.map((c) => <li key={c.id}><ItemDaGrade c={c} fuso={fuso} grande /></li>)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
