'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import type { FaixaDoConsultorio } from '@/db/schema/exames-catalogo';
import { referenciaDaFaixa, textoDaFaixaDoConsultorio } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';

const R = MSG_EXAMES.ref;
const SEM = '—';

export type ReferenciaDaLinha = {
  /**
   * O texto da referência do laudo. `undefined` = não mostrar "Referência do laudo" (no lançamento e na edição o campo está
   * à vista; o diálogo traz só a faixa digitada e as faixas do consultório).
   */
  referencia?: string | null;
  refMin?: number;
  refMax?: number;
  /** As faixas do exame do catálogo que casou com a linha; `[]` sem casamento. */
  faixas: FaixaDoConsultorio[];
  /** A unidade do exame do catálogo (os limites das faixas são nela). */
  unidadeDoCatalogo: string | null;
};

/**
 * Plano 22 (T5a, RN-382, EP-D17): o conteúdo de "Ver referência" — "Referência do laudo: {texto ou —}", "Faixa do laudo:
 * {faixa ou —}" e, se a linha casa com o catálogo, "Faixas do consultório" (público, idade, limites, categoria, fonte e
 * data); sem faixa do consultório, "Sem referência.". Só no painel (nunca no app, no PDF nem na exportação). Exportado à
 * parte para o teste de estrutura sem DOM (o diálogo só existe aberto).
 */
export function ConteudoDaReferencia({ referencia, refMin, refMax, faixas, unidadeDoCatalogo }: ReferenciaDaLinha) {
  return (
    <div className="space-y-3">
      {referencia !== undefined && <p className="wrap-break-word">{R.doLaudo(referencia?.trim() || SEM)}</p>}
      <p>{R.faixaDoLaudo(referenciaDaFaixa(refMin, refMax) ?? SEM)}</p>
      {faixas.length === 0 ? (
        <p>{R.semReferencia}</p>
      ) : (
        <section className="space-y-2">
          <h3 className="font-semibold">{R.faixasDoConsultorio}</h3>
          <ul className="space-y-2">
            {faixas.map((f, i) => {
              const t = textoDaFaixaDoConsultorio(f, unidadeDoCatalogo);
              return (
                <li key={i} className="wrap-break-word">
                  <p>{t.linha}</p>
                  <p className="text-sm text-suave">{t.fonte}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * O botão "Ver referência" de uma linha (nome acessível "Referência de {marcador}", que contém o texto visível) e o
 * `Dialogo` com o conteúdo. O diálogo vai para fora de qualquer `<form>` da tela por `createPortal`, no contêiner do tema,
 * e só existe aberto (contrato do `Dialogo`, EP-D42); fechar devolve o foco ao botão.
 */
export function VerReferencia({ marcador, ...referencia }: ReferenciaDaLinha & { marcador: string }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  return (
    <>
      <Botao type="button" variante="secundario" aria-label={R.rotulo(marcador)} onClick={(e) => setDestino(e.currentTarget.closest<HTMLElement>('[data-tema]') ?? document.body)}>
        {R.botao}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo aberto titulo={R.rotulo(marcador)} aoFechar={() => setDestino(null)}>
            <ConteudoDaReferencia {...referencia} />
          </Dialogo>,
          destino,
        )}
    </>
  );
}
