'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { CONTADOR_INTERVALO_MS } from '@/modules/mensagens/constantes';

/** Plano 25 (RN-459): a consulta leve do contador do menu (só `{ n }`, sem auditRead, sem renovar a sessão). */
export const URL_DO_CONTADOR = '/api/painel/mensagens/contador';

type Opcoes = {
  buscar?: (url: string, init?: RequestInit) => Promise<Response>;
  oculta?: () => boolean;
  semRede?: () => boolean;
  /** Onde ouvir `visibilitychange` (o `document`) e `online`/`offline` (a `window`); injetáveis nos testes. */
  documento?: EventTarget;
  janela?: EventTarget;
  /** Consulta já ao começar (troca de rota: a tela que abriu pode ter lido mensagens), em vez de esperar 60 s. */
  imediata?: boolean;
};

/**
 * RN-459 (CH-D43): o layout do painel não refaz na navegação pelo cliente, então o número do item "Mensagens" é
 * atualizado por esta consulta a cada 60 s, só com a aba visível e com rede (RNF-441). Com a aba escondida ou sem rede,
 * nada fica agendado; ao ficar visível ou ao reconectar, consulta na hora e volta ao ritmo. Um temporizador só e uma
 * consulta de cada vez (a próxima só é agendada depois da resposta). Erro de rede ou resposta recusada: o número fica e a
 * próxima tentativa é no ciclo seguinte. `imediata`: a primeira consulta sai na hora. Devolve a função que para.
 */
export function acompanharContador(aoContar: (n: number) => void, o: Opcoes = {}): () => void {
  const {
    buscar = fetch,
    oculta = () => document.visibilityState === 'hidden',
    semRede = () => navigator.onLine === false,
    documento = document,
    janela = window,
  } = o;
  let ativo = true;
  let emCurso = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pode = () => ativo && !oculta() && !semRede();
  const parado = () => timer === undefined && !emCurso;
  const pausar = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const agendar = () => {
    pausar();
    if (pode()) timer = setTimeout(consultar, CONTADOR_INTERVALO_MS);
  };
  async function consultar() {
    timer = undefined;
    if (!pode()) return; // espera o "visível" ou o "online"
    emCurso = true;
    try {
      const r = await buscar(URL_DO_CONTADOR, CONSULTA_AUTOMATICA);
      if (ativo && r.ok) {
        const corpo: unknown = await r.json();
        const n = (corpo as { n?: unknown } | null)?.n;
        if (ativo && typeof n === 'number' && Number.isInteger(n) && n >= 0) aoContar(n);
      }
    } catch {
      // sem rede ou corpo inválido: tenta no próximo ciclo
    } finally {
      emCurso = false;
    }
    agendar();
  }
  const aoMudar = () => {
    if (!pode()) pausar();
    else if (parado()) void consultar();
  };
  documento.addEventListener('visibilitychange', aoMudar);
  janela.addEventListener('online', aoMudar);
  janela.addEventListener('offline', aoMudar);
  if (o.imediata && pode()) void consultar();
  else agendar();
  return () => {
    ativo = false;
    pausar();
    documento.removeEventListener('visibilitychange', aoMudar);
    janela.removeEventListener('online', aoMudar);
    janela.removeEventListener('offline', aoMudar);
  };
}

/** O número que vale: o da consulta, se ela veio depois DESTE payload do layout; senão, o do layout. */
export function numeroDoMenu<T extends { pendentes: number }>(doLayout: T, consultado: { de: T; n: number } | null): number {
  return consultado && consultado.de === doLayout ? consultado.n : doLayout.pendentes;
}

/**
 * O número do item "Mensagens" do menu: o do layout (render do servidor) até a primeira consulta. Revisão da T6a (I1): a
 * consulta fica amarrada à identidade do payload do layout (`doLayout`, um objeto novo a cada render do servidor), não ao
 * valor — quando o layout refaz (revalidatePath depois de ler, enviar ou marcar), o número dele volta a valer mesmo que
 * seja igual ao de antes. E a troca de rota consulta na hora (abrir a conversa pela navegação do cliente lê mensagens sem
 * refazer o layout). Sem região viva: só o texto do item muda (RN-459).
 */
export function useContadorDeMensagens<T extends { mostrar: boolean; pendentes: number }>(doLayout: T): number {
  const caminho = usePathname();
  const primeiro = useRef(caminho);
  const [consultado, setConsultado] = useState<{ de: T; n: number } | null>(null);
  const ativo = doLayout.mostrar;
  useEffect(() => {
    if (!ativo) return undefined;
    const imediata = caminho !== primeiro.current;
    primeiro.current = caminho;
    return acompanharContador((n) => setConsultado({ de: doLayout, n }), { imediata });
  }, [ativo, doLayout, caminho]);
  return numeroDoMenu(doLayout, consultado);
}
