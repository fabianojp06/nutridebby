'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import { COMPARAR_MAX, COMPARAR_MIN, MSG_EXAMES } from '@/modules/exames/constantes';

/**
 * Plano 22 (T5b, US-374 "Limites", spec §7 "Lista da aba"): a escolha dos exames do comparativo na aba Exames. A caixa
 * "Comparar" de cada exame (nome acessível "Comparar {título} de {data}") fica no cartão do exame e pertence ao formulário
 * GET do comparativo pelo atributo `form` (os cartões já têm formulários próprios, e formulário não aninha). O botão
 * "Comparar {n} exames" fica desabilitado fora de 2 a 6, com o texto de apoio ligado por `aria-describedby`; o
 * `aria-disabled` (não `disabled`) mantém o botão no Tab, para o leitor de tela ler o porquê.
 */

export const ID_DO_FORM_COMPARAR = 'comparar-exames';
const ID_DO_APOIO = 'comparar-exames-apoio';
const X = MSG_EXAMES.exame;

type Selecao = { marcados: ReadonlySet<string>; alternar: (id: string, marcado: boolean) => void };
const SelecaoCtx = createContext<Selecao | null>(null);

export function SelecaoParaComparar({ children }: { children: ReactNode }) {
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string, marcado: boolean) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  return <SelecaoCtx.Provider value={{ marcados, alternar }}>{children}</SelecaoCtx.Provider>;
}

function useSelecao(): Selecao {
  const s = useContext(SelecaoCtx);
  if (!s) throw new Error('comparar-exames: fora de SelecaoParaComparar');
  return s;
}

export function CaixaComparar({ exameId, rotulo }: { exameId: string; rotulo: string }) {
  const { marcados, alternar } = useSelecao();
  const id = `comparar-${exameId}`;
  return (
    <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2">
      <input
        id={id}
        type="checkbox"
        name="ids"
        value={exameId}
        form={ID_DO_FORM_COMPARAR}
        aria-label={rotulo}
        checked={marcados.has(exameId)}
        onChange={(e) => alternar(exameId, e.currentTarget.checked)}
        className="size-5"
      />
      {X.comparar}
    </label>
  );
}

export function BotaoComparar({ acao }: { acao: string }) {
  const { marcados } = useSelecao();
  const n = marcados.size;
  const fora = n < COMPARAR_MIN || n > COMPARAR_MAX;
  return (
    <form id={ID_DO_FORM_COMPARAR} method="get" action={acao} className="flex flex-wrap items-center gap-3" onSubmit={(e) => fora && e.preventDefault()}>
      <Botao type="submit" aria-disabled={fora || undefined} aria-describedby={ID_DO_APOIO} className="aria-disabled:opacity-60">
        {X.compararN(n)}
      </Botao>
      <p id={ID_DO_APOIO} className="text-sm text-suave">
        {X.apoioComparar}
      </p>
    </form>
  );
}
