'use client';
import { useEffect } from 'react';

/**
 * Plano 16 (§4.8, US-193 "Offline"): sem rede, toda navegação em /p/ cai na cópia de /p/plano (o service worker não muda).
 * Aberta pelo endereço de uma refeição (/p/plano/refeicao/<id>), a cópia abre essa refeição na sanfona (e "Ver outros dias",
 * se ela é de outro dia) e rola até ela.
 */
export function AbrirRefeicaoDaUrl() {
  useEffect(() => {
    const id = /^\/p\/plano\/refeicao\/([0-9a-f-]{36})$/.exec(location.pathname)?.[1];
    const alvo = id ? document.getElementById(`ref-${id}`) : null;
    if (alvo instanceof HTMLDetailsElement) {
      // Plano 19: a refeição de outro dia fica dentro de "Ver outros dias" — abre também o <details> de fora
      for (let d: Element | null = alvo; d; d = d.parentElement?.closest('details') ?? null) if (d instanceof HTMLDetailsElement) d.open = true;
      alvo.scrollIntoView({ block: 'start' });
    }
  }, []);
  return null;
}
