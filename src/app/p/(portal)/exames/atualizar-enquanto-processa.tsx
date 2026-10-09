'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';

/**
 * Ritmo da consulta: a cada 5 s nos 3 primeiros minutos (o worker costuma terminar em segundos), depois a cada 30 s até
 * 30 min desde a montagem — o pior caso do job (um envio por vez na fila, 2 novas tentativas com 30 s de espera, 300 s de
 * prazo cada) e a varredura que marca "falhou" depois de 30 min.
 */
export const SITUACOES_RAPIDO_MS = 5000;
export const SITUACOES_RAPIDO_ATE_MS = 3 * 60_000;
export const SITUACOES_LENTO_MS = 30_000;
export const SITUACOES_MAX_MS = 30 * 60_000;

const abaOculta = () => document.visibilityState === 'hidden';

/** A mesma chave para o mesmo conjunto de ids, em qualquer ordem: o efeito do componente recomeça só quando o conjunto muda. */
export const chaveDosEnvios = (ids: readonly string[]): string => [...ids].sort().join(',');

type Opcoes = { buscar?: (url: string, init?: RequestInit) => Promise<Response>; oculta?: () => boolean; agora?: () => number };

/**
 * Consulta só a situação (`GET /api/p/exames/situacoes`, sem auditoria e sem renovar a sessão) dos envios em `processando`;
 * quando algum deles sai de "processando" (ou some da lista), chama `aoMudar` uma vez e para. Uma consulta de cada vez (a
 * próxima só é agendada depois da resposta); com a aba oculta o ciclo passa sem consultar. Devolve a função que para.
 */
export function acompanharEnvios(processando: readonly string[], aoMudar: () => void, o: Opcoes = {}): () => void {
  const { buscar = fetch, oculta = abaOculta, agora = Date.now } = o;
  const inicio = agora();
  let ativo = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const agendar = () => {
    if (!ativo) return;
    const passou = agora() - inicio;
    const espera = passou < SITUACOES_RAPIDO_ATE_MS ? SITUACOES_RAPIDO_MS : SITUACOES_LENTO_MS;
    if (passou + espera > SITUACOES_MAX_MS) return;
    timer = setTimeout(consultar, espera);
  };
  const consultar = async () => {
    if (!oculta()) {
      try {
        const r = await buscar('/api/p/exames/situacoes', CONSULTA_AUTOMATICA);
        if (ativo && r.ok) {
          const agoraNaLista = new Map(((await r.json()) as { id: string; status: string }[]).map((e) => [e.id, e.status]));
          if (ativo && processando.some((id) => agoraNaLista.get(id) !== 'processando')) {
            ativo = false;
            aoMudar();
            return;
          }
        }
      } catch {
        // sem rede: tenta no próximo ciclo
      }
    }
    agendar();
  };
  agendar();
  return () => {
    ativo = false;
    clearTimeout(timer);
  };
}

/**
 * Hotfix de 09/10/2026 (US-160): a página só monta este componente enquanto algum envio da lista está "Processando…" e
 * passa os ids deles. Ele acompanha a situação pela rota leve e, quando o worker termina, refaz a página uma única vez
 * (router.refresh: o formulário e a rolagem ficam; a lista relida grava o auditRead de `meusEnvios` uma vez). Se ainda
 * houver outro envio processando — ou se um envio novo entrou com o componente montado —, o conjunto de ids muda e o
 * acompanhamento recomeça do zero; sem nenhum, a página deixa de montá-lo. A troca é anunciada por AnunciarSituacoes.
 */
export function AtualizarEnquantoProcessa({ processando }: { processando: string[] }) {
  const router = useRouter();
  const chave = chaveDosEnvios(processando);
  useEffect(() => acompanharEnvios(chave.split(','), () => router.refresh()), [router, chave]);
  return null;
}
