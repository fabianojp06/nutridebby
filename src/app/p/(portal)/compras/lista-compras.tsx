'use client';
import { useSyncExternalStore } from 'react';
import type { GrupoCompra } from '@/modules/portal/lista-compras';

/** RN-13 / D15: "comprado" fica no aparelho (localStorage), por plano: plano novo, lista nova. */
const EVENTO = 'nd-compras';
const assinar = (cb: () => void) => {
  window.addEventListener(EVENTO, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENTO, cb);
    window.removeEventListener('storage', cb);
  };
};
const ler = (chave: string) => {
  try {
    return localStorage.getItem(chave) ?? '[]';
  } catch {
    return '[]';
  }
};
const lista = (bruto: string): string[] => {
  try {
    const v: unknown = JSON.parse(bruto);
    return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
};

export function ListaCompras({ planoId, grupos }: { planoId: string; grupos: GrupoCompra[] }) {
  const chave = `nd-compras:${planoId}`;
  const bruto = useSyncExternalStore(assinar, () => ler(chave), () => '[]');
  const comprados = lista(bruto);
  const alternar = (nome: string) => {
    const novos = comprados.includes(nome) ? comprados.filter((n) => n !== nome) : [...comprados, nome];
    try {
      localStorage.setItem(chave, JSON.stringify(novos));
    } catch {
      // modo privado sem armazenamento: a marcação não persiste (a tela segue sem ela)
    }
    window.dispatchEvent(new Event(EVENTO));
  };
  return (
    <div className="space-y-4">
      {grupos.map((g, gi) => (
        <fieldset key={g.grupo} className="space-y-1">
          <legend className="font-semibold">{g.grupo}</legend>
          {g.itens.map((i, ii) => {
            const id = `item-${gi}-${ii}`;
            const marcado = comprados.includes(i.nome);
            return (
              <div key={i.nome} className="flex min-h-11 items-center gap-2">
                <input id={id} type="checkbox" checked={marcado} onChange={() => alternar(i.nome)} className="size-5" />
                <label htmlFor={id} className={marcado ? 'line-through' : undefined}>{`${i.nome} — ${i.texto}`}</label>
              </div>
            );
          })}
        </fieldset>
      ))}
      <p className="text-sm text-gray-700">Marque o que já comprou: a marcação fica neste aparelho.</p>
    </div>
  );
}
