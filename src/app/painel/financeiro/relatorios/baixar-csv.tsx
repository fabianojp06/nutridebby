'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Campo } from '@/components/campo';
import { OpcoesDoFiltroDeLocal } from '@/components/opcoes-de-local';
import { Botao } from '@/components/ui/botao';
import { MSG_FILTRO_LOCAL } from '@/modules/agenda/constantes';
import type { OpcoesDeLocal } from '@/modules/agenda/locais';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { periodoValido } from '@/modules/financeiro/meses';
import { SEM_LOCAL } from '@/modules/financeiro/tipos';
import { dataValida } from '@/modules/pacientes/datas';
import { AlertaDoCsv } from './alerta-do-csv';

const C = MSG_FINANCEIRO.csv;
const E = MSG_FINANCEIRO.erros;
type Erros = { de?: string; ate?: string };
const ID_BOTAO = 'csv-baixar';
const ID_ERRO_ORIGEM = 'csv-erro-origem';

/** Data que não existe → "Data inválida." no próprio campo; período invertido ou longo → o erro da §6.2 junto do "Até". */
function errosDoPeriodo(de: string, ate: string): Erros {
  if (!dataValida(de)) return { de: E.dataInvalida };
  if (!dataValida(ate)) return { ate: E.dataInvalida };
  return periodoValido(de, ate) ? {} : { ate: E.periodoLongo };
}

/**
 * US-306 / §4.1: o CSV dos lançamentos é uma navegação GET (o navegador baixa o anexo e a página fica), não `fetch`. O
 * formulário confere o período antes de navegar ("De" ≤ "Até", até 366 dias) e, se não der, mostra o erro em
 * `role="alert"` junto do campo e leva o foco a ele, sem sair de Relatórios. A rota confere de novo e, se recusar, volta
 * com `?erro=periodo` (`erroDoServidor`: o erro junto do "Até", que recebe o foco na montagem — a página chega do zero, no
 * topo). "Incluir o nome dos pacientes" desmarcado não vai na URL (`pacientes` = 0). `?erro=origem` sem `csv=fluxo`
 * (`erroDeOrigem`: a rota não conseguiu confirmar que o pedido veio de Relatórios) → `AlertaDoCsv` junto do botão, ligado
 * a ele por `aria-describedby`, e o foco no botão. Plano 23 (US-416, RN-437): "Local" (`local`, o mesmo filtro de
 * Lançamentos), começando no local escolhido em Relatórios; "Todos os locais" vai vazio (sem filtro).
 */
export function BaixarCsv({
  de,
  ate,
  erroDoServidor,
  erroDeOrigem = false,
  erroDeLocal = false,
  locais = { ativos: [], arquivados: [] },
  local = '',
}: {
  de: string;
  ate: string;
  erroDoServidor: boolean;
  erroDeOrigem?: boolean;
  /** `?erro=local`: a rota recusou o local (fora das opções); o alerta junto do seletor, que recebe o foco. */
  erroDeLocal?: boolean;
  locais?: OpcoesDeLocal;
  /** O local escolhido em Relatórios (um id ou `sem_local`), ou ''. */
  local?: string;
}) {
  const [erros, setErros] = useState<Erros>(erroDoServidor ? { ate: E.periodoLongo } : {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (erroDoServidor) form.current?.querySelector<HTMLElement>('#csv-ate')?.focus();
    else if (erroDeLocal) form.current?.querySelector<HTMLElement>('#csv-local')?.focus();
  }, [erroDoServidor, erroDeLocal]);
  function conferir(e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const novos = errosDoPeriodo(String(fd.get('de') ?? ''), String(fd.get('ate') ?? ''));
    setErros(novos);
    if (novos.de || novos.ate) {
      e.preventDefault();
      form.current?.querySelector<HTMLElement>(novos.de ? '#csv-de' : '#csv-ate')?.focus();
    }
  }
  return (
    <form
      ref={form}
      method="get"
      action="/api/painel/financeiro/lancamentos.csv"
      noValidate
      onSubmit={conferir}
      data-guia="financeiro-csv"
      className="space-y-3"
    >
      <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
        <Campo id="csv-de" name="de" type="date" rotulo={C.de} defaultValue={de} erro={erros.de} />
        <Campo id="csv-ate" name="ate" type="date" rotulo={C.ate} defaultValue={ate} erro={erros.ate} />
      </div>
      <div className="min-w-0 max-w-full space-y-1 sm:max-w-xs">
        <label htmlFor="csv-local" className="block font-medium">
          {MSG_FILTRO_LOCAL.localDosLancamentos}
        </label>
        <select
          id="csv-local"
          name="local"
          defaultValue={local}
          aria-invalid={erroDeLocal ? true : undefined}
          aria-describedby={erroDeLocal ? 'csv-local-erro' : undefined}
          className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
        >
          <OpcoesDoFiltroDeLocal opcoes={locais} semLocal={SEM_LOCAL} />
        </select>
        {erroDeLocal && (
          <p id="csv-local-erro" role="alert" className="text-sm text-erro">
            {MSG_FILTRO_LOCAL.localInvalido}
          </p>
        )}
      </div>
      <div>
        <div className="flex min-h-11 items-center gap-2">
          <input
            id="csv-pacientes"
            type="checkbox"
            name="pacientes"
            value="1"
            aria-describedby="csv-pacientes-ajuda"
            className="size-5"
          />
          <label htmlFor="csv-pacientes">{C.incluirPacientes}</label>
        </div>
        <p id="csv-pacientes-ajuda" className="max-w-2xl text-sm text-suave">
          {C.ajuda}
        </p>
      </div>
      {erroDeOrigem && (
        <AlertaDoCsv id={ID_ERRO_ORIGEM} controle={ID_BOTAO}>
          {C.erroOrigem}
        </AlertaDoCsv>
      )}
      <Botao id={ID_BOTAO} aria-describedby={erroDeOrigem ? ID_ERRO_ORIGEM : undefined}>
        {C.baixar}
      </Botao>
    </form>
  );
}
