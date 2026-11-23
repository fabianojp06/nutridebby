'use client';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { MSG_MENSAGENS, SITUACAO_INTERVALO_MS, SITUACAO_INTERVALO_OCIOSO_MS, SITUACAO_OCIOSO_APOS_MS } from '@/modules/mensagens/constantes';

const C = MSG_MENSAGENS.conversa;

export type Situacao = { novas: number; ultimaLida: string | null };

/** RN-452: a rota leve da situação (o paciente e o id da última mensagem mostrada; vazio = a tela não tinha mensagens). */
export const urlDaSituacao = (patientId: string, depois: string | null): string =>
  `/api/painel/mensagens/situacao?paciente=${encodeURIComponent(patientId)}&depois=${encodeURIComponent(depois ?? '')}`;

/** US-441: o texto da região viva quando chegam mensagens do paciente com a tela aberta. */
export const avisoDeNovas = (novas: number, primeiroNome: string): string => (novas > 0 ? C.novaMensagemDe(primeiroNome) : '');

/** Depois do toque em "Mostrar novas mensagens": a mensagem seguinte à última que estava na tela (o alvo do foco). */
export function primeiraNovaDepois(ids: readonly string[], depois: string | null): string | null {
  if (depois === null) return ids[0] ?? null;
  const i = ids.indexOf(depois);
  if (i < 0) return ids[0] ?? null; // a última mostrada saiu da janela das 50
  return ids[i + 1] ?? null;
}

type Opcoes = {
  buscar?: (url: string, init?: RequestInit) => Promise<Response>;
  oculta?: () => boolean;
  semRede?: () => boolean;
  agora?: () => number;
  documento?: EventTarget;
  janela?: EventTarget;
};

/**
 * RN-452 e RNF-441: consulta "há novas?" a cada 15 s com a aba visível; depois de 5 min sem interação (tecla, toque,
 * rolagem), a cada 60 s, e uma interação volta aos 15 s. Com a aba escondida ou sem rede, nada fica agendado; ao ficar
 * visível ou reconectar, consulta na hora. Um temporizador só e uma consulta de cada vez. Só `novas` e `ultimaLida`
 * passam adiante (nunca outra chave do corpo). Devolve a função que para (temporizador e ouvintes).
 */
export function acompanharSituacao(url: string, aoMudar: (s: Situacao) => void, o: Opcoes = {}): () => void {
  const {
    buscar = fetch,
    oculta = () => document.visibilityState === 'hidden',
    semRede = () => navigator.onLine === false,
    agora = Date.now,
    documento = document,
    janela = window,
  } = o;
  let ativo = true;
  let emCurso = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lento = false;
  let ultimaInteracao = agora();
  const pode = () => ativo && !oculta() && !semRede();
  const pausar = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const agendar = () => {
    pausar();
    if (!pode()) return;
    lento = agora() - ultimaInteracao >= SITUACAO_OCIOSO_APOS_MS;
    timer = setTimeout(consultar, lento ? SITUACAO_INTERVALO_OCIOSO_MS : SITUACAO_INTERVALO_MS);
  };
  async function consultar() {
    timer = undefined;
    if (!pode()) return;
    emCurso = true;
    try {
      const r = await buscar(url, CONSULTA_AUTOMATICA);
      if (ativo && r.ok) {
        const c = (await r.json()) as { novas?: unknown; ultimaLida?: unknown } | null;
        const novas = c?.novas;
        const ultimaLida = c?.ultimaLida;
        if (ativo && typeof novas === 'number' && Number.isInteger(novas) && novas >= 0 && (ultimaLida === null || typeof ultimaLida === 'string'))
          aoMudar({ novas, ultimaLida });
      }
    } catch {
      // sem rede ou corpo inválido: tenta no ciclo seguinte
    } finally {
      emCurso = false;
    }
    agendar();
  }
  const aoMudarVisibilidade = () => {
    if (!pode()) pausar();
    else if (timer === undefined && !emCurso) void consultar();
  };
  const aoInteragir = () => {
    ultimaInteracao = agora();
    if (lento && timer !== undefined) agendar(); // estava no ritmo lento: volta aos 15 s
  };
  const INTERACOES = ['keydown', 'pointerdown', 'scroll'];
  documento.addEventListener('visibilitychange', aoMudarVisibilidade);
  janela.addEventListener('online', aoMudarVisibilidade);
  janela.addEventListener('offline', aoMudarVisibilidade);
  for (const e of INTERACOES) documento.addEventListener(e, aoInteragir, { passive: true });
  agendar();
  return () => {
    ativo = false;
    pausar();
    documento.removeEventListener('visibilitychange', aoMudarVisibilidade);
    janela.removeEventListener('online', aoMudarVisibilidade);
    janela.removeEventListener('offline', aoMudarVisibilidade);
    for (const e of INTERACOES) documento.removeEventListener(e, aoInteragir);
  };
}

