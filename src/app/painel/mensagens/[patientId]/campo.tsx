'use client';
import { useActionState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { enviarAction, type EstadoDoEnvio } from './actions';

const C = MSG_MENSAGENS.conversa;
const nada = () => () => undefined;
/** Verdadeiro só depois da hidratação: com JS, a action devolve o estado; sem JS, o servidor volta pela página (redirect). */
const useComJs = () => useSyncExternalStore(nada, () => true, () => false);

/**
 * O texto do campo, remontado a cada resposta da action (`marca`) com o texto devolvido: no erro, o que foi escrito; no
 * sucesso, vazio. Depois de enviar, o foco volta ao campo e a lista rola até a mensagem nova (§7.2).
 */
function Texto({ inicial, focar, idErro }: { inicial: string; focar: boolean; idErro: string | undefined }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focar) return;
    ref.current?.focus();
    document.getElementById('fim-da-conversa')?.scrollIntoView({ block: 'end' });
  }, [focar]);
  return (
    <textarea
      ref={ref}
      id="texto-mensagem"
      name="texto"
      rows={3}
      defaultValue={inicial}
      aria-describedby={idErro}
      aria-invalid={idErro ? true : undefined}
      className="block w-full resize-y rounded-xl border border-campo bg-cartao p-2 text-texto"
    />
  );
}

/**
 * US-441 (§7.2): o rodapé com o campo "Mensagem" e "Enviar" — `textarea` (Enter quebra linha; nada envia sozinho), Server
 * Action com `useActionState` e o mesmo `<form action>` sem JS (RNF-443). O erro fica junto ao campo (`role="alert"`). O
 * anexo entra na T8.
 */
export function CampoDaConversa({ patientId }: { patientId: string }) {
  const [estado, acao, enviando] = useActionState<EstadoDoEnvio | null, FormData>(enviarAction.bind(null, patientId), null);
  const comJs = useComJs();
  const idErro = estado?.erro ? 'erro-mensagem' : undefined;
  return (
    <form action={acao} data-guia="conversa-campo" className="space-y-2" aria-busy={enviando || undefined}>
      {comJs && <input type="hidden" name="js" value="1" />}
      <label htmlFor="texto-mensagem" className="block font-medium">
        {C.campo}
      </label>
      <Texto key={estado?.marca ?? 'inicio'} inicial={estado?.texto ?? ''} focar={!!estado?.enviada} idErro={idErro} />
      {estado?.erro && (
        <p id="erro-mensagem" role="alert" className="text-erro">
          {estado.erro}
        </p>
      )}
      <div className="flex justify-end">
        <Botao
          type="submit"
          aria-disabled={enviando || undefined}
          // um envio de cada vez: o segundo toque com o primeiro em andamento não manda a mensagem de novo
          onClick={(e) => {
            if (enviando) e.preventDefault();
          }}
          className="aria-disabled:opacity-60"
        >
          {enviando ? C.enviando : C.enviar}
        </Botao>
      </div>
    </form>
  );
}
