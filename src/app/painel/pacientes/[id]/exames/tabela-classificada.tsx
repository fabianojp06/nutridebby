import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { ROTULO_NEUTRA, type Neutra } from '@/modules/exames/classificacao';
import type { Comparativo } from '@/modules/exames/comparativo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { formatarData } from '@/modules/pacientes/datas';
import { VerReferencia, type ReferenciaDaLinha } from './ver-referencia';

/**
 * Plano 22 (T5b, spec §7 "Lista da aba", "Detalhe do exame" e "Comparativo"; RN-379, RN-382, RN-384): as tabelas de
 * valores classificados do painel. Uma tabela por exame (lista e detalhe) com "Marcador · Valor · Referência do laudo ·
 * Classificação · Ver referência", e a tabela do comparativo (marcadores nas linhas, datas nas colunas). Classificação
 * sempre em texto (nunca só cor); os avisos fixos ficam antes da tabela e ligados a ela por `aria-describedby`. A tabela
 * fica numa região rolável focável com o contorno para dentro (`cores.test.ts`), para a rolagem lateral a 360 px.
 */

const C = MSG_EXAMES.classificacao;
const SEM = MSG_EXAMES.comparativo.semValor;
const REGIAO = 'overflow-x-auto focus-visible:outline-offset-[-3px]';
const CELULA = 'px-2 py-1';

const valorComUnidade = (valor: number, unidade: string | null) => `${formatarDecimal(valor, casasDecimais(valor))}${unidade ? ` ${unidade}` : ''}`;

export type LinhaClassificada = {
  nome: string;
  valor: number;
  unidade: string | null;
  referencia: string | null;
  neutra: Neutra | null;
  /** A categoria das faixas do consultório (RN-380); `null` sem categoria. */
  categoria: string | null;
  /** O que o "Ver referência" mostra; `null` = sem o botão nesta linha. */
  ref: ReferenciaDaLinha | null;
  /** A marca da IA ao lado do valor ("IA · conferido em {data}"). */
  marca?: string;
};

export type IdsDosAvisos = { classificacao: string; gestacao: string };

/** Os avisos fixos da classificação (§6.2): o da classificação e, com categoria do consultório, o da gestação. */
export function AvisosDaClassificacao({ ids, comCategoria }: { ids: IdsDosAvisos; comCategoria: boolean }) {
  return (
    <>
      <p id={ids.classificacao} className="text-sm text-suave">
        {C.aviso}
      </p>
      {comCategoria && (
        <p id={ids.gestacao} className="text-sm text-suave">
          {C.gestacao}
        </p>
      )}
    </>
  );
}

/**
 * Os valores de um exame. Sem `avisosDeFora`, os avisos vêm antes da tabela (detalhe); com eles (lista da aba: um aviso
 * só para todos os exames), a tabela só cita os ids de fora. A tabela cita o aviso da gestação só se tem categoria.
 */
export function TabelaClassificada({ id, legenda, linhas, avisosDeFora }: { id: string; legenda: string; linhas: LinhaClassificada[]; avisosDeFora?: IdsDosAvisos }) {
  const comClassificacao = linhas.some((l) => l.neutra || l.categoria);
  const comCategoria = linhas.some((l) => l.categoria);
  const comRef = linhas.some((l) => l.ref);
  const ids = avisosDeFora ?? { classificacao: `${id}-aviso`, gestacao: `${id}-gestacao` };
  const descritos = [comClassificacao ? ids.classificacao : null, comCategoria ? ids.gestacao : null].filter(Boolean).join(' ') || undefined;
  const legendaId = `${id}-legenda`;
  return (
    <div className="space-y-2">
      {!avisosDeFora && comClassificacao && <AvisosDaClassificacao ids={ids} comCategoria={comCategoria} />}
      <div role="region" aria-labelledby={legendaId} tabIndex={0} className={REGIAO}>
        <table className="w-full text-left" aria-describedby={descritos}>
          <caption id={legendaId} className="sr-only">
            {legenda}
          </caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col" className={CELULA}>Marcador</th>
              <th scope="col" className={CELULA}>Valor</th>
              <th scope="col" className={CELULA}>Referência do laudo</th>
              <th scope="col" className={CELULA}>Classificação</th>
              {comRef && <th scope="col" className={CELULA}>{MSG_EXAMES.ref.botao}</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={`${i}-${l.nome}`} className="border-t border-linha align-top">
                <th scope="row" className={`${CELULA} font-normal`}>{l.nome}</th>
                <td className={CELULA}>
                  {valorComUnidade(l.valor, l.unidade)}
                  {l.marca && <span className="ml-2 text-sm text-suave">{l.marca}</span>}
                </td>
                <td className={`wrap-break-word ${CELULA}`}>{l.referencia ?? SEM}</td>
                {l.neutra || l.categoria ? (
                  <td className={CELULA}>
                    {l.neutra && ROTULO_NEUTRA[l.neutra]}
                    {l.categoria && <span className="block">{`${l.categoria} ${C.faixaDoConsultorio}`}</span>}
                  </td>
                ) : (
                  <td className={CELULA}>{SEM}</td>
                )}
                {comRef && <td className={CELULA}>{l.ref && <VerReferencia marcador={l.nome} {...l.ref} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * O comparativo (US-374): marcadores nas linhas (`th scope="row"`, com a unidade), datas nas colunas (`th scope="col"`,
 * mais antiga à esquerda), "—" sem a linha, a neutra em texto. Sem categoria do consultório, sem nota (RN-384).
 */
export function TabelaComparativa({ id, comparativo }: { id: string; comparativo: Comparativo }) {
  const comClassificacao = comparativo.linhas.some((l) => l.celulas.some((c) => c?.neutra));
  const idAviso = `${id}-aviso`;
  const idNota = `${id}-nota`;
  const legendaId = `${id}-legenda`;
  const descritos = [comClassificacao ? idAviso : null, comparativo.unidadesSeparadas ? idNota : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-2">
      {comClassificacao && (
        <p id={idAviso} className="text-sm text-suave">
          {C.aviso}
        </p>
      )}
      {comparativo.unidadesSeparadas && (
        <p id={idNota} className="text-sm text-suave">
          {MSG_EXAMES.comparativo.nota}
        </p>
      )}
      <div role="region" aria-labelledby={legendaId} tabIndex={0} className={REGIAO}>
        <table className="w-full text-left" aria-describedby={descritos}>
          <caption id={legendaId} className="text-left font-semibold">
            {MSG_EXAMES.comparativo.caption}
          </caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col" className={CELULA}>{MSG_EXAMES.comparativo.marcador}</th>
              {comparativo.exames.map((e) => (
                <th key={e.id} scope="col" className={`${CELULA} min-w-32`}>
                  <span className="block">{formatarData(e.data)}</span>
                  <span className="block font-normal wrap-break-word">{e.titulo}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparativo.linhas.map((l, i) => (
              <tr key={`${i}-${l.marcador}-${l.unidade ?? ''}`} className="border-t border-linha align-top">
                <th scope="row" className={`${CELULA} font-normal`}>{l.unidade ? `${l.marcador} (${l.unidade})` : l.marcador}</th>
                {l.celulas.map((c, j) =>
                  c ? (
                    <td key={j} className={CELULA}>
                      {valorComUnidade(c.valor, c.unidade)}
                      {c.neutra && <span className="block text-sm">{ROTULO_NEUTRA[c.neutra]}</span>}
                    </td>
                  ) : (
                    <td key={j} className={CELULA}>{SEM}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
