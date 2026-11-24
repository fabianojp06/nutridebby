'use client';
import { useRouter } from 'next/navigation';
import { useActionState, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ContextoDaLeitura } from '@/components/mensagens/leitura';
import { seguraFalhaDeRede } from '@/components/mensagens/rede';
import { aplicarResposta } from '@/components/mensagens/campo';
import { rolarAteOFim } from '@/components/mensagens/rolagem';
import { acompanharSituacao, novasNaTela, primeiraNovaDepois } from '@/components/mensagens/situacao';
import { useOnline } from '@/components/portal/online';
import { detectarRisco } from '@/modules/ia/nutri-paciente/sinais-risco';
import { MSG_PORTAL_MENSAGENS, RISCO_DO_TEXTO_FIXO } from '@/modules/mensagens/constantes';
import { enviarMensagemAction, type EstadoDoEnvioPortal } from './actions';
import { Socorro } from './socorro';

const P = MSG_PORTAL_MENSAGENS;
const nada = () => () => undefined;
/** Verdadeiro só depois da hidratação: com JS, a action devolve o estado; sem JS, o servidor volta pela página (redirect). */
const useComJs = () => useSyncExternalStore(nada, () => true, () => false);
const marcaNova = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Rodada da T7 (I1): o aviso de urgência do topo (RN-450) descreve o campo (`aria-describedby`), junto com o erro. */
export const ID_AVISO_URGENCIA = 'aviso-urgencia';

/**
 * Rodada da T7 (CFN M2, CH-D77): a rede caída no envio — o rascunho de volta, o erro genérico e o sinal de risco do texto
 * recusado, calculado no aparelho (`detectarRisco` é puro, sem import de servidor): o socorro aparece sem dizer "enviada".
 */
export function estadoDaFalhaDeRede(dados: FormData): EstadoDoEnvioPortal {
  const texto = typeof dados.get('texto') === 'string' ? (dados.get('texto') as string) : '';
  return { marca: marcaNova(), erro: P.erros.falha, texto, enviada: false, textoFixo: detectarRisco(texto)?.textoFixo ?? null };
}

/** RN-452: a rota leve da situação no app — só o id da última mensagem mostrada (o paciente vem da sessão). */
export const urlDaSituacaoDoPortal = (depois: string | null): string => `/api/p/mensagens/situacao?depois=${encodeURIComponent(depois ?? '')}`;

/**
 * O texto da região viva do app: sem rede, "Sem conexão. Escreva quando voltar." (RN-473, vence tudo); com mensagens novas,
 * "Nova mensagem da sua nutricionista."; senão o aviso da página (o `?erro=` quando não há campo), menos o já visto num
 * "Mostrar novas mensagens".
 */
export function textoDaRegiaoDoPortal(o: { online: boolean; novas: number; aviso: string; avisoVisto: string | null }): string {
  if (!o.online) return P.erros.semInternet;
  if (o.novas > 0) return P.novaMensagem;
  return o.aviso === o.avisoVisto ? '' : o.aviso;
}

/**
 * US-443 (§7.3, RN-452, RN-473): a região viva da conversa no app, sempre montada junto ao rodapé (só o texto muda, molde
 * `selo-offline.tsx`), com a mesma consulta "há novas?" do painel (15 s com a aba visível, 60 s depois de 5 min parado,
 * nada com a aba escondida ou sem rede). Com novas, anuncia "Nova mensagem da sua nutricionista." sem nenhum texto de
 * mensagem (a consulta só traz `novas` e `ultimaLida`); "Mostrar novas mensagens" refaz a página (o conteúdo vem do
 * servidor, com auditRead) e leva o foco à primeira nova. Sem rede, "Sem conexão. Escreva quando voltar.". Com `aviso` (o
 * `?erro=` numa conversa sem campo), o foco vai à região sem rolar; senão, com `abrirNoFim` (nunca na visão `?antes=`), a
 * tela abre rolada até o fim.
 */
