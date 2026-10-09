'use client';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ehIos } from './instalacao';
import { standalone } from './instalar';
import { linkDaRecusa, recusaDoPortal, type RecusaDoPortal } from './recusa-api';

type Estado = 'carregando' | 'indisponivel' | 'instale' | 'pode' | 'ativo' | 'negado' | 'falhou';
// Os textos de MSG_PUSH (src/modules/portal/push-inscricao.ts), que é do servidor
const TEXTO: Partial<Record<Estado, string>> = {
  indisponivel: 'Notificações no app ainda não estão disponíveis.',
  ativo: 'Notificações ativadas neste aparelho.',
  negado: 'Você bloqueou as notificações. Para ativar, mude a permissão do site nas configurações do navegador.',
  falhou: 'Não foi possível ativar as notificações. Tente de novo.',
};

/** base64url → bytes (applicationServerKey). */
function bytesDaChave(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const temPush = () => 'serviceWorker' in navigator && 'PushManager' in window;
const enviarInscricao = (sub: PushSubscription, query = '') =>
  fetch(`/api/p/push${query}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });

const sincronias = new Map<string, Promise<'ativo' | 'sem_inscricao'>>();

/**
 * Review Focus 4 (aparelho compartilhado): a inscrição que o navegador já tem pode ser de OUTRA conta (A ativou, a sessão
 * expirou, B entrou). Ela nunca vale como "ativo" só por existir: vai ao servidor, que tira o endpoint das outras contas
 * e diz se ele já era desta (204 → vínculos novos ganham a linha) ou não (409 → descartada aqui; B ativa se quiser).
 * Uma vez por carga do portal e dono (`dono` = paciente da sessão: trocar de conta ou de vínculo sincroniza de novo).
 */
export function sincronizarAparelho(dono: string): Promise<'ativo' | 'sem_inscricao'> {
  let p = sincronias.get(dono);
  if (!p) {
    p = (async () => {
      if (!temPush()) return 'sem_inscricao' as const;
      const reg = await navigator.serviceWorker.getRegistration('/p/');
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return 'sem_inscricao' as const;
      const r = await enviarInscricao(sub, '?sincronizar=1');
      if (r.status === 409) {
        await sub.unsubscribe().catch(() => false); // o endpoint morre no serviço de push: nada mais chega por ele
        return 'sem_inscricao' as const;
      }
      return r.ok ? ('ativo' as const) : ('sem_inscricao' as const);
    })().catch(() => 'sem_inscricao' as const);
    sincronias.set(dono, p);
  }
  return p;
}

/**
 * US-040 "Permissão de push". No iPhone, só depois de instalado (o tutorial da Tarefa 5 cobre antes). Plano 16: `cartao`
 * embrulha o conteúdo (o cartão de Hoje, RN-201).
 */
export function AtivarNotificacoes({ chavePublica, dono, cartao }: { chavePublica: string | null; dono: string; cartao?: (conteudo: ReactNode) => ReactNode }) {
  const [estado, setEstado] = useState<Estado>('carregando');
  /** A pessoa tocou em "Ativar notificações" nesta tela: o cartão fica com o resultado até a próxima abertura. */
  const [agiu, setAgiu] = useState(false);
  /** Recusa da sessão ao ativar (401/403 `{ erro }`): a mensagem do servidor (e o link do login ou da escolha) no lugar do "Tente de novo" genérico. */
  const [recusa, setRecusa] = useState<RecusaDoPortal | null>(null);
  /** O resultado depois de agir: o botão sai do DOM e o foco viria ao <body>; vai para a frase que diz o que aconteceu. */
  const aviso = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (agiu && (estado === 'ativo' || estado === 'negado')) aviso.current?.focus();
  }, [agiu, estado]);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      let e: Estado;
      if (ehIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) && !standalone()) e = 'instale';
      else if (!chavePublica || !temPush()) e = 'indisponivel';
      else if (Notification.permission === 'denied') e = 'negado';
      // "ativo" só com o servidor confirmando que a inscrição é desta conta (nunca só porque o navegador tem uma)
      else e = (await sincronizarAparelho(dono)) === 'ativo' ? 'ativo' : 'pode';
      if (vivo) setEstado(e);
    })();
    return () => {
      vivo = false;
    };
  }, [chavePublica, dono]);
  const ativar = async () => {
    setAgiu(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setEstado('negado');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(chavePublica!) });
      const r = await enviarInscricao(sub);
      if (r.ok) sincronias.set(dono, Promise.resolve('ativo')); // a próxima tela não pergunta de novo
      setRecusa(r.ok ? null : recusaDoPortal(r.status, await r.json().catch(() => null), location.pathname));
      setEstado(r.ok ? 'ativo' : 'falhou');
    } catch {
      setEstado('falhou');
    }
  };
  if (estado === 'carregando' || estado === 'instale') return null;
  // Plano 16 (RN-201): no mural, o cartão só aparece quando dá para ativar (ou a tentativa falhou); depois de agir nesta
  // tela, fica até a próxima abertura, com o resultado (ativo/negado) anunciado pela região viva de sempre
  if (cartao && !agiu && estado !== 'pode' && estado !== 'falhou') return null;
  const conteudo = <PainelDeNotificacoes estado={estado} recusa={recusa} aoAtivar={ativar} aviso={aviso} />;
  return cartao ? cartao(conteudo) : conteudo;
}

/**
 * O que AtivarNotificacoes mostra em cada estado (exportado para o teste). Correção da revisão da T10 (RNF-191, como o
 * ConfirmarNoMural): a região role="status" está SEMPRE montada e só o texto muda — o resultado de "Ativar notificações"
 * entra numa região que já existia e é anunciado; o "falhou" continua em role="alert", com o botão para tentar de novo.
 */
export function PainelDeNotificacoes({
  estado,
  recusa,
  aoAtivar,
  aviso,
}: {
  estado: Exclude<Estado, 'carregando' | 'instale'>;
  recusa: RecusaDoPortal | null;
  aoAtivar: () => void;
  aviso?: RefObject<HTMLParagraphElement | null>;
}) {
  const link = linkDaRecusa(recusa);
  return (
    <div className="space-y-2">
      {(estado === 'pode' || estado === 'falhou') && (
        <button type="button" onClick={aoAtivar} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">
          Ativar notificações
        </button>
      )}
      {estado === 'falhou' && (
        <p role="alert">
          {recusa ? recusa.mensagem : TEXTO.falhou}
          {link && (
            <>
              {' '}
              <a href={link.href} className="inline-flex min-h-11 items-center underline">{link.texto}</a>
            </>
          )}
        </p>
      )}
      <p ref={aviso} tabIndex={-1} role="status">{estado === 'falhou' ? '' : (TEXTO[estado] ?? '')}</p>
    </div>
  );
}
