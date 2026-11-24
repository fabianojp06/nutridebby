import Link from 'next/link';
import type { FinCategoriaRow } from '@/db/schema';
import { OpcoesDoFiltroDeLocal } from '@/components/opcoes-de-local';
import { MSG_FILTRO_LOCAL } from '@/modules/agenda/constantes';
import type { OpcoesDeLocal } from '@/modules/agenda/locais';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { nomeDoMes } from '@/modules/financeiro/meses';
import { SEM_LOCAL } from '@/modules/financeiro/tipos';
import { OpcoesDeForma, Selecao } from './comum';
import { mesVizinho, urlDaLista, type FiltrosDaUrl } from './url';

const F = MSG_FINANCEIRO.filtros;
const LINK = 'inline-flex min-h-11 items-center text-link underline';

/** "Novembro de 2026" (a opção do `<select>`). */
const rotuloDoMes = (mes: string) => {
  const nome = nomeDoMes(mes);
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${mes.slice(0, 4)}`;
};

type Props = {
  /** Os filtros válidos da URL; `mes` é o efetivo ('' = "Todos os meses", só com paciente). */
  filtros: Required<Pick<FiltrosDaUrl, 'mes'>> & Omit<FiltrosDaUrl, 'mes'>;
  /** `meses` de `listarLancamentos` (do mês atual ao do lançamento mais antigo). */
  meses: string[];
  categorias: Pick<FinCategoriaRow, 'id' | 'tipo' | 'nome'>[];
  /** Plano 23 (US-416, AG-D79): as opções de "Local" (os ativos e os arquivados com lançamento), com "Todos os locais" e "Sem local". */
  locais: OpcoesDeLocal;
  /** O paciente do filtro (chip "Paciente: {nome}"). */
  paciente: { id: string; nome: string } | null;
};

/**
 * RN-306 / §6.2: os filtros da lista num formulário GET ("Filtrar"), sem JavaScript. "Mês" é um `<select>` (não
 * `<input type="month">`, que o Firefox desktop não tem), mais recentes primeiro, com o mês escolhido mesmo fora da lista
 * (um mês futuro, que `meses` não traz) e "Todos os meses" só com o filtro de paciente; "Mês anterior"/"Próximo mês" são
 * links com os outros filtros. O paciente vai num campo oculto, com o chip "Paciente: {nome}" e "Limpar". Plano 23 (US-416,
 * RN-437): "Local" — "Todos os locais", os locais e "Sem local" (lançamento sem consulta ou de consulta antiga).
 */
export function FiltrosDaLista({ filtros, meses, categorias, locais, paciente }: Props) {
  const { mes } = filtros;
  const opcoesDeMes = mes && !meses.includes(mes) ? [...meses, mes].sort().reverse() : meses;
  const doTipo = (tipo: 'entrada' | 'saida') => categorias.filter((c) => c.tipo === tipo);
  return (
    <div data-guia="financeiro-filtros" className="space-y-3">
      {paciente && (
        <p className="flex flex-wrap items-center gap-x-3">
          <span className="rounded-full bg-linha px-3 py-1">{F.paciente(paciente.nome)}</span>
          <Link
            href={urlDaLista({ ...filtros, paciente: undefined, mes: mes || undefined })}
            className={LINK}
          >
            {F.limpar}
            <span className="sr-only"> o filtro de paciente</span>
          </Link>
        </p>
      )}
      <form method="get" className="flex flex-wrap items-end gap-3">
        {paciente && <input type="hidden" name="paciente" value={paciente.id} />}
        <div className="min-w-44">
          <Selecao id="mes" rotulo={F.mes} defaultValue={mes}>
            {paciente && <option value="">{F.todosOsMeses}</option>}
            {opcoesDeMes.map((m) => (
              <option key={m} value={m}>
                {rotuloDoMes(m)}
              </option>
            ))}
          </Selecao>
        </div>
        <Selecao id="tipo" rotulo={F.tipo} defaultValue={filtros.tipo ?? ''}>
          <option value="">{F.tipos.todos}</option>
          <option value="entrada">{F.tipos.entrada}</option>
          <option value="saida">{F.tipos.saida}</option>
        </Selecao>
        <Selecao id="categoria" rotulo={F.categoria} defaultValue={filtros.categoria ?? ''}>
          <option value="">{F.todas}</option>
          <optgroup label={MSG_FINANCEIRO.configuracoes.entradas}>
            {doTipo('entrada').map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </optgroup>
          <optgroup label={MSG_FINANCEIRO.configuracoes.saidas}>
            {doTipo('saida').map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </optgroup>
        </Selecao>
        <Selecao id="situacao" rotulo={F.situacao} defaultValue={filtros.situacao ?? ''}>
          <option value="">{F.situacoes.todas}</option>
          {(['previsto', 'em_atraso', 'recebido_ou_pago', 'cancelado'] as const).map((s) => (
            <option key={s} value={s}>
              {F.situacoes[s]}
            </option>
          ))}
        </Selecao>
        <Selecao id="forma" rotulo={F.forma} defaultValue={filtros.forma ?? ''}>
          <OpcoesDeForma vazia={F.todas} />
        </Selecao>
        {/* o nome do local tem até 60 caracteres: a 360 px o seletor encolhe com a tela */}
        <div className="min-w-0 max-w-full sm:max-w-xs">
          <Selecao id="local" rotulo={MSG_FILTRO_LOCAL.local} defaultValue={filtros.local ?? ''}>
            <OpcoesDoFiltroDeLocal opcoes={locais} semLocal={SEM_LOCAL} />
          </Selecao>
        </div>
        <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">
          {F.filtrar}
        </button>
      </form>
      {mes && (
        <p className="flex flex-wrap gap-x-4">
          <Link href={urlDaLista({ ...filtros, mes: mesVizinho(mes, -1) })} className={LINK}>
            {F.mesAnterior}
          </Link>
          <Link href={urlDaLista({ ...filtros, mes: mesVizinho(mes, 1) })} className={LINK}>
            {F.proximoMes}
          </Link>
        </p>
      )}
    </div>
  );
}
