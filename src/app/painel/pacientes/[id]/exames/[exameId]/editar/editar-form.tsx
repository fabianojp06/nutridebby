'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { focarPrimeiroErro } from '@/components/focar-primeiro-erro';
import { Botao } from '@/components/ui/botao';
import type { ItemDoCatalogo } from '@/app/painel/exames/escolher-do-catalogo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { editarExameAction, type EditarState } from '../../actions';
import { linhaDoGravado, linhaParaEnvio, LinhasDoExame, type LinhaDoForm } from '../../linhas-do-exame';

type ValorGravado = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number };

/**
 * Plano 22 (T4, US-371, RN-378): "Editar exame" — título, data, linhas e a justificativa da alteração. Cada linha leva o
 * índice da linha gravada (`origem`); o `updated_at` lido volta em `lidoEm` (concorrência otimista, M3). Um erro devolve
 * `valores` e os campos remontam com eles (`key`); as linhas ficam no estado do formulário. Sem o laudo (EP-D44).
 */
export function EditarForm({
  patientId,
  exameId,
  exame,
  conferidoEm,
  hoje,
  catalogo,
}: {
  patientId: string;
  exameId: string;
  exame: { titulo: string; data: string; valores: ValorGravado[]; updatedAt: string };
  /** A data da conferência (já formatada) por `iaTarefaId`: "IA · conferido em {data}" na linha da IA. */
  conferidoEm: Record<string, string>;
  hoje: string;
  catalogo: ItemDoCatalogo[];
}) {
  const [estado, acao, enviando] = useActionState<EditarState, FormData>(editarExameAction.bind(null, patientId, exameId), {});
  const [linhas, setLinhas] = useState<LinhaDoForm[]>(() => exame.valores.map((v, i) => linhaDoGravado(v, i, v.iaTarefaId ? (conferidoEm[v.iaTarefaId] ?? null) : null)));
  const form = useRef<HTMLFormElement>(null);
  const erros = estado.erros ?? {};
  // as chaves das linhas no envio em curso; quando a resposta chega (`estado.envio` novo), passam a valer para os erros
  // dela — remover ou acrescentar linhas depois nunca leva a mensagem para outra linha
  const [chavesEnviadas, setChavesEnviadas] = useState<number[]>([]);
  const [doEnvio, setDoEnvio] = useState<{ envio: number | undefined; chaves: number[] }>({ envio: undefined, chaves: [] });
  if (doEnvio.envio !== estado.envio) setDoEnvio({ envio: estado.envio, chaves: chavesEnviadas });
  const v = (k: string, padrao: string) => (typeof estado.valores?.[k] === 'string' ? (estado.valores[k] as string) : padrao);
  const chave = estado.envio ?? 0;

  useEffect(() => {
    if (estado.envio) focarPrimeiroErro(form.current);
  }, [estado.envio]);

  const aria = (k: string) => (erros[k] ? { 'aria-invalid': true as const, 'aria-describedby': `editar-${k}-erro` } : {});
  const erro = (k: string) =>
    erros[k] && (
      <p id={`editar-${k}-erro`} role="alert" className="text-sm text-erro">
        {erros[k]}
      </p>
    );
  return (
    <form ref={form} action={acao} onSubmit={() => setChavesEnviadas(linhas.map((l) => l.chave))} className="space-y-4">
      <input type="hidden" name="lidoEm" value={exame.updatedAt} />
      <input type="hidden" name="linhas" value={JSON.stringify(linhas.map(linhaParaEnvio))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="editar-titulo" className="block font-medium">
            Título do exame
          </label>
          <input
            key={`titulo-${chave}`}
            id="editar-titulo"
            name="titulo"
            maxLength={120}
            defaultValue={v('titulo', exame.titulo)}
            className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
            {...aria('titulo')}
          />
          {erro('titulo')}
        </div>
        <div className="space-y-1">
          <label htmlFor="editar-data" className="block font-medium">
            Data do exame
          </label>
          <input
            key={`data-${chave}`}
            id="editar-data"
            name="data"
            type="date"
            max={hoje}
            defaultValue={v('data', exame.data)}
            className="min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto"
            {...aria('data')}
          />
          {erro('data')}
        </div>
      </div>
      <LinhasDoExame idBase="editar" linhas={linhas} aoMudar={setLinhas} erros={erros} chavesDoEnvio={doEnvio.chaves} catalogo={catalogo} />
      <div className="space-y-1">
        <label htmlFor="editar-justificativa" className="block font-medium">
          {MSG_EXAMES.exame.justificativa}
        </label>
        <textarea
          key={`justificativa-${chave}`}
          id="editar-justificativa"
          name="justificativa"
          rows={3}
          maxLength={500}
          defaultValue={v('justificativa', '')}
          className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
          {...aria('justificativa')}
        />
        {erro('justificativa')}
      </div>
      {erros.geral && (
        <p id="editar-geral-erro" role="alert" tabIndex={-1} className="text-sm text-erro">
          {erros.geral}
        </p>
      )}
      <Botao
        type="submit"
        aria-disabled={enviando || undefined}
        onClick={(e) => {
          if (enviando) e.preventDefault(); // sem disabled: o foco não sai do botão enquanto salva
        }}
        className="aria-disabled:opacity-60"
      >
        {MSG_EXAMES.exameDoCatalogo.salvar}
      </Botao>
    </form>
  );
}
