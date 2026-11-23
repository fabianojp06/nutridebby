/**
 * Plano 25 (RN-448, RN-452, RNF-441): as peças puras da conversa que o painel (T6b) e o portal (T7) dividem — a consulta
 * "há novas?" com o ritmo de 15 s/60 s, o "Lida" que só avança e o alvo do foco depois de "Mostrar novas mensagens". Sem
 * import de servidor (os componentes 'use client' dos dois lados importam daqui).
 */
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { SITUACAO_INTERVALO_MS, SITUACAO_INTERVALO_OCIOSO_MS, SITUACAO_OCIOSO_APOS_MS } from '@/modules/mensagens/constantes';

export type Situacao = { novas: number; ultimaLida: string | null };

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
