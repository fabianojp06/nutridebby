'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { prepararAction, type EstadoForm } from '../actions';

/** US-143: a declaração (D5 da spec, rascunho) com a caixa obrigatória. */
export function Preparar({ patientId, docId, declaracao }: { patientId: string; docId: string; declaracao: string }) {
  const [s, action, pendente] = useActionState<EstadoForm, FormData>(prepararAction.bind(null, patientId, docId), {});
  const e = s.erros ?? {};
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-borda bg-cartao p-4" data-guia="preparar-documento">
      <fieldset className="space-y-2">
        <legend className="font-semibold">Declaração</legend>
        <div className="flex items-start gap-2">
          <input id="declaracao" name="declaracao" type="checkbox" className="mt-1 size-5" aria-invalid={e.declaracao ? true : undefined} aria-describedby={e.declaracao ? 'declaracao-erro' : undefined} />
          <label htmlFor="declaracao">{declaracao}</label>
        </div>
        {e.declaracao && <p id="declaracao-erro" role="alert" className="text-sm text-erro">{e.declaracao}</p>}
      </fieldset>
      {e.justificativa && <p role="alert" className="text-erro">{e.justificativa}</p>}
      {e.itens && <p role="alert" className="text-erro">{e.itens}</p>}
      {e.geral && (
        <p role="alert" className="text-erro">
          {e.geral} {s.perfilIncompleto && <Link href="/painel/configuracoes/perfil#documentos" className="underline">Completar perfil</Link>}
        </p>
      )}
      <Botao disabled={pendente}>Preparar para assinatura</Botao>
    </form>
  );
}
