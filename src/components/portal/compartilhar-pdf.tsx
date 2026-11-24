'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { linkDaRecusa, recusaDoPortal, type RecusaDoPortal } from '@/app/p/recusa-api';
import type { TipoDocumento } from '@/modules/documentos/constantes';
import { erroDoCompartilhar, faseDaResposta, jeitoDeEntregar, paginaDoLink, type FaseCompartilhar } from './compartilhar-pdf-estado';

/** Plano 22 (spec §6.2, US-380): os textos do "Compartilhar". `objeto` completa o nome acessível ("… a receita de 12/11/2026"). */
export const MSG_COMPARTILHAR = {
  preparar: 'Preparar para compartilhar',
  preparando: 'Preparando o PDF…',
  pronto: 'PDF pronto. Toque em Compartilhar.',
  compartilhar: 'Compartilhar',
  porTipo: { receita: 'Envie à farmácia que você escolher.', parecer: 'Envie a quem você escolher.', solicitacao_exames: 'Envie ao laboratório que você escolher.' } satisfies Record<TipoDocumento, string>,
  objeto: { receita: 'a receita', parecer: 'o parecer nutricional', solicitacao_exames: 'a solicitação de exames laboratoriais' } satisfies Record<TipoDocumento, string>,
  saude: 'O PDF tem dados da sua saúde. Envie só a quem você quiser que veja.',
  semSuporte: 'Este aparelho não consegue compartilhar o arquivo. O PDF foi baixado; envie pelo aplicativo que preferir.',
  venceu: 'O acesso venceu. Digite o código de novo.',
  falha: 'Não foi possível preparar o PDF. Tente de novo.',
} as const;

/**
 * A ação ao lado do "O acesso venceu…" (fora da spec, como o "Entrar" da recusa do portal; revisão da P22-11): a página do
 * link aberta não tem campo de código, e o texto também cobre o link expirado ou indisponível. Recarrega a página do link,
 * que decide entre pedir o código, o aviso de sempre ou o documento.
 */
export const DIGITAR_CODIGO = 'Digitar o código';

const TEXTO_DO_STATUS: Partial<Record<FaseCompartilhar, string>> = {
  preparando: MSG_COMPARTILHAR.preparando,
  pronto: MSG_COMPARTILHAR.pronto,
  baixado: MSG_COMPARTILHAR.semSuporte,
};

/**
 * O download quando o aparelho não compartilha arquivo: o PDF já está em memória (nenhuma leitura nova na rota). Devolve o
 * endereço `blob:`, que o componente solta no próximo download ou ao sair da tela (sem temporizador: a guarda da
 * consulta automática, `src/lib/consulta-automatica.test.ts`, não distingue um temporizador sem rede).
 */
function baixar(arquivo: File): string {
  const href = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = href;
  a.download = arquivo.name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  return href;
}

/**
 * Plano 22 (US-380, RN-396, EP-D24/EP-D25): o paciente manda o PDF assinado em vigor a quem ELE escolher, pelo compartilhar
 * do aparelho — a plataforma nunca envia nada nem grava registro novo. Dois passos, porque o compartilhar exige um toque
 * recente (o Safari perde a ativação depois de uma busca longa): "Preparar para compartilhar" busca o PDF uma vez pela rota
 * de sempre (`url`: a do portal ou a do link, que assinam a URL de 5 min e chamam o `auditRead` de hoje) e o guarda em
 * memória; "Compartilhar" chama `navigator.share` quando `canShare({ files })` aceita o arquivo, senão baixa. Região
 * `role="status"` sempre montada; o foco vai ao "Compartilhar" quando ele aparece; `AbortError` (fechou a folha) ignorado.
 */
