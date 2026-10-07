'use client';
import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MOTIVO_RECUSA_TEXTO_MAX, MOTIVOS_RECUSA, ROTULO_MOTIVO_RECUSA } from '@/modules/pacientes/exames-enviados-constantes';
import { recusarEnvioAction, type RevisaoState } from './actions';

/** US-164: o motivo da lista (o paciente vê "Não aceito: {motivo}"); "Outro motivo" com o texto de até 300 caracteres. */
export function RecusarForm({ id }: { id: string }) {
  const [state, action, pendente] = useActionState<RevisaoState, FormData>(recusarEnvioAction.bind(null, id), {});
  const e = state.erros ?? {};
  return (
    <details open={!!state.erros} className="rounded-2xl border border-borda bg-cartao p-4">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Recusar</summary>
      <form action={action} className="mt-3 space-y-3">
        <fieldset className="space-y-1" aria-describedby={e.motivo ? 'recusar-motivo-erro' : undefined}>
          <legend className="font-medium">Motivo</legend>
          {MOTIVOS_RECUSA.map((m) => (
            <div key={m} className="flex min-h-11 items-center gap-3">
              {/* revisão do plano: com erro, o rádio volta marcado (o reset do React 19 restaura o defaultChecked) */}
              <input id={`motivo-${m}`} type="radio" name="motivo" value={m} defaultChecked={state.valores?.motivo === m} className="h-5 w-5" />
              <label htmlFor={`motivo-${m}`}>{ROTULO_MOTIVO_RECUSA[m]}</label>
            </div>
          ))}
        </fieldset>
        {e.motivo && <p id="recusar-motivo-erro" role="alert" className="text-sm text-erro">{e.motivo}</p>}
        <div className="space-y-1">
          <label htmlFor="recusar-texto" className="block font-medium">Escreva o motivo</label>
          <textarea
            id="recusar-texto"
            name="texto"
            defaultValue={state.valores?.texto}
            maxLength={MOTIVO_RECUSA_TEXTO_MAX}
            rows={3}
            className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
            {...(e.texto ? { 'aria-invalid': true, 'aria-describedby': 'recusar-texto-erro' } : {})}
          />
          {e.texto && <p id="recusar-texto-erro" role="alert" className="text-sm text-erro">{e.texto}</p>}
        </div>
        {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
        <Botao variante="secundario" disabled={pendente}>Confirmar recusa</Botao>
      </form>
    </details>
  );
}
