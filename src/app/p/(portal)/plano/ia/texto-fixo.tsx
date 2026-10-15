import { Fragment } from 'react';
import { TEXTOS_FIXOS, type CodigoTextoFixo } from '@/modules/ia/nutri-paciente/textos';

/** Os textos fixos que citam o SAMU e o CVV (US-173): os números viram links `tel:` no celular. */
const COM_TELEFONE: ReadonlySet<CodigoTextoFixo> = new Set(['risco_emergencia', 'sintoma_agudo', 'risco_transtorno']);

/**
 * RNF-167: só "188" e "192" (números inteiros, nunca parte de outro) viram `<a href="tel:…">`; o resto do texto fica como
 * está (texto puro, sem HTML). O link continua EM LINHA, com `py-3`: a área de toque tem 44 px de altura sem mudar a altura
 * da linha. Com `inline-block` (o plano), o número virava um bloco atômico e a frase quebrava antes dele ("SAMU (" numa
 * linha, "192)" na outra) e a linha ficava mais alta — visto na fumaça a 320 px (15/10/2026).
 */
export function ComTelefones({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/\b(188|192)\b/).map((parte, i) =>
        parte === '188' || parte === '192' ? (
          <a key={i} href={`tel:${parte}`} className="py-3 font-semibold underline">
            {parte}
          </a>
        ) : (
          <Fragment key={i}>{parte}</Fragment>
        ),
      )}
    </>
  );
}

/** O texto fixo de um código (RN-172, RN-175: nenhuma frase do modelo chega ao paciente). */
export function TextoFixo({ codigo }: { codigo: CodigoTextoFixo }) {
  const texto = TEXTOS_FIXOS[codigo];
  return <p className="wrap-break-word">{COM_TELEFONE.has(codigo) ? <ComTelefones texto={texto} /> : texto}</p>;
}