/**
 * Rodada da T6b (C1): o "Lida" só avança. Entre o do servidor (o render) e o da consulta, fica o que estiver mais adiante
 * nas próprias mensagens da tela; um que não está na tela não conta. Puro (o mesmo padrão do número do menu, revisão da T6a).
 */
export function lidaMaisAdiante(minhas: readonly string[], doServidor: string | null, consultada: string | null): string | null {
  const i = doServidor === null ? -1 : minhas.indexOf(doServidor);
  const j = consultada === null ? -1 : minhas.indexOf(consultada);
  if (j > i) return consultada;
  return doServidor;
}

/** As novas da consulta valem só para a última mensagem que estava na tela quando ela respondeu (o refresh as zera). */
export const novasNaTela = (consulta: { de: string | null; n: number } | null, depois: string | null): number => (consulta && consulta.de === depois ? consulta.n : 0);

/**
 * O texto da região viva: "Nova mensagem de {nome}." com novas; senão, o retorno `?ok=`/`?erro=` — menos o que já ficou
 * para trás num "Mostrar novas mensagens" (`avisoVisto`). Um ato novo (pausar depois de liberar) é outro texto e é anunciado.
 */
export function textoDaRegiao(o: { novas: number; primeiroNome: string; aviso: string; avisoVisto: string | null }): string {
  if (o.novas > 0) return avisoDeNovas(o.novas, o.primeiroNome);
  return o.aviso === o.avisoVisto ? '' : o.aviso;
}

/** O "Lida" do render e o atualizado pela consulta (RN-448): as próprias mensagens mostradas, em ordem, e a última lida. */
type Leitura = { minhas: readonly string[]; ultimaLida: string | null; setConsultada: (id: string | null) => void };
const ContextoDaLeitura = createContext<Leitura>({ minhas: [], ultimaLida: null, setConsultada: () => undefined });

/**
 * Guarda o "Lida": o do servidor e o da consulta da situação, valendo o mais adiante (`lidaMaisAdiante`, derivado no
 * render — nunca a prop copiada para o estado). Sem `key` (rodada da T6b, C1): nada abaixo dele remonta quando a página
 * refaz, e o rascunho, o foco e a região viva ficam.
 */
export function ProvedorDaLeitura({ minhas, ultimaLida, children }: { minhas: readonly string[]; ultimaLida: string | null; children?: ReactNode }) {
  const [consultada, setConsultada] = useState<string | null>(null);
  const valor = { minhas, ultimaLida: lidaMaisAdiante(minhas, ultimaLida, consultada), setConsultada };
  return <ContextoDaLeitura.Provider value={valor}>{children}</ContextoDaLeitura.Provider>;
}

/**
 * RN-448: "Lida" na última mensagem própria que o paciente já passou; "Enviada" nas próprias depois dela (ou em todas,
 * quando a lida não está na página); nada nas anteriores à lida.
 */
export function EstadoDaMinha({ id }: { id: string }) {
  const { minhas, ultimaLida } = useContext(ContextoDaLeitura);
  const i = minhas.indexOf(id);
  const j = ultimaLida === null ? -1 : minhas.indexOf(ultimaLida);
  if (i < 0) return null;
  if (j >= 0 && i < j) return null;
  return <span className="text-xs text-suave">{i === j ? C.lida : C.enviada}</span>;
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
