import { Fragment } from 'react';
import { lerMarcacao, type Trecho } from '@/modules/documentos/marcacao';

/** Os trechos de um parágrafo ou de um item de lista: o negrito em `<strong>`, o resto como texto (o React escapa). */
function Trechos({ trechos }: { trechos: Trecho[] }) {
  return trechos.map((t, i) => (t.negrito ? <strong key={i}>{t.texto}</strong> : <Fragment key={i}>{t.texto}</Fragment>));
}

/**
 * Plano 22 (RN-395, EP-D31, RNF-374): as orientações de um documento (receita e solicitação) a partir dos blocos de
 * `lerMarcacao` — `<p>`, `<ul>`/`<li>` e `<strong>`, montados como componentes; **nunca** HTML cru: `<`, `>`, `&`, tags e
 * links saem como texto. Sem `formato` (conteúdo de antes do Plano 22), texto puro com as quebras de linha. Sem
 * 'use client' e sem estado: serve à página do documento (servidor) e à prévia do editor (cliente).
 */
export function MarcacaoBlocos({ texto, formato }: { texto: string; formato?: 'marcacao' }) {
  if (formato !== 'marcacao') return <p className="whitespace-pre-line">{texto}</p>;
  return (
    <div className="space-y-2">
      {lerMarcacao(texto).map((b, i) =>
        b.tipo === 'paragrafo' ? (
          <p key={i} className="whitespace-pre-line">
            <Trechos trechos={b.trechos} />
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.itens.map((item, j) => (
              <li key={j}>
                <Trechos trechos={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
