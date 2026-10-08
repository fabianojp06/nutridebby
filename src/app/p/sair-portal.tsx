'use client';
import type { FormEvent } from 'react';
import { esquecerCartoesDoAparelho } from '@/components/portal/cartoes-dispensados';
import { esquecerPlanoGuardado } from '../sw-regras';
import { esquecerComprasDoAparelho } from './(portal)/compras/marcacao';

/** O "Sair" não espera mais que isto pela limpeza (rede lenta): sai do mesmo jeito. */
const PRAZO_LIMPEZA_MS = 2000;

/**
 * Review Focus 4: a inscrição de push deste aparelho sai do servidor (todos os vínculos, enquanto a sessão ainda vale) e
 * do navegador (`unsubscribe`: o endpoint morre no serviço de push). O Safari < 17 ignora o Clear-Site-Data do /sair,
 * que apagaria o registro do service worker — sem isto, os avisos seguiriam chegando no aparelho depois de sair.
 */
async function cancelarPushDoAparelho(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/p/');
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  // em paralelo: com rede lenta, o prazo de 2 s do "Sair" estoura antes do DELETE e o unsubscribe nem começaria
  // (keepalive: o DELETE continua depois de a página sair)
  await Promise.all([
    fetch('/api/p/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }), keepalive: true }).catch(() => undefined),
    sub.unsubscribe().catch(() => false),
  ]);
}

/**
 * D6 / Review Focus 4: antes de sair, apaga o plano guardado e as marcações da lista de compras (R14 (d): esquecerPlanoGuardado; o Clear-Site-Data da
 * resposta faz o mesmo, mas o Safari não o aplica a tudo) e cancela a inscrição de push. No máximo 2 s; falhar aqui
 * não impede de sair.
 */
export async function limparAparelho(): Promise<void> {
  esquecerComprasDoAparelho(); // síncrono: as marcações "comprado" (nomes de alimentos do plano)
  esquecerCartoesDoAparelho(); // RN-201: os cartões dispensados
  const tarefas = [esquecerPlanoGuardado(), cancelarPushDoAparelho().catch(() => undefined)];
  await Promise.race([Promise.all(tarefas), new Promise((r) => setTimeout(r, PRAZO_LIMPEZA_MS))]);
}

/** "Sair" do portal: o mesmo POST /sair do BotaoSair, depois de limpar o aparelho. */
export function SairPortal() {
  const sair = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await limparAparelho();
    } finally {
      form.submit(); // submit() não dispara onSubmit de novo
    }
  };
  return (
    <form method="post" action="/sair" onSubmit={sair}>
      <button type="submit" data-sair className="min-h-11 cursor-pointer rounded border border-current px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2">
        Sair
      </button>
    </form>
  );
}
