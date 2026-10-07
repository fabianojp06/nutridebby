'use client';
import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { aceitarEnvioAction, type RevisaoState } from './actions';

/** US-163: "Aceitar" abre o formulário com "Título" e "Data" (do envio, editáveis); "Aceitar e ler" só com a IA disponível. */
export function AceitarForm({ id, tituloInicial, dataInicial, hoje, comIa }: { id: string; tituloInicial: string; dataInicial: string; hoje: string; comIa: boolean }) {
  const [state, action, pendente] = useActionState<RevisaoState, FormData>(aceitarEnvioAction.bind(null, id), {});
  const e = state.erros ?? {};
  const v = state.valores; // o reset do React 19 volta ao defaultValue: com erro, ao que foi digitado
  const campo = (c: 'titulo' | 'data') => (e[c] ? { 'aria-invalid': true, 'aria-describedby': `aceitar-${c}-erro` } : {});
  return (
    <details open={!!state.erros} className="rounded-2xl border border-borda bg-cartao p-4">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Aceitar</summary>
      <form action={action} className="mt-3 space-y-3">
        <div className="space-y-1">
          <label htmlFor="aceitar-titulo" className="block font-medium">Título</label>
          <input id="aceitar-titulo" name="titulo" defaultValue={v?.titulo ?? tituloInicial} maxLength={120} required className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...campo('titulo')} />
          {e.titulo && <p id="aceitar-titulo-erro" role="alert" className="text-sm text-erro">{e.titulo}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="aceitar-data" className="block font-medium">Data</label>
          <input id="aceitar-data" name="data" type="date" defaultValue={v?.data ?? dataInicial} max={hoje} required className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...campo('data')} />
          {e.data && <p id="aceitar-data-erro" role="alert" className="text-sm text-erro">{e.data}</p>}
        </div>
        {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
        <div className="flex flex-wrap gap-3">
          <Botao disabled={pendente}>Salvar no prontuário</Botao>
          {comIa && (
            <Botao variante="secundario" name="ler" value="1" disabled={pendente}>
              Aceitar e ler valores com IA
            </Botao>
          )}
        </div>
      </form>
    </details>
  );
}
