'use client';

import { useRef, useState } from 'react';
import { MarcacaoBlocos } from '@/components/marcacao-blocos';

/** Plano 22 (RN-395, §6.2, rascunho para a Debby e o `revisor-interface`): os textos da barra de marcação. */
export const MSG_MARCACAO = {
  negrito: 'Negrito',
  lista: 'Lista',
  previa: 'Prévia',
  ajuda: 'Escreva ** antes e depois do trecho para negrito; comece a linha com um hífen para fazer lista.',
} as const;

const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const BOTAO = 'min-h-11 rounded-xl border border-borda px-3 font-medium';

/** "Negrito": `**` antes e depois da seleção (sem seleção, o par vazio com o cursor no meio). */
function comNegrito(v: string, ini: number, fim: number): { texto: string; ini: number; fim: number } {
  return { texto: `${v.slice(0, ini)}**${v.slice(ini, fim)}**${v.slice(fim)}`, ini: ini + 2, fim: fim + 2 };
}

/** "Lista": "- " no começo de cada linha da seleção que ainda não começa com ele. */
function comLista(v: string, ini: number, fim: number): { texto: string; ini: number; fim: number } {
  const comeco = v.lastIndexOf('\n', ini - 1) + 1;
  const quebra = v.indexOf('\n', fim);
  const final = quebra < 0 ? v.length : quebra;
  const linhas = v.slice(comeco, final).split('\n');
  const novas = linhas.map((l) => (l.startsWith('- ') ? l : `- ${l}`));
  const trecho = novas.join('\n');
  const somados = trecho.length - (final - comeco);
  return { texto: `${v.slice(0, comeco)}${trecho}${v.slice(final)}`, ini: ini + (novas[0] === linhas[0] ? 0 : 2), fim: fim + somados };
}

/**
 * Plano 22 (RN-395, EP-D31, US-378): o campo das orientações (receita e solicitação) com a marcação mínima — "Negrito" e
 * "Lista" só inserem a marcação no texto (nada de editor rico, C-379) — e a "Prévia", montada por `MarcacaoBlocos`
 * (componentes; nunca HTML cru). A ajuda da marcação fica ligada ao campo por `aria-describedby`, junto da ajuda própria
 * (`dica`) e do erro. Controlado por quem usa (o React 19 reseta campo não controlado depois de cada action).
 */
export function OrientacoesCampo({ id, rotulo, max, valor, aoMudar, dica, erro }: {
  id: string;
  rotulo: string;
  max: number;
  valor: string;
  aoMudar: (v: string) => void;
  dica?: string;
  erro?: string;
}) {
  const campo = useRef<HTMLTextAreaElement>(null);
  const [previa, setPrevia] = useState(false);
  const aplicar = (f: typeof comNegrito) => {
    const ta = campo.current;
    if (!ta) return;
    const r = f(valor, ta.selectionStart, ta.selectionEnd);
    if (r.texto.length > max) return ta.focus(); // passaria do limite: nada muda (o servidor também recusa)
    aoMudar(r.texto);
    // depois de o React gravar o valor novo: o cursor (ou a seleção) volta ao trecho marcado
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.ini, r.fim);
    });
  };
  const descr = [dica ? `${id}-dica` : null, `${id}-marcacao`, erro ? `${id}-erro` : null].filter(Boolean).join(' ');
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {rotulo}
      </label>
      {dica && (
        <p id={`${id}-dica`} className="text-sm text-suave">
          {dica}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${BOTAO} font-bold`} aria-controls={id} onClick={() => aplicar(comNegrito)}>
          {MSG_MARCACAO.negrito}
        </button>
        <button type="button" className={BOTAO} aria-controls={id} onClick={() => aplicar(comLista)}>
          {MSG_MARCACAO.lista}
        </button>
        <button type="button" className={BOTAO} aria-expanded={previa} aria-controls={`${id}-previa`} onClick={() => setPrevia((p) => !p)}>
          {MSG_MARCACAO.previa}
        </button>
      </div>
      <p id={`${id}-marcacao`} className="text-sm text-suave">
        {MSG_MARCACAO.ajuda}
      </p>
      <textarea
        ref={campo}
        id={id}
        rows={4}
        maxLength={max}
        value={valor}
        onChange={(ev) => aoMudar(ev.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descr}
        className={CAMPO}
      />
      {erro && (
        <p id={`${id}-erro`} role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}
      <div id={`${id}-previa`} hidden={!previa} className="rounded-xl border border-borda bg-fundo p-3">
        {previa && <MarcacaoBlocos texto={valor} formato="marcacao" />}
      </div>
    </div>
  );
}