export function SituacaoDoPortal({ depois, consultar, abrirNoFim, aviso }: { depois: string | null; consultar: boolean; abrirNoFim: boolean; aviso: string }) {
  const router = useRouter();
  const online = useOnline();
  const regiao = useRef<HTMLParagraphElement>(null);
  const { setConsultada } = useContext(ContextoDaLeitura);
  const [consulta, setConsulta] = useState<{ de: string | null; n: number } | null>(null);
  const [avisoVisto, setAvisoVisto] = useState<string | null>(null);
  /** O id da última mensagem que estava na tela no toque: depois do refresh, o foco vai à seguinte. */
  const focarDepoisDe = useRef<string | null | undefined>(undefined);
  const novas = novasNaTela(consulta, depois);

  // re-revisão da T7: rola até o fim só ao abrir no fim — a visão `?antes=` (as anteriores) fica no lugar
  useEffect(() => {
    if (aviso) regiao.current?.focus({ preventScroll: true });
    else if (abrirNoFim) rolarAteOFim();
  }, [aviso, abrirNoFim]);

  useEffect(() => {
    if (!consultar) return undefined;
    return acompanharSituacao(urlDaSituacaoDoPortal(depois), (s) => {
      setConsulta({ de: depois, n: s.novas });
      setConsultada(s.ultimaLida);
    });
  }, [consultar, depois, setConsultada]);

  // a página refez com as mensagens novas (`depois` mudou): o foco vai à primeira nova
  useEffect(() => {
    const anterior = focarDepoisDe.current;
    if (anterior === undefined || anterior === depois) return;
    focarDepoisDe.current = undefined;
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-mensagem]')).map((el) => el.dataset.mensagem!);
    const alvo = primeiraNovaDepois(ids, anterior);
    if (alvo) document.querySelector<HTMLElement>(`[data-mensagem="${alvo}"]`)?.focus();
  }, [depois]);

  const mostrarNovas = () => {
    focarDepoisDe.current = depois;
    setConsulta(null);
    setAvisoVisto(aviso);
    router.refresh();
  };

  return (
    <div className="space-y-2">
      <p ref={regiao} id="regiao-da-conversa" role="status" tabIndex={-1} className="text-sm font-semibold focus-visible:outline-offset-2">
        {textoDaRegiaoDoPortal({ online, novas, aviso, avisoVisto })}
      </p>
      {online && novas > 0 && (
        <button type="button" onClick={mostrarNovas} className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4 font-semibold">
          {P.mostrarNovas}
        </button>
      )}
    </div>
  );
}

/**
 * O texto do campo: UM `textarea` só, nunca remontado (molde da rodada da T6b, C1: mensagem nova, "Lida" novo ou a rede que
 * cai não tocam no rascunho — sem rede, o campo só fica desabilitado, com o texto dentro, RN-473). A cada resposta da action
 * (`estado`, novo objeto por resposta), o valor vira o texto devolvido (no erro, o que foi escrito; no sucesso, vazio) e,
 * depois de enviar, o foco volta ao campo (a tela rola até o fim) — ou, com sinal de risco, vai ao socorro (RN-449).
 * Correção do E2E "rodada T6b (I4)" (o mesmo padrão do painel): remontar o `textarea` por `key` deixava, depois de uma
 * falha de rede, o nó velho com o rascunho no formulário ao lado do novo. `defaultValue` cobre o render sem JS.
 */
