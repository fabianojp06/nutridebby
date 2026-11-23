'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_SOLICITACOES as M } from '@/modules/agenda/constantes';
import type { RecusaState } from './actions';

type Recusar = (prev: RecusaState, fd: FormData) => Promise<RecusaState>;

/** "Aceitar" com o envio em andamento: o botão fica desligado até a volta (o segundo clique daria "já respondido"). */
function BotaoAceitar({ nome }: { nome: string }) {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" disabled={pending} aria-label={M.aceitarDe(nome)}>
      {M.aceitar}
    </Botao>
  );
}

/**
 * O formulário dentro do diálogo da recusa (§7, US-409): "Motivo (só você vê)" só no pedido de paciente (AG-D23: a pessoa
 * nova não tem motivo), o erro junto do campo e "Cancelar"/"Confirmar recusa" (o `<form>` fica dentro do `<Dialogo>`, nunca
 * o contrário). `aoMudarPendente` sobe o "em andamento" para o diálogo não fechar no meio.
 */
export function FormularioDaRecusa({ comMotivo, recusar, aoCancelar, aoMudarPendente }: { comMotivo: boolean; recusar: Recusar; aoCancelar: () => void; aoMudarPendente?: (p: boolean) => void }) {
  const [state, enviar, pendente] = useActionState<RecusaState, FormData>(recusar, {});
  useEffect(() => aoMudarPendente?.(pendente), [pendente, aoMudarPendente]);
  return (
    <form action={enviar} className="space-y-3">
      {comMotivo && (
        <div className="space-y-1">
          <label htmlFor="motivo-recusa" className="block font-medium">{M.motivo}</label>
          <textarea
            id="motivo-recusa"
            name="motivo"
            maxLength={300}
            rows={3}
            data-foco-inicial=""
            aria-invalid={state.erro ? true : undefined}
            aria-describedby={state.erro ? 'motivo-recusa-erro' : undefined}
            className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
          />
        </div>
      )}
      {state.erro && <p id="motivo-recusa-erro" role="alert" className="text-sm text-erro">{state.erro}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Botao type="button" variante="secundario" onClick={() => !pendente && aoCancelar()} aria-disabled={pendente || undefined} className="aria-disabled:opacity-60" data-foco-inicial={comMotivo ? undefined : ''}>
          Cancelar
        </Botao>
        <Botao type="submit" variante="escuro" aria-disabled={pendente || undefined} className="aria-disabled:opacity-60" onClick={(e) => pendente && e.preventDefault()}>
          {M.confirmarRecusaBotao}
        </Botao>
      </div>
    </form>
  );
}

/**
 * Plano 23 (US-409, §7): "Aceitar" (um formulário, sem JavaScript) e "Recusar", que abre a confirmação no `Dialogo`
 * compartilhado (Plano 22, sem cópia): "Recusar o pedido de {nome}?" + "A pessoa recebe um e-mail avisando.". Os botões
 * repetidos levam o nome no `aria-label`. As actions redirecionam para a fila; a região de status e o foco no h1 ficam com
 * a página. Se o diálogo fechar sem a ação, o foco volta ao "Recusar".
 */
export function AcoesDoPedido({ nome, comMotivo, aceitar, recusar }: { nome: string; comMotivo: boolean; aceitar: () => Promise<void>; recusar: Recusar }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const idRecusar = useId();
  return (
    // o nome da pessoa nova vem do formulário público (até 120 caracteres, sem espaço): quebra em qualquer ponto, também no
    // título do diálogo (herda daqui; o `Dialogo` compartilhado não muda)
    <div className="flex flex-wrap gap-3 [overflow-wrap:anywhere]">
      <form action={aceitar}>
        <BotaoAceitar nome={nome} />
      </form>
      <Botao id={idRecusar} type="button" variante="secundario" aria-haspopup="dialog" aria-label={M.recusarDe(nome)} onClick={() => setAberto(true)}>
        {M.recusar}
      </Botao>
      <Dialogo
        aberto={aberto}
        titulo={M.recusaTitulo(nome)}
        descricao={M.recusaAviso}
        aoFechar={() => setAberto(false)}
        ocupado={ocupado}
        rodape={null}
        focoAoFechar={() => document.getElementById(idRecusar)}
      >
        <FormularioDaRecusa comMotivo={comMotivo} recusar={recusar} aoCancelar={() => setAberto(false)} aoMudarPendente={setOcupado} />
      </Dialogo>
    </div>
  );
}
