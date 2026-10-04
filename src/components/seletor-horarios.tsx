import { MSG_AGENDA } from '@/modules/agenda/constantes';
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';

/**
 * Horários livres agrupados por dia (fieldset/legend), um rádio por horário (`name="inicio"`, valor em ISO).
 * Sem hooks: serve ao link da consulta e à página pública (Tarefa 8), em componente de servidor ou de cliente.
 */
export function SeletorHorarios({ horarios, modalidade, erro }: { horarios: HorarioVisivel[]; modalidade?: Modalidade; erro?: string }) {
  const lista = modalidade ? horarios.filter((h) => h.modalidades.includes(modalidade)) : horarios;
  const alerta = erro && <p id="inicio-erro" role="alert" className="text-sm text-erro">{erro}</p>;
  if (!lista.length) {
    return (
      <div className="space-y-2">
        <p>{MSG_AGENDA.semHorariosNaSemana}</p>
        {alerta}
      </div>
    );
  }
  const dias = [...new Set(lista.map((h) => h.dia))];
  return (
    <div className="space-y-3">
      {dias.map((dia) => (
        <fieldset key={dia} className="space-y-1" aria-describedby={erro ? 'inicio-erro' : undefined}>
          <legend className="font-medium">{dia}</legend>
          <div className="flex flex-wrap gap-2">
            {lista.filter((h) => h.dia === dia).map((h) => (
              <label key={h.inicio} className="flex items-center gap-1 rounded-full border border-campo bg-cartao px-2 py-1 text-texto">
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