export function CompartilharPdf({ url, tipo, data, nomeDoArquivo }: { url: string; tipo: TipoDocumento; data: string; nomeDoArquivo: string }) {
  const [fase, setFase] = useState<FaseCompartilhar>('inicial');
  const [pdf, setPdf] = useState<File | null>(null);
  const [recusa, setRecusa] = useState<RecusaDoPortal | null>(null);
  const botaoCompartilhar = useRef<HTMLButtonElement>(null);
  const focoNoCompartilhar = useRef(false);
  const busca = useRef<AbortController | null>(null);
  const baixado = useRef<string | null>(null);
  const idTexto = useId();
  const doDocumento = ` ${MSG_COMPARTILHAR.objeto[tipo]} de ${data}`;

  useEffect(() => {
    if (focoNoCompartilhar.current && pdf) {
      focoNoCompartilhar.current = false;
      botaoCompartilhar.current?.focus();
    }
  }, [pdf]);
  useEffect(
    () => () => {
      busca.current?.abort();
      if (baixado.current) URL.revokeObjectURL(baixado.current);
    },
    [],
  );

  async function preparar() {
    if (fase === 'preparando') return;
    setFase('preparando');
    setRecusa(null);
    const controle = new AbortController();
    busca.current = controle;
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controle.signal });
      const resultado = faseDaResposta({ ok: r.ok, status: r.status, contentType: r.headers.get('content-type') }, url);
      if (resultado !== 'pronto') {
        if (resultado === 'recusa') setRecusa(recusaDoPortal(r.status, await r.json().catch(() => null), location.pathname));
        setFase(resultado);
        return;
      }
      const conteudo = await r.blob();
      focoNoCompartilhar.current = true;
      setPdf(new File([conteudo], nomeDoArquivo, { type: 'application/pdf' }));
      setFase('pronto');
    } catch {
      if (!controle.signal.aborted) setFase('falha');
    }
  }

  async function compartilhar() {
    if (!pdf) return;
    const files = [pdf];
    if (jeitoDeEntregar(navigator, files) === 'baixar') {
      if (baixado.current) URL.revokeObjectURL(baixado.current);
      baixado.current = baixar(pdf);
      setFase('baixado');
      return;
    }
    try {
      await navigator.share({ files });
      setFase('pronto');
    } catch (e) {
      setFase(erroDoCompartilhar(e) ?? 'pronto');
    }
  }

  const erro = fase === 'venceu' ? MSG_COMPARTILHAR.venceu : fase === 'recusa' ? (recusa?.mensagem ?? MSG_COMPARTILHAR.falha) : fase === 'falha' ? MSG_COMPARTILHAR.falha : null;
  const paginaVencida = fase === 'venceu' ? paginaDoLink(url) : null;
  const link = fase === 'recusa' ? linkDaRecusa(recusa) : paginaVencida ? { href: paginaVencida, texto: DIGITAR_CODIGO } : null;
  return (
    <div className="space-y-2">
      <p id={idTexto} className="text-sm">{`${MSG_COMPARTILHAR.porTipo[tipo]} ${MSG_COMPARTILHAR.saude}`}</p>
      {pdf ? (
        <button
          ref={botaoCompartilhar}
          type="button"
          onClick={compartilhar}
          aria-describedby={idTexto}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white"
        >
          {MSG_COMPARTILHAR.compartilhar}
          <span className="sr-only">{doDocumento}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={preparar}
          disabled={fase === 'preparando'}
          aria-describedby={idTexto}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-current px-5 font-semibold disabled:opacity-60"
        >
          {fase === 'preparando' ? (
            MSG_COMPARTILHAR.preparando
          ) : (
            <>
              {MSG_COMPARTILHAR.preparar}
              <span className="sr-only">{doDocumento}</span>
            </>
          )}
        </button>
      )}
      <p role="status" className="text-sm">{TEXTO_DO_STATUS[fase] ?? ''}</p>
      {erro && (
        <p role="alert" className="text-sm text-erro">
          {erro}
          {link && (
            <>
              {' '}
              <a href={link.href} className="inline-flex min-h-11 items-center underline">{link.texto}</a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
