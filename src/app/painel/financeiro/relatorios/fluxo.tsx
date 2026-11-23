import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { nomeDoMes } from '@/modules/financeiro/meses';
import type { FluxoDoAno } from '@/modules/financeiro/tipos';

const R = MSG_FINANCEIRO.relatorios;
const L = R.linhas;
/** O saldo antes do saldo do caixa (e o "Total" das linhas de saldo, que não se somam no ano). */
const SEM_VALOR = '—';

const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

/**
 * US-306: "Fluxo de caixa de {ano}" — jan a dez e "Total", com as linhas de saldo, uma por categoria, os totais e o
 * resultado. Tabela larga: rola dentro da própria região, focável pelo teclado (`role="region"` com o caption como nome,
 * contorno do foco para dentro, molde de `tabela-medidas.tsx`); a página nunca rola na horizontal. Valores com "R$" e o
 * "−" dos negativos (RN-326); números alinhados à direita, em algarismos tabulares. O nome da linha (a categoria) quebra
 * em palavras: "Contas de consumo (água, luz, internet, telefone)" numa linha só passava da tela de 360 px.
 */
export function FluxoDeCaixa({ fluxo, captionId }: { fluxo: FluxoDoAno; captionId: string }) {
  // `chave`: o nome de uma categoria pode repetir entre entradas e saídas (único por tipo, RN-303)
  const movimento = (chave: string, rotulo: string, valores: number[], destaque = false) => (
    <tr key={chave} className={`border-t border-linha ${destaque ? 'font-semibold' : ''}`}>
      <th scope="row">{rotulo}</th>
      {valores.map((v, i) => (
        <td key={fluxo.meses[i]}>{formatarReais(v)}</td>
      ))}
      <td>{formatarReais(soma(valores))}</td>
    </tr>
  );
  const saldo = (rotulo: string, valores: (number | null)[]) => (
    <tr className="border-t border-linha font-semibold">
      <th scope="row">{rotulo}</th>
      {valores.map((v, i) => (
        <td key={fluxo.meses[i]}>{v === null ? SEM_VALOR : formatarReais(v)}</td>
      ))}
      <td>{SEM_VALOR}</td>
    </tr>
  );
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="overflow-x-auto p-2 focus-visible:outline-offset-[-3px]"
    >
      <table className="min-w-full text-left text-sm tabular-nums [&_td]:whitespace-nowrap [&_td]:px-2 [&_td]:py-2 [&_td]:text-right [&_th]:px-2 [&_th]:py-2 [&_thead_th]:whitespace-nowrap [&_thead_th]:text-right [&_tbody_th]:min-w-36">
        <caption id={captionId} className="sr-only">
          {R.fluxo(fluxo.ano)}
        </caption>
        <thead>
          <tr>
            <td />
            {fluxo.meses.map((m) => (
              <th scope="col" key={m}>
                {nomeDoMes(m).slice(0, 3)}
              </th>
            ))}
            <th scope="col">{R.total}</th>
          </tr>
        </thead>
        <tbody>
          {saldo(L.saldoInicio, fluxo.saldoInicio)}
          {fluxo.categoriasEntrada.map((c, i) => movimento(`entrada-${i}`, c.categoria, c.valores))}
          {movimento('total-entradas', L.totalEntradas, fluxo.totalEntradas, true)}
          {fluxo.categoriasSaida.map((c, i) => movimento(`saida-${i}`, c.categoria, c.valores))}
          {movimento('total-saidas', L.totalSaidas, fluxo.totalSaidas, true)}
          {movimento('resultado', L.resultado, fluxo.resultado, true)}
          {saldo(L.saldoFim, fluxo.saldoFim)}
        </tbody>
      </table>
    </div>
  );
}
