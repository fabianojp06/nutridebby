import type { ReactNode } from 'react';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { ID_TITULO } from './foco';
import { Mensagens } from './mensagens';
import { SecoesDoFinanceiro } from './secoes';

type ParametrosDaUrl = Record<string, string | string[] | undefined>;
/** RN-301: as ações de lançamento sem configuração levam às Configurações com `?aviso=informeSaldo`. */
const AVISOS = { informeSaldo: MSG_FINANCEIRO.informeSaldo } as const;

/** Só as chaves conhecidas viram texto (nada da URL vai para a tela como veio). */
function daLista<T extends Record<string, string>>(lista: T, chave: string | string[] | undefined): string {
  return typeof chave === 'string' && Object.hasOwn(lista, chave) ? lista[chave as keyof T] : '';
}

/**
 * O topo de toda tela do Financeiro (§4.1, §7): h1 com `tabIndex={-1}` (recebe o foco com `ok=`), a navegação interna, as
 * ações da tela e a região de mensagens sempre montada (`?ok=` e `?aviso=`).
 */
export function TopoDoFinanceiro({ titulo, parametros, acoes }: { titulo: string; parametros: ParametrosDaUrl; acoes?: ReactNode }) {
  const sucesso = daLista(MSG_FINANCEIRO.ok, parametros.ok);
  const aviso = daLista(AVISOS, parametros.aviso);
  return (
    <>
      <h1 id={ID_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
        {titulo}
      </h1>
      <SecoesDoFinanceiro />
      {acoes && <div className="flex flex-wrap justify-end gap-2">{acoes}</div>}
      <Mensagens texto={sucesso || aviso} tipo={sucesso ? 'ok' : 'aviso'} focar={!!sucesso} />
    </>
  );
}
