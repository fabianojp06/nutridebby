'use client';
import { useActionState, useEffect, useRef, useSyncExternalStore } from 'react';
import { aplicarResposta } from '@/components/mensagens/campo';
import { rolarAteOFim } from '@/components/mensagens/rolagem';
import { Botao } from '@/components/ui/botao';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { enviarAction, type EstadoDoEnvio } from './actions';
import { seguraFalhaDeRede } from './rede';

const C = MSG_MENSAGENS.conversa;
const nada = () => () => undefined;
/** Verdadeiro só depois da hidratação: com JS, a action devolve o estado; sem JS, o servidor volta pela página (redirect). */
const useComJs = () => useSyncExternalStore(nada, () => true, () => false);
const marcaNova = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;


/**
 * O texto do campo: UM `textarea` só, nunca remontado (rodada da T6b, C1: mensagem nova ou "Lida" que muda não tocam no
 * rascunho). A cada resposta da action (`estado`, novo objeto por resposta), o valor vira o texto devolvido — no erro, o que
 * foi escrito; no sucesso, vazio — e, depois de enviar, o foco volta ao campo e a tela rola até o fim (§7.2). Correção do
 * E2E "rodada T6b (I4)": a versão anterior remontava o `textarea` por `key` a cada resposta; depois de uma falha de rede, o
 * envio seguinte deixava o `textarea` velho (com o rascunho) no formulário ao lado do novo (o reset automático do formulário
 * pelo React e a troca do nó no mesmo commit) — o campo "não limpava". `defaultValue` cobre o render sem JS (RNF-443).
 */
function Texto({ estado, idErro }: { estado: EstadoDoEnvio | null; idErro: string | undefined }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!aplicarResposta(ref.current, estado)) return;
    ref.current?.focus({ preventScroll: true });
    rolarAteOFim(); // rodada da T7 (I3): até o fim do documento, não até o rodapé sticky
  }, [estado]);
  return (
    <textarea
      ref={ref}
      id="texto-mensagem"
      name="texto"
      rows={3}
      defaultValue={estado?.texto ?? ''}
      aria-describedby={idErro}
      aria-invalid={idErro ? true : undefined}
      className="block w-full resize-y rounded-xl border border-campo bg-cartao p-2 text-texto"
    />
  );
}

/**
 * US-441 (§7.2): o rodapé com o campo "Mensagem" e "Enviar" — `textarea` (Enter quebra linha; nada envia sozinho). Sem JS
 * (RNF-443), o formulário é a própria Server Action (`useActionState`, com o estado no erro e o redirect no sucesso). Com
 * JS, a mesma action embrulhada por `seguraFalhaDeRede` (rodada da T6b, I4): a rede caída vira "Não foi possível enviar.
 * Tente de novo." com o texto de volta, em vez de cair no error boundary. O erro fica junto ao campo (`role="alert"`,
 * reanunciado a cada resposta). O anexo entra na T8.
 */
export function CampoDaConversa({ patientId }: { patientId: string }) {
  const doServidor = enviarAction.bind(null, patientId);
  const [estadoSemJs, acaoSemJs] = useActionState<EstadoDoEnvio | null, FormData>(doServidor, null);
  const [estadoComJs, acaoComJs, enviando] = useActionState<EstadoDoEnvio | null, FormData>(
    seguraFalhaDeRede(doServidor, (dados) => ({ marca: marcaNova(), erro: MSG_MENSAGENS.erros.falha, texto: typeof dados.get('texto') === 'string' ? (dados.get('texto') as string) : '', enviada: false })),
    null,
  );
  const comJs = useComJs();
  const estado = estadoComJs ?? estadoSemJs;
  const idErro = estado?.erro ? 'erro-mensagem' : undefined;
  return (
    <form action={comJs ? acaoComJs : acaoSemJs} data-guia="conversa-campo" className="space-y-2" aria-busy={enviando || undefined}>
      {comJs && <input type="hidden" name="js" value="1" />}
      <label htmlFor="texto-mensagem" className="block font-medium">
        {C.campo}
      </label>
      {/* sem `key`: o mesmo textarea a cada resposta (o texto devolvido entra pelo efeito do Texto) */}
      <Texto estado={estado} idErro={idErro} />
      {estado?.erro && (
        <p key={estado.marca} id="erro-mensagem" role="alert" className="text-erro">
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
