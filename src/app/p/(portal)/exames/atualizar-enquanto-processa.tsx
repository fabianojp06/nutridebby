'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** A cada 5 s, no máximo 36 vezes (3 min com a aba à vista): o worker termina em segundos; depois disso, só recarregando. */
export const ATUALIZAR_ENVIOS_MS = 5000;
export const ATUALIZAR_ENVIOS_MAX = 36;

const abaOculta = () => document.visibilityState === 'hidden';

/**
 * Agenda `atualizar` a cada ATUALIZAR_ENVIOS_MS até ATUALIZAR_ENVIOS_MAX vezes; com a aba oculta o ciclo passa em branco
 * (nem atualiza nem gasta o teto). Devolve a função que para (desmontagem do componente).
 */
export function atualizarEnquantoProcessa(atualizar: () => void, oculta: () => boolean = abaOculta): () => void {
  let feitas = 0;
  const t = setInterval(() => {
    if (oculta()) return;
    atualizar();
    if (++feitas >= ATUALIZAR_ENVIOS_MAX) clearInterval(t);
  }, ATUALIZAR_ENVIOS_MS);
  return () => clearInterval(t);
}

/**
 * Hotfix de 09/10/2026 (US-160): a página só monta este componente enquanto algum envio da lista está "Processando…";
 * ele refaz a página (router.refresh: o estado do formulário e a rolagem ficam) até o worker terminar — quando nenhum
 * envio processa mais, a página deixa de montá-lo e o temporizador para. A troca da situação é anunciada pela própria
 * linha da lista (role="status" na page.tsx); aqui nada é desenhado. Cada refresh relê a lista (auditRead de
 * `meusEnvios`), por isso o teto.
 */
export function AtualizarEnquantoProcessa() {
  const router = useRouter();
  useEffect(() => atualizarEnquantoProcessa(() => router.refresh()), [router]);
  return null;
}
