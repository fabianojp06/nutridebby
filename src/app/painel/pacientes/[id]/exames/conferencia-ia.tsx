'use client';

import { useActionState, useState } from 'react';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_IA } from '@/modules/ia/constantes';
import { lerValorLaudo } from '@/modules/ia/valor-laudo';
import { aplicarSugestaoAction, type ConferenciaState } from './actions';

export type LinhaDaTela = {
  indice: number;
  nomeSugerido: string;
  nomeAjustado: boolean;
  valorInicial: string;
  valorTexto: string;
  unidade: string;
  referencia: string;
  pagina: number | null;
  jaLancado: boolean;
};

/**
 * US-111: tabela de conferência. Caixas DESMARCADAS; a linha só pode ser marcada com um valor numérico sem ambiguidade (a
 * mesma regra do servidor, lerValorLaudo — D10). Texto da IA mostrado como texto (React escapa; sem link).
 */
export function ConferenciaIa(p: {
  patientId: string;
  tarefaId: string;
  linhas: LinhaDaTela[];
  dataColeta: { iso: string; texto: string } | null;
  descartadas: number;
}) {
  const [state, action, pendente] = useActionState<ConferenciaState, FormData>(aplicarSugestaoAction.bind(null, p.patientId, p.tarefaId), {});
  const [valores, setValores] = useState<Record<number, string>>(Object.fromEntries(p.linhas.map((l) => [l.indice, l.valorInicial])));
  const erros = state.erros ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      {erros.geral && <Aviso tipo="erro">{erros.geral}</Aviso>}
      {p.descartadas > 0 && <p className="text-sm text-suave">{MSG_IA.descartadas(p.descartadas)}</p>}
      <table className="w-full text-left">
        <caption className="sr-only">Valores encontrados pela IA no laudo</caption>
        <thead className="text-sm text-suave">
          <tr>
            <th scope="col">Salvar</th>
            <th scope="col">Marcador</th>
            <th scope="col">Valor</th>
            <th scope="col">Unidade</th>
            <th scope="col">Referência</th>
            <th scope="col">Página</th>
          </tr>
        </thead>
        <tbody>
          {p.linhas.map((l) => {
            const v = valores[l.indice] ?? '';
            const lido = lerValorLaudo(v);
            const idNota = `nota-${l.indice}`;
            const erro = erros[`valor-${l.indice}`] ?? erros[`linha-${l.indice}`];
            const notas = [
              l.nomeAjustado ? MSG_IA.nomeAjustado : null,
              l.jaLancado ? MSG_IA.jaLancado : null,
              lido.tipo === 'ambiguo' ? `${MSG_IA.ambiguo} (impresso: ${l.valorTexto})` : null,
              lido.tipo === 'nao_numerico' ? `${MSG_IA.naoNumerico} (impresso: ${l.valorTexto})` : null,
              erro ?? null,
            ].filter(Boolean);
            return (
              <tr key={l.indice} className="border-t border-linha align-top">
                <td>
                  <input type="checkbox" name="sel" value={l.indice} disabled={lido.tipo !== 'numero'} aria-label={`Selecionar ${l.nomeSugerido}`} aria-describedby={notas.length ? idNota : undefined} className="h-6 w-6" />
                </td>
                <td>
                  <label className="sr-only" htmlFor={`nome-${l.indice}`}>{`Nome do marcador ${l.indice + 1}`}</label>
                  <input id={`nome-${l.indice}`} name={`nome-${l.indice}`} defaultValue={l.nomeSugerido} maxLength={80} className="w-full rounded border border-campo bg-cartao p-1" />
                  {notas.length > 0 && <p id={idNota} role={erro ? 'alert' : undefined} className="text-sm">{notas.join(' · ')}</p>}
                </td>
                <td>
                  <label className="sr-only" htmlFor={`valor-${l.indice}`}>{`Valor de ${l.nomeSugerido}`}</label>
                  <input id={`valor-${l.indice}`} name={`valor-${l.indice}`} value={v} onChange={(e) => setValores((x) => ({ ...x, [l.indice]: e.target.value }))} aria-invalid={erro ? true : undefined} inputMode="decimal" className="w-28 rounded border border-campo bg-cartao p-1" />
                </td>
                <td>
                  <label className="sr-only" htmlFor={`unidade-${l.indice}`}>{`Unidade de ${l.nomeSugerido}`}</label>
                  <input id={`unidade-${l.indice}`} name={`unidade-${l.indice}`} defaultValue={l.unidade} maxLength={20} className="w-24 rounded border border-campo bg-cartao p-1" />
                </td>
                <td>
                  <label className="sr-only" htmlFor={`referencia-${l.indice}`}>{`Referência de ${l.nomeSugerido}`}</label>
                  <input id={`referencia-${l.indice}`} name={`referencia-${l.indice}`} defaultValue={l.referencia} maxLength={80} className="w-full rounded border border-campo bg-cartao p-1" />
                </td>
                <td>{l.pagina ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.dataColeta && (
        <fieldset className="space-y-1">
          <legend>{MSG_IA.dataColeta(p.dataColeta.texto)}</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="usarData" value="1" className="h-6 w-6" aria-invalid={erros.data ? true : undefined} aria-describedby={erros.data ? 'erro-data' : undefined} />
            {MSG_IA.usarData}
          </label>
          {erros.data && <p id="erro-data" role="alert" className="text-sm text-erro">{erros.data}</p>}
        </fieldset>
      )}
      <Botao disabled={pendente}>Salvar valores selecionados</Botao>
    </form>
  );
}
