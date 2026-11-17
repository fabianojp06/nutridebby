'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { dispensado, dispensar } from '@/components/portal/cartoes-dispensados';
import { Instalar } from '../../instalar';
import { AtivarNotificacoes } from '../../notificacoes';

const CARTOES = {
  notificacoes: 'Ative as notificações para saber quando houver novidades.',
  instalar: 'Instale o app na tela inicial.',
} as const;
type Cartao = keyof typeof CARTOES;
const NOTIFICACOES_COM_LEMBRETES = 'Ative as notificações para receber os lembretes da sua nutricionista.';

/** O texto (e o nome) do cartão. Plano 17: com lembretes ligados, o de notificações fala deles; a chave de dispensa não muda. */
export function textoDoCartao(c: Cartao, comLembretes: boolean): string {
  return c === 'notificacoes' && comLembretes ? NOTIFICACOES_COM_LEMBRETES : CARTOES[c];
}
const semAssinatura = () => () => {};

/** Plano 16 (§4.3, RN-201): os cartões do aparelho no topo do mural, enquanto não feitos neste aparelho; "Agora não" esconde por 30 dias. */
export function CartoesDoAparelho({ conta, dono, chavePublica, comLembretes }: { conta: string; dono: string; chavePublica: string | null; comLembretes: boolean }) {
  // o localStorage só existe no cliente: no servidor e na hidratação, nenhum cartão
  const noCliente = useSyncExternalStore(semAssinatura, () => true, () => false);
  const [fechados, setFechados] = useState<ReadonlySet<Cartao>>(() => new Set());
  if (!noCliente) return null;
  const visivel = (c: Cartao) => !fechados.has(c) && !dispensado(conta, c);
  // função com nome (react/display-name): o cartão em volta do que AtivarNotificacoes/Instalar decidem mostrar
  const moldura = (c: Cartao) =>
    function MolduraDoCartao(conteudo: ReactNode) {
      return (
        <section aria-label={textoDoCartao(c, comLembretes)} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
          <p>{textoDoCartao(c, comLembretes)}</p>
          {conteudo}
          <button
            type="button"
            onClick={() => {
              dispensar(conta, c);
              setFechados((f) => new Set(f).add(c));
              // o botão sai do DOM com o cartão: o foco vai ao próximo ponto estável do mural, nunca ao <body>
              document.getElementById('ver-todo-diario')?.focus();
            }}
            className="min-h-11 px-2 text-link underline"
          >
            Agora não
          </button>
        </section>
      );
    };
  return (
    <>
      {visivel('notificacoes') && <AtivarNotificacoes chavePublica={chavePublica} dono={dono} cartao={moldura('notificacoes')} />}
      {visivel('instalar') && <Instalar cartao={moldura('instalar')} />}
    </>
  );
}
