import type { ReactNode, SelectHTMLAttributes } from 'react';
import { FORMAS_DE_PAGAMENTO, ROTULO_FORMA } from '@/modules/financeiro/constantes';

/*
 * Peças comuns às telas dos lançamentos, sem `'use client'` e sem hooks: a página (servidor) usa as classes — uma
 * constante exportada de um módulo cliente chegaria ao servidor como referência, não como texto.
 */
export const ACAO_DA_LINHA =
  'inline-flex min-h-11 items-center px-2 text-link underline disabled:opacity-60';
/** O painel que abre abaixo da linha (o pai é `flex flex-wrap`: `basis-full` o leva para a linha de baixo). */
export const PAINEL_DA_LINHA = 'basis-full space-y-3 rounded-2xl border border-borda bg-fundo p-3';

/**
 * A opção vazia dos seletores do Financeiro ("Escolha a forma de pagamento." aparece quando ela fica escolhida). Fora da
 * §6.2, como "Selecione o paciente" da agenda: aguarda a aprovação do dono com os outros textos novos.
 */
export const SELECIONE = 'Selecione';

type Props = {
  id: string;
  rotulo: string;
  erro?: string;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>;

/** O `<select>` dos formulários do Financeiro, no molde do `Campo`: label associada e erro ligado por aria-describedby. */
export function Selecao({ id, rotulo, erro, children, ...select }: Props) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {rotulo}
      </label>
      <select
        id={id}
        name={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
        {...select}
      >
        {children}
      </select>
      {erro && (
        <p id={`${id}-erro`} role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/** As formas de pagamento (§6.2), depois da opção vazia ("Todas" no filtro da lista). */
export function OpcoesDeForma({ vazia = SELECIONE }: { vazia?: string }) {
  return (
    <>
      <option value="">{vazia}</option>
      {FORMAS_DE_PAGAMENTO.map((f) => (
        <option key={f} value={f}>
          {ROTULO_FORMA[f]}
        </option>
      ))}
    </>
  );
}

/** O erro que não é de um campo (cancelado, anonimizado, bloqueado): recebe o foco depois da recusa. */
export function ErroGeral({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" tabIndex={-1} data-erro-geral="" className="text-sm text-erro">
      {texto}
    </p>
  ) : null;
}
