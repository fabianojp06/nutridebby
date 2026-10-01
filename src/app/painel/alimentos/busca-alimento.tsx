'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { formatarDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';

const kcalTexto = (a: AlimentoEncontrado) => (a.porCem.kcal === null ? 'Sem valor na TACO' : `${formatarDecimal(a.porCem.kcal, 0)} kcal/100 g`);

/** US-020: campo de busca com lista de resultados (setas + Enter). Sem `aoEscolher`, cada resultado é link. */
export function BuscaAlimento({ aoEscolher, rotulo = 'Buscar alimento' }: { aoEscolher?: (a: AlimentoEncontrado) => void; rotulo?: string }) {
  const id = useId();
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<AlimentoEncontrado[]>([]);
  const [ativo, setAtivo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current; // invalida qualquer pedido ainda em andamento
    if (termo.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/painel/alimentos?q=${encodeURIComponent(termo)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const { resultados: lista } = (await r.json()) as { resultados: AlimentoEncontrado[] };
        if (n === pedido.current) {
          setResultados(lista);
          setAtivo(0);
          setErro(null);
        }
      } catch {
        if (n === pedido.current) setErro('Não foi possível buscar agora. Tente de novo.');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  const escolher = (a: AlimentoEncontrado) => {
    aoEscolher?.(a);
    setTermo('');
    setResultados([]);
  };

  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-q`} className="block font-medium">{rotulo}</label>
      <input
        id={`${id}-q`}
        type="search"
        role="combobox"
        aria-expanded={resultados.length > 0}
        aria-controls={`${id}-lista`}
        aria-activedescendant={resultados[ativo] ? `${id}-${resultados[ativo].id}` : undefined}
        autoComplete="off"
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value);
          if (e.target.value.trim().length < 2) {
            setResultados([]);
            setErro(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAtivo((i) => Math.min(i + 1, resultados.length - 1));
          else if (e.key === 'ArrowUp') setAtivo((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && aoEscolher && resultados[ativo]) {
            e.preventDefault();
            escolher(resultados[ativo]);
          } else return;
          e.preventDefault();
        }}
        className="w-full rounded border p-2"
      />
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <ul id={`${id}-lista`} role="listbox" aria-label="Resultados" className="divide-y rounded border empty:hidden">
        {resultados.map((a, i) => (
          <li key={a.id} id={`${id}-${a.id}`} role="option" aria-selected={i === ativo} className={i === ativo ? 'bg-emerald-50' : ''}>
            {aoEscolher ? (
              <button type="button" onClick={() => escolher(a)} className="flex w-full items-center justify-between gap-2 p-2 text-left">
                <span>{a.nome}</span>
                <span className="text-sm text-zinc-600">{kcalTexto(a)} · <Selo origem={a.origem} /></span>
              </button>
            ) : (
              <Link href={`/painel/alimentos/${a.id}`} className="flex items-center justify-between gap-2 p-2">
                <span>{a.nome}</span>
                <span className="text-sm text-zinc-600">{kcalTexto(a)} · <Selo origem={a.origem} /></span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Origem visível" (US-020): selo com texto, não só cor. */
export function Selo({ origem }: { origem: 'TACO' | 'Meu alimento' }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${origem === 'TACO' ? 'bg-zinc-100 text-zinc-800' : 'bg-emerald-100 text-emerald-900'}`}>{origem}</span>;
}
