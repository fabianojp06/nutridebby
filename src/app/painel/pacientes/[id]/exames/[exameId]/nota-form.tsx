'use client';

import { useActionState, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Dialogo } from '@/components/dialogo';
import { focarPrimeiroErro } from '@/components/focar-primeiro-erro';
import { Botao } from '@/components/ui/botao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { apagarNotaAction, salvarNotaAction, type NotaState } from './actions';

const N = MSG_EXAMES.nota;

export type ModeloDeNota = { rotulo: string; texto: string };

/**
 * Plano 22 (T5a, US-373, RN-375, RN-383, EP-D18, EP-D19): "Nota de interpretação" — a linha fixa acima do campo, a ajuda
 * honesta ("Não aparece no app; entra na cópia dos dados que o paciente pedir.", EP-D19), "Inserir modelo", "Salvar nota" e
 * "Apagar nota" (só com nota em vigor). O texto digitado volta ao campo depois de um erro (`valores`, `key`) e o foco vai ao
 * erro. "Inserir modelo" lista os modelos dos exames fora da faixa do laudo que casam com o catálogo; o escolhido entra na
 * posição do cursor e o foco volta ao campo. O diálogo vai para fora do `<form>` por `createPortal` (contrato do `Dialogo`).
 */
export function NotaForm({ patientId, exameId, texto, modelos }: { patientId: string; exameId: string; texto: string | null; modelos: ModeloDeNota[] }) {
  const [salvo, salvar, salvando] = useActionState<NotaState, FormData>(salvarNotaAction.bind(null, patientId, exameId), {});
  const [apagado, apagar, apagando] = useActionState<NotaState, FormData>(apagarNotaAction.bind(null, patientId, exameId), {});
  // o retorno mais recente das duas actions
  const estado = (apagado.envio ?? 0) > (salvo.envio ?? 0) ? apagado : salvo;
  const erros = estado.erros ?? {};
  const ocupado = salvando || apagando;
  const form = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (estado.envio) focarPrimeiroErro(form.current);
  }, [estado.envio]);

  const descritos = ['nota-linha-fixa', 'nota-ajuda', ...(erros.texto ? ['nota-texto-erro'] : [])].join(' ');
  return (
    <form ref={form} action={salvar} className="space-y-3">
      <p id="nota-linha-fixa" className="font-medium">
        {N.linhaFixa}
      </p>
      <div className="space-y-1">
        <label htmlFor="nota-texto" className="block font-medium">
          {N.titulo}
        </label>
        <p id="nota-ajuda" className="text-sm text-suave">
          {N.ajuda}
        </p>
        <textarea
          ref={campo}
          key={estado.envio ?? 0}
          id="nota-texto"
          name="texto"
          rows={6}
          defaultValue={estado.valores?.texto ?? texto ?? ''}
          aria-invalid={erros.texto ? true : undefined}
          aria-describedby={descritos}
          className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
        />
        {erros.texto && (
          <p id="nota-texto-erro" role="alert" className="text-sm text-erro">
            {erros.texto}
          </p>
        )}
      </div>
      {erros.geral && (
        <p id="nota-geral-erro" role="alert" tabIndex={-1} className="text-sm text-erro">
          {erros.geral}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <InserirModelo modelos={modelos} campo={campo} />
        <Botao
          type="submit"
          aria-disabled={ocupado || undefined}
          onClick={(e) => {
            if (ocupado) e.preventDefault(); // sem disabled: o foco não sai do botão enquanto salva
          }}
          className="aria-disabled:opacity-60"
        >
          {N.salvar}
        </Botao>
        {texto !== null && (
          <Botao
            type="submit"
            variante="secundario"
            formAction={apagar}
            aria-disabled={ocupado || undefined}
            onClick={(e) => {
              if (ocupado) e.preventDefault();
            }}
            className="aria-disabled:opacity-60"
          >
            {N.apagar}
          </Botao>
        )}
      </div>
    </form>
  );
}

/** "Inserir modelo": o `Dialogo` com a lista "{exame} — abaixo"/"{exame} — acima"; vazio → "Nenhum modelo para os exames fora da referência.". */
function InserirModelo({ modelos, campo }: { modelos: ModeloDeNota[]; campo: RefObject<HTMLTextAreaElement | null> }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const fechar = () => setDestino(null);
  const inserir = (texto: string) => {
    const ta = campo.current;
    if (ta) {
      // na posição do cursor (ou no lugar da seleção); o campo guarda a seleção mesmo sem o foco
      ta.setRangeText(texto, ta.selectionStart, ta.selectionEnd, 'end');
    }
    fechar();
    // depois de o diálogo devolver o foco ao botão: o campo, com o cursor logo depois do texto inserido
    window.setTimeout(() => ta?.focus(), 0);
  };
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(e.currentTarget.closest<HTMLElement>('[data-tema]') ?? document.body)}>
        {N.inserirModelo}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo aberto titulo={N.inserirModelo} aoFechar={fechar}>
            {modelos.length === 0 ? (
              <p>{N.semModelo}</p>
            ) : (
              <ul className="space-y-2">
                {modelos.map((m) => (
                  <li key={m.rotulo}>
                    <Botao type="button" variante="secundario" className="w-full justify-start text-left" onClick={() => inserir(m.texto)}>
                      {m.rotulo}
                    </Botao>
                  </li>
                ))}
              </ul>
            )}
          </Dialogo>,
          destino,
        )}
    </>
  );
}
