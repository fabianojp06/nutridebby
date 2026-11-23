import { MSG_AGENDA, MSG_PUBLICO } from '@/modules/agenda/constantes';
import type { HorarioVisivel, LocalVisivel } from '@/modules/agenda/horarios';

/**
 * Horários livres agrupados por dia (fieldset/legend), um rádio por horário (`name="inicio"`, valor em ISO).
 * Plano 23 (US-403, I-13): antes, a escolha do local (`name="localId"`) — só com mais de um local; com um, o local vai num
 * campo escondido. O local filtra os horários na própria página (nada do formulário se perde); `local` e `aoTrocarLocal`
 * vêm de quem usa (componente de cliente), porque a semana e o envio também precisam do local. Os rótulos de local são
 * "Nome · Cidade", com o endereço só quando a projeção o trouxe ("Mostrar o endereço na página de agendamento"). Nunca a sala.
 * Sem hooks: serve ao portal, ao link da consulta e à página pública.
 */
export function SeletorHorarios({
  horarios,
  locais,
  local,
  aoTrocarLocal,
  erro,
}: {
  horarios: HorarioVisivel[];
  locais: LocalVisivel[];
  local: string | null;
  aoTrocarLocal: (id: string) => void;
  erro?: string;
}) {
  const lista = horarios.filter((h) => h.localId === local);
  const alerta = erro && <p id="inicio-erro" role="alert" className="text-sm text-erro">{erro}</p>;
  const escolha =
    locais.length > 1 ? (
      <fieldset className="space-y-2">
        <legend className="font-medium">{MSG_PUBLICO.ondeAtender}</legend>
        {locais.map((l) => (
          <label key={l.id} className="flex min-h-11 items-start gap-2 rounded-xl border border-campo bg-cartao p-2 text-texto">
            <input type="radio" name="localId" value={l.id} checked={local === l.id} onChange={() => aoTrocarLocal(l.id)} className="mt-1" />
            <span className="block">
              <span className="block">{l.cidade ? `${l.nome} · ${l.cidade}` : l.nome}</span>
              {l.endereco && <span className="block text-sm">{l.endereco}</span>}
            </span>
          </label>
        ))}
      </fieldset>
    ) : (
      <input type="hidden" name="localId" value={local ?? ''} />
    );
  if (!lista.length) {
    return (
      <div className="space-y-3">
        {escolha}
        <p>{MSG_AGENDA.semHorariosNaSemana}</p>
        {alerta}
      </div>
    );
  }
  const dias = [...new Set(lista.map((h) => h.dia))];
  return (
    <div className="space-y-3">
      {escolha}
      {dias.map((dia) => (
        <fieldset key={dia} className="space-y-1" aria-describedby={erro ? 'inicio-erro' : undefined}>
          <legend className="font-medium">{dia}</legend>
          <div className="flex flex-wrap gap-2">
            {lista.filter((h) => h.dia === dia).map((h) => (
              <label key={`${h.inicio}|${h.localId}`} className="flex items-center gap-1 rounded-full border border-campo bg-cartao px-2 py-1 text-texto">
                <input type="radio" name="inicio" value={h.inicio} required /> {h.hora}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {alerta}
    </div>
  );
}
