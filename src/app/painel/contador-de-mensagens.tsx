'use client';
import { useEffect, useState } from 'react';
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
};

/**
 * RN-459 (CH-D43): o layout do painel não refaz na navegação pelo cliente, então o número do item "Mensagens" é
 * atualizado por esta consulta a cada 60 s, só com a aba visível e com rede (RNF-441). Com a aba escondida ou sem rede,
 * nada fica agendado; ao ficar visível ou ao reconectar, consulta na hora e volta ao ritmo. Um temporizador só e uma
 * consulta de cada vez (a próxima só é agendada depois da resposta). Erro de rede ou resposta recusada: o número fica e a
 * próxima tentativa é no ciclo seguinte. Devolve a função que para (temporizador e ouvintes).
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
  agendar();
  return () => {
    ativo = false;
    pausar();
    documento.removeEventListener('visibilitychange', aoMudar);
    janela.removeEventListener('online', aoMudar);
    janela.removeEventListener('offline', aoMudar);
  };
}

/**
 * O número do item "Mensagens" do menu: o do layout (render do servidor) até a primeira consulta; quando o layout refaz
 * (revalidatePath depois de ler ou de enviar), o número dele volta a valer até a consulta seguinte. Sem região viva: só o
 * texto do item muda (RN-459). `ativo` = o item está no menu.
 */
export function useContadorDeMensagens(inicial: number, ativo: boolean): number {
  const [consultado, setConsultado] = useState<{ de: number; n: number } | null>(null);
  useEffect(() => (ativo ? acompanharContador((n) => setConsultado({ de: inicial, n })) : undefined), [ativo, inicial]);
  return consultado && consultado.de === inicial ? consultado.n : inicial;
}
