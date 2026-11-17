'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Campo } from '@/components/campo';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { periodoValido } from '@/modules/financeiro/meses';
import { dataValida } from '@/modules/pacientes/datas';

const C = MSG_FINANCEIRO.csv;
const E = MSG_FINANCEIRO.erros;
type Erros = { de?: string; ate?: string };

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
 * com `?erro=periodo` (`erroDoServidor`). "Incluir o nome dos pacientes" desmarcado não vai na URL (`pacientes` = 0).
 * `?erro=origem` (`erroDeOrigem`: a rota não conseguiu confirmar que o pedido veio de Relatórios) → alerta junto do botão.
 */
export function BaixarCsv({
  de,
  ate,
  erroDoServidor,
  erroDeOrigem = false,
}: {
  de: string;
  ate: string;
  erroDoServidor: boolean;
  erroDeOrigem?: boolean;
}) {
  const [erros, setErros] = useState<Erros>(erroDoServidor ? { ate: E.periodoLongo } : {});
  const form = useRef<HTMLFormElement>(null);
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
        <div className="max-w-2xl">
          <Aviso tipo="erro">{C.erroOrigem}</Aviso>
        </div>
      )}
      <Botao>{C.baixar}</Botao>
    </form>
  );
}
