'use client';
import { useRouter } from 'next/navigation';
import { useContext, useEffect, useRef, useState } from 'react';
import { ContextoDaLeitura } from '@/components/mensagens/leitura';
import { acompanharSituacao, novasNaTela, primeiraNovaDepois } from '@/components/mensagens/situacao';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';

// T7: a consulta, o "Lida" e o alvo do foco foram para src/components/mensagens (o portal usa os mesmos)
export { EstadoDaMinha, ProvedorDaLeitura } from '@/components/mensagens/leitura';
export { acompanharSituacao, lidaMaisAdiante, novasNaTela, primeiraNovaDepois, type Situacao } from '@/components/mensagens/situacao';

const C = MSG_MENSAGENS.conversa;

/** RN-452: a rota leve da situação (o paciente e o id da última mensagem mostrada; vazio = a tela não tinha mensagens). */
export const urlDaSituacao = (patientId: string, depois: string | null): string =>
  `/api/painel/mensagens/situacao?paciente=${encodeURIComponent(patientId)}&depois=${encodeURIComponent(depois ?? '')}`;

/** US-441: o texto da região viva quando chegam mensagens do paciente com a tela aberta. */
export const avisoDeNovas = (novas: number, primeiroNome: string): string => (novas > 0 ? C.novaMensagemDe(primeiroNome) : '');

/**
 * O texto da região viva: "Nova mensagem de {nome}." com novas; senão, o retorno `?ok=`/`?erro=` — menos o que já ficou
 * para trás num "Mostrar novas mensagens" (`avisoVisto`). Um ato novo (pausar depois de liberar) é outro texto e é anunciado.
 */
export function textoDaRegiao(o: { novas: number; primeiroNome: string; aviso: string; avisoVisto: string | null }): string {
  if (o.novas > 0) return avisoDeNovas(o.novas, o.primeiroNome);
  return o.aviso === o.avisoVisto ? '' : o.aviso;
}

/**
 * US-441 (§7.2): a região viva da conversa, sempre montada junto ao rodapé (só o texto muda, molde `selo-offline.tsx`).
 * Anuncia o retorno `?ok=` (e recebe o foco, sem rolar a lista) ou "Nova mensagem de {primeiro nome}." quando a consulta
 * acha mensagens do paciente depois da última mostrada; "Mostrar novas mensagens" refaz a página (o conteúdo só vem do
 * servidor, com auditRead) e leva o foco à primeira nova. Sem `?ok=`, a tela abre rolada até a última mensagem.
 * `consultar`: falso na página de mensagens anteriores (`?antes=`), que não tem as últimas na tela.
 */
export function SituacaoDaConversa({
  patientId,
  depois,
  primeiroNome,
  aviso,
  focarAviso,
  consultar,
}: {
  patientId: string;
  depois: string | null;
  primeiroNome: string;
  aviso: string;
  focarAviso: boolean;
  consultar: boolean;
}) {
  const router = useRouter();
  const regiao = useRef<HTMLParagraphElement>(null);
  const { setConsultada } = useContext(ContextoDaLeitura);
  const [consulta, setConsulta] = useState<{ de: string | null; n: number } | null>(null);
  /** O `?ok=` que estava na tela no toque em "Mostrar novas mensagens": não volta a ser anunciado. */
  const [avisoVisto, setAvisoVisto] = useState<string | null>(null);
  /** O id da última mensagem que estava na tela no toque: depois do refresh, o foco vai à seguinte. */
  const focarDepoisDe = useRef<string | null | undefined>(undefined);
  const novas = novasNaTela(consulta, depois);

  // I1 da rodada: a cada ato (liberar → pausar → retomar) o foco vai à região, sem rolar; sem ato, a tela abre no rodapé
  useEffect(() => {
    if (focarAviso) regiao.current?.focus({ preventScroll: true });
    else document.getElementById('rodape-da-conversa')?.scrollIntoView({ block: 'end' });
  }, [focarAviso, aviso]);

  useEffect(() => {
    if (!consultar) return undefined;
    return acompanharSituacao(urlDaSituacao(patientId, depois), (s) => {
      setConsulta({ de: depois, n: s.novas });
      setConsultada(s.ultimaLida);
    });
  }, [consultar, patientId, depois, setConsultada]);

  // a página refez com as mensagens novas (`depois` mudou): o foco vai à primeira nova (a margem de rolagem do item a
  // deixa acima do rodapé)
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

  const texto = textoDaRegiao({ novas, primeiroNome, aviso, avisoVisto });
  return (
    <div className="space-y-2">
      <p ref={regiao} role="status" tabIndex={-1} className="text-sm focus-visible:outline-offset-2">
        {texto}
      </p>
      {novas > 0 && (
        <button type="button" onClick={mostrarNovas} className="inline-flex min-h-11 items-center rounded-full border border-campo bg-cartao px-4 text-texto hover:bg-linha">
          {C.mostrarNovas}
        </button>
      )}
    </div>
  );
}
