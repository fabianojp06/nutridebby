'use client';

import { useActionState, useRef, useState } from 'react';
import { TIPOS_PERGUNTA, type Pergunta, type TipoPergunta } from '@/modules/pacientes/anamnese-tipos';
import type { ModeloState } from './actions';

type Rascunho = { id: string; tipo: TipoPergunta; rotulo: string; obrigatoria: boolean; unidade: string; opcoes: string };
const paraRascunho = (p: Pergunta): Rascunho => ({ id: p.id, tipo: p.tipo, rotulo: p.rotulo, obrigatoria: p.obrigatoria, unidade: p.unidade ?? '', opcoes: (p.opcoes ?? []).join('\n') });
/**
 * Id local e determinístico da pergunta nova (o servidor troca por um UUID em `validarModelo`): `crypto.randomUUID()`
 * aqui daria ids diferentes no SSR e na hidratação (`rotulo-…`, `tipo-…` sem casar) e nem existe fora de HTTPS.
 */
const nova = (id: string): Rascunho => ({ id, tipo: 'texto_curto', rotulo: '', obrigatoria: false, unidade: '', opcoes: '' });
const LIMITE_PERGUNTAS = 100;

type Props = {
  acao: (prev: ModeloState, formData: FormData) => Promise<ModeloState>;
  inicial: { nome: string; perguntas: Pergunta[] };
};

/** Editor de modelo (US-012): o modelo vai inteiro, em JSON, num campo escondido; o servidor valida tudo de novo. */
export function ModeloEditor({ acao, inicial }: Props) {
  const [state, action, pendente] = useActionState<ModeloState, FormData>(acao, {});
  const [nome, setNome] = useState(inicial.nome);
  const seq = useRef(1);
  const [perguntas, setPerguntas] = useState<Rascunho[]>(inicial.perguntas.length ? inicial.perguntas.map(paraRascunho) : [nova('nova-0')]);
  const e = state.erros ?? {};
  const mudar = (i: number, parte: Partial<Rascunho>) => setPerguntas((ps) => ps.map((p, j) => (j === i ? { ...p, ...parte } : p)));
  const mover = (i: number, d: -1 | 1) =>
    setPerguntas((ps) => {
      const j = i + d;
      if (j < 0 || j >= ps.length) return ps;
      const c = [...ps];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const json = JSON.stringify({
    nome,
    perguntas: perguntas.map((p) => ({ id: p.id, tipo: p.tipo, rotulo: p.rotulo, obrigatoria: p.obrigatoria, unidade: p.unidade, opcoes: p.opcoes.split('\n') })),
  });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="modelo" value={json} />
      <div className="space-y-1">
        <label htmlFor="nome-modelo" className="block font-medium">Nome do modelo</label>
        <input id="nome-modelo" value={nome} onChange={(ev) => setNome(ev.target.value)} maxLength={80} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
          aria-invalid={e.nome ? true : undefined} aria-describedby={e.nome ? 'nome-modelo-erro' : undefined} />
        {e.nome && <p id="nome-modelo-erro" role="alert" className="text-sm text-erro">{e.nome}</p>}
      </div>
      <ol className="space-y-4">
        {perguntas.map((p, i) => {
          const n = i + 1;
          const erro = e[`pergunta_${i}`];
          return (
            <li key={p.id} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor={`rotulo-${p.id}`} className="block font-medium">{`Texto da pergunta ${n}`}</label>
                  <input id={`rotulo-${p.id}`} value={p.rotulo} onChange={(ev) => mudar(i, { rotulo: ev.target.value })} maxLength={200} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
                    aria-invalid={erro ? true : undefined} aria-describedby={erro ? `erro-${p.id}` : undefined} />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`tipo-${p.id}`} className="block font-medium">{`Tipo da pergunta ${n}`}</label>
                  <select id={`tipo-${p.id}`} value={p.tipo} onChange={(ev) => mudar(i, { tipo: ev.target.value as TipoPergunta })} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
                    {TIPOS_PERGUNTA.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
                  </select>
                </div>
              </div>
              {p.tipo === 'numero' && (
                <div className="space-y-1">
                  <label htmlFor={`unidade-${p.id}`} className="block">{`Unidade da pergunta ${n} (opcional)`}</label>
                  <input id={`unidade-${p.id}`} value={p.unidade} onChange={(ev) => mudar(i, { unidade: ev.target.value })} maxLength={20} className="rounded-xl border border-campo bg-cartao p-2 text-texto" />
                </div>
              )}
              {(p.tipo === 'escolha_unica' || p.tipo === 'multipla_escolha') && (
                <div className="space-y-1">
                  <label htmlFor={`opcoes-${p.id}`} className="block">{`Opções da pergunta ${n} (uma por linha)`}</label>
                  <textarea id={`opcoes-${p.id}`} value={p.opcoes} onChange={(ev) => mudar(i, { opcoes: ev.target.value })} rows={4} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <input id={`obrigatoria-${p.id}`} type="checkbox" checked={p.obrigatoria} onChange={(ev) => mudar(i, { obrigatoria: ev.target.checked })} />
                  <label htmlFor={`obrigatoria-${p.id}`}>{`Pergunta ${n} obrigatória`}</label>
                </div>
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="text-link underline" aria-label={`Subir a pergunta ${n}`}>Subir</button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === perguntas.length - 1} className="text-link underline" aria-label={`Descer a pergunta ${n}`}>Descer</button>
                <button type="button" onClick={() => setPerguntas((ps) => ps.filter((_, j) => j !== i))} className="text-link underline" aria-label={`Remover a pergunta ${n}`}>Remover</button>
              </div>
              {erro && <p id={`erro-${p.id}`} role="alert" className="text-sm text-erro">{erro}</p>}
            </li>
          );
        })}
      </ol>
      {e.perguntas && <p role="alert" className="text-erro">{e.perguntas}</p>}
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      <div className="flex gap-3">
        <button type="button" disabled={perguntas.length >= LIMITE_PERGUNTAS} onClick={() => setPerguntas((ps) => [...ps, nova(`nova-${seq.current++}`)])} className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha disabled:opacity-50">Adicionar pergunta</button>
        <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-110">Salvar modelo</button>
      </div>
    </form>
  );
}
