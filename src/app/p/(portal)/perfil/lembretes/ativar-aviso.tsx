'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import { ehIos } from '../../../instalacao';
import { Instalar, standalone } from '../../../instalar';
import { AtivarNotificacoes } from '../../../notificacoes';

const MOLDURA = 'space-y-2 rounded-2xl border border-borda bg-cartao p-3';
const semAssinatura = () => () => {};

// funções com nome (react/display-name): o cartão em volta do que AtivarNotificacoes/Instalar decidem mostrar
function CartaoDeNotificacoes(conteudo: ReactNode) {
  return (
    <section aria-label="Notificações" className={MOLDURA}>
      <p>Ative as notificações para receber os lembretes da sua nutricionista.</p>
      {conteudo}
    </section>
  );
}

function CartaoDoIphone(conteudo: ReactNode) {
  return (
    <section aria-label="Instalar o app" className={MOLDURA}>
      <p>Para receber os lembretes no iPhone, instale o app na tela inicial.</p>
      {conteudo}
    </section>
  );
}

/**
 * Plano 17 (Tarefa 6), no molde de CartoesDoAparelho: o pedido de notificações em Eu › Lembretes, só quando dá para ativar
 * ou quando a tentativa falhou (com `cartao`, AtivarNotificacoes não mostra nada com as notificações já ativas, bloqueadas
 * ou indisponíveis). No iPhone fora da tela inicial (onde o push não existe), os passos do Instalar; no Android o Instalar
 * não entra aqui (o cartão fala do iPhone, e as notificações funcionam sem instalar).
 */
export function AtivarAviso({ chavePublica, dono }: { chavePublica: string | null; dono: string }) {
  // o navegador só existe no cliente: no servidor e na hidratação, só o que AtivarNotificacoes decide (nada)
  const noCliente = useSyncExternalStore(semAssinatura, () => true, () => false);
  const iphoneSemInstalar = noCliente && ehIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) && !standalone();
  return (
    <>
      <AtivarNotificacoes chavePublica={chavePublica} dono={dono} cartao={CartaoDeNotificacoes} />
      {iphoneSemInstalar && <Instalar cartao={CartaoDoIphone} />}
    </>
  );
}