function Texto({ estado, idErro, desabilitado }: { estado: EstadoDoEnvioPortal | null; idErro: string | undefined; desabilitado: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!aplicarResposta(ref.current, estado)) return;
    if (estado?.textoFixo) {
      const socorros = document.querySelectorAll<HTMLElement>('[data-mensagem] [data-socorro]');
      const ultimo = socorros[socorros.length - 1];
      if (ultimo) {
        ultimo.focus();
        return;
      }
    }
    ref.current?.focus({ preventScroll: true });
    rolarAteOFim();
  }, [estado]);
  return (
    <textarea
      ref={ref}
      id="texto-mensagem"
      name="texto"
      rows={2}
      defaultValue={estado?.texto ?? ''}
      disabled={desabilitado}
      aria-describedby={idErro ? `${ID_AVISO_URGENCIA} ${idErro}` : ID_AVISO_URGENCIA}
      aria-invalid={idErro ? true : undefined}
      className="block w-full resize-y rounded-xl border border-campo bg-cartao p-3 text-texto disabled:opacity-60"
    />
  );
}

/**
 * US-443 (§7.3): o campo "Escreva sua mensagem" e "Enviar" — `textarea` (Enter quebra linha; nada envia sozinho). Sem JS
 * (RNF-443), o formulário é a própria Server Action (`useActionState`: o estado no erro e o redirect no sucesso). Com JS, a
 * mesma action embrulhada por `seguraFalhaDeRede`: a rede caída vira "Não foi possível enviar. Tente de novo." com o
 * rascunho de volta. Sem rede (RN-473), o campo e o botão ficam desabilitados e o texto fica. O erro junto ao campo
 * (`role="alert"`, reanunciado a cada resposta); `erroInicial` = o `?erro=` do envio sem JS. "Muitas" com sinal de risco
 * no texto recusado — ou qualquer outra recusa, inclusive a rede caída (CH-D77) — mostra também o socorro, sem dizer
 * "enviada" (RN-449; a mensagem não foi gravada). A foto entra na T8.
 */
export function CampoDoPortal({ erroInicial }: { erroInicial: string | null }) {
  const online = useOnline();
  const [estadoSemJs, acaoSemJs] = useActionState<EstadoDoEnvioPortal | null, FormData>(enviarMensagemAction, null);
  const [estadoComJs, acaoComJs, enviando] = useActionState<EstadoDoEnvioPortal | null, FormData>(
    seguraFalhaDeRede(enviarMensagemAction, estadoDaFalhaDeRede),
    null,
  );
  const comJs = useComJs();
  const estado = estadoComJs ?? estadoSemJs;
  const erro = estado ? estado.erro : erroInicial;
  const idErro = erro ? 'erro-mensagem' : undefined;
  const bloqueado = !online || enviando;
  return (
    <form action={comJs ? acaoComJs : acaoSemJs} className="space-y-2" aria-busy={enviando || undefined}>
      {comJs && <input type="hidden" name="js" value="1" />}
      <label htmlFor="texto-mensagem" className="block font-semibold">
        {P.campo}
      </label>
      {/* sem `key`: o mesmo textarea a cada resposta (o texto devolvido entra pelo efeito do Texto) */}
      <Texto estado={estado} idErro={idErro} desabilitado={!online} />
      {erro && (
        // re-revisão da T7 (1): o socorro da recusa (CH-D77: o texto recusado, sem dizer "enviada") fica DENTRO do alerta —
        // o leitor de tela ouve o erro e o 188/192 juntos; o campo continua descrito só pelo erro (`erro-mensagem`)
        <div key={estado?.marca ?? 'url'} role="alert" className="space-y-2">
          <p id="erro-mensagem" className="text-erro">
            {erro}
          </p>
          {estado?.erro && estado.textoFixo && <Socorro risco={RISCO_DO_TEXTO_FIXO[estado.textoFixo]} recusa />}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!online}
          aria-disabled={bloqueado || undefined}
          // um envio de cada vez: o segundo toque com o primeiro em andamento não manda a mensagem de novo
          onClick={(e) => {
            if (enviando) e.preventDefault();
          }}
          className="min-h-11 rounded-xl bg-destaque px-5 font-semibold text-white disabled:opacity-60 aria-disabled:opacity-60"
        >
          {P.enviar}
        </button>
      </div>
    </form>
  );
}
