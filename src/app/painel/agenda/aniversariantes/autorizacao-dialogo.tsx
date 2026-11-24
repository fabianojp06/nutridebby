'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_ANIVERSARIO as M } from '@/modules/agenda/constantes';
import type { AniversarioState } from './actions';

type Registrar = (prev: AniversarioState, fd: FormData) => Promise<AniversarioState>;

/**
 * O formulário dentro do diálogo (o `<form>` fica dentro do `<Dialogo>`, nunca o contrário): "Como o paciente autorizou?"
 * ("Por escrito", "Por mensagem", "Verbalmente"; nenhuma marcada por padrão) e a confirmação obrigatória "O paciente
 * autorizou receber mensagens de aniversário. Guarde o comprovante." (LGPD art. 8º, § 2º: o ônus da prova é do
 * controlador). O erro fica junto dos campos; `aoMudarPendente` sobe o "em andamento" para o diálogo não fechar no meio.
 */
function FormularioDaAutorizacao({ registrar, aoCancelar, aoMudarPendente }: { registrar: Registrar; aoCancelar: () => void; aoMudarPendente: (p: boolean) => void }) {
  const [state, enviar, pendente] = useActionState<AniversarioState, FormData>(registrar, {});
  useEffect(() => aoMudarPendente(pendente), [pendente, aoMudarPendente]);
  const id = useId();
  return (
    <form action={enviar} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="font-medium">{M.comoAutorizou}</legend>
        {(Object.keys(M.formas) as (keyof typeof M.formas)[]).map((f, i) => (
          <label key={f} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="forma" value={f} required data-foco-inicial={i === 0 ? '' : undefined} className="size-5" />
            {M.formas[f]}
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" name="confirmo" required className="mt-1 size-5 shrink-0" aria-describedby={state.erro ? `${id}-erro` : undefined} />
        <span>{M.confirmacao}</span>
      </label>
      {state.erro && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{state.erro}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Botao type="button" variante="secundario" onClick={() => !pendente && aoCancelar()} aria-disabled={pendente || undefined} className="aria-disabled:opacity-60">
          Cancelar
        </Botao>
        <Botao type="submit" aria-disabled={pendente || undefined} className="aria-disabled:opacity-60" onClick={(e) => pendente && e.preventDefault()}>
          {M.registrar}
        </Botao>
      </div>
    </form>
  );
}

/**
 * Plano 23 (US-414 "Pela nutricionista"): "Registrar autorização" da linha, que abre o `Dialogo` compartilhado (sem cópia).
 * Menor de 18 hoje: o botão fica desabilitado, com "Menor de idade" ao lado (RN-431). O botão repetido leva o nome no
 * `aria-label`; se o diálogo fechar sem a ação, o foco volta a ele.
 */
export function RegistrarAutorizacao({ nome, menor, registrar }: { nome: string; menor: boolean; registrar: Registrar }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const idBotao = useId();
  if (menor) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Botao type="button" variante="secundario" disabled aria-describedby={`${idBotao}-menor`} className="focus-visible:outline-offset-[-3px]">{M.registrar}</Botao>
        <span id={`${idBotao}-menor`} className="text-sm text-suave">{M.menor}</span>
      </span>
    );
  }
  return (
    <>
      {/* dentro da tabela com rolagem lateral: o contorno do foco para dentro (RNF-10/D25) */}
      <Botao id={idBotao} type="button" variante="secundario" aria-haspopup="dialog" aria-label={M.registrarDe(nome)} onClick={() => setAberto(true)} className="focus-visible:outline-offset-[-3px]">
        {M.registrar}
      </Botao>
      <Dialogo aberto={aberto} titulo={M.registrarDe(nome)} aoFechar={() => setAberto(false)} ocupado={ocupado} rodape={null} focoAoFechar={() => document.getElementById(idBotao)}>
        <FormularioDaAutorizacao registrar={registrar} aoCancelar={() => setAberto(false)} aoMudarPendente={setOcupado} />
      </Dialogo>
    </>
  );
}
