'use client';
import { useSyncExternalStore } from 'react';
import type { GrupoCompra } from '@/modules/portal/lista-compras';
import { alternarComprado, assinarCompras, chaveCompras, lerBruto, lerComprados } from './marcacao';

/** RN-13 / D15: "comprado" fica no aparelho, por plano (ver ./marcacao). */
export function ListaCompras({ planoId, grupos }: { planoId: string; grupos: GrupoCompra[] }) {
  const chave = chaveCompras(planoId);
  const bruto = useSyncExternalStore(assinarCompras, () => lerBruto(chave), () => '[]');
  const comprados = lerComprados(bruto);
  const alternar = (nome: string) => alternarComprado(chave, nome);
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
      <p className="text-sm text-suave">Marque o que já comprou: a marcação fica neste aparelho.</p>
    </div>
  );
}
