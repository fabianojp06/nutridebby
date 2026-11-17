import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { intervaloDoMes, mesDe, nomeDoMes } from '@/modules/financeiro/meses';
import { telaDeRelatorios } from '@/modules/financeiro/telas';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { Selecao } from '../lancamentos/comum';
import { TopoDoFinanceiro } from '../topo';
import { BaixarCsv } from './baixar-csv';
import { Barras } from './barras';
import { FluxoDeCaixa } from './fluxo';

export const dynamic = 'force-dynamic';

const R = M.relatorios;
const TITULO = M.secoes.relatorios;
/**
 * O título da seção do CSV dos lançamentos: o nome da rota na spec (§4.1), fora da §6.2 — aguarda a aprovação do dono com
 * os outros textos novos.
 */
const TITULO_CSV = 'CSV dos lançamentos';
const LINK = 'inline-flex min-h-11 items-center text-link underline';

/**
 * US-306: "Relatórios" — o fluxo de caixa do ano escolhido em "Ano" (`?ano=`), as entradas e saídas dos últimos 12 meses
 * (barras só de desenho e a tabela como alternativa) e o CSV dos lançamentos (`?erro=periodo`: a rota recusou o período;
 * `?erro=origem`: a rota não confirmou a origem do pedido).
 * Uma transação (RNF-301); sem `auditRead` (RN-318) — o download grava o `exportar` na rota. Sem configuração (RN-301): o
 * primeiro acesso.
 */
export default async function Relatorios({ searchParams }: PageProps<'/painel/financeiro/relatorios'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro/relatorios');
  const parametros = await searchParams;
  const tela = await telaDeRelatorios(ctx, tenant, typeof parametros.ano === 'string' ? parametros.ano : undefined);
  if (!tela.config) {
    return (
      <>
        <TopoDoFinanceiro titulo={TITULO} parametros={parametros} />
        <Cartao id="comece-titulo" titulo={M.comecePorAqui} className="max-w-2xl">
          <p>{M.comeceTexto}</p>
          <BotaoLink href="/painel/financeiro/configuracoes" className="mt-4">
            {M.configurar}
          </BotaoLink>
        </Cartao>
      </>
    );
  }

  const { config, ano, anos, fluxo, dozeMeses } = tela;
  const mesAtual = intervaloDoMes(mesDe(hojeNoFuso(tenant.fuso)));
  // o saldo começa no ano mostrado ou depois: os meses antes dele mostram "—" nas linhas de saldo (US-306)
  const notaDoSaldo = config.saldoInicialEm >= `${ano}-01-01`;
  return (
    <>
      <TopoDoFinanceiro titulo={TITULO} parametros={parametros} />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-32">
          <Selecao id="ano" rotulo={R.ano} defaultValue={String(ano)}>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Selecao>
        </div>
        <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">
          {M.filtros.filtrar}
        </button>
      </form>

      <Cartao
        id="fluxo-titulo"
        titulo={R.fluxo(ano)}
        data-guia="financeiro-relatorios"
        acao={
          <a href={`/api/painel/financeiro/fluxo-de-caixa.csv?ano=${ano}`} className={LINK}>
            {M.csv.baixar}
            <span className="sr-only">{` do ${R.fluxo(ano).toLowerCase()}`}</span>
          </a>
        }
      >
        <FluxoDeCaixa fluxo={fluxo} captionId="fluxo-caption" />
        <div className="mt-2 space-y-1 text-sm text-suave">
          <p>{R.soPagos}</p>
          {notaDoSaldo && <p>{R.notaSaldo(formatarData(config.saldoInicialEm))}</p>}
        </div>
      </Cartao>

      <Cartao id="doze-titulo" titulo={R.dozeMeses}>
        <div className="space-y-4">
          <Barras meses={dozeMeses} />
          <div
            role="region"
            aria-labelledby="doze-caption"
            tabIndex={0}
            className="overflow-x-auto p-2 focus-visible:outline-offset-[-3px]"
          >
            <table className="min-w-full text-left text-sm tabular-nums [&_td]:whitespace-nowrap [&_td]:px-2 [&_td]:py-2 [&_td]:text-right [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:py-2 [&_thead_th+th]:text-right">
              <caption id="doze-caption" className="sr-only">
                {R.dozeMeses}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{R.colunas.mes}</th>
                  <th scope="col">{R.colunas.entradas}</th>
                  <th scope="col">{R.colunas.saidas}</th>
                  <th scope="col">{R.colunas.resultado}</th>
                </tr>
              </thead>
              <tbody>
                {dozeMeses.map((m) => (
                  <tr key={m.mes} className="border-t border-linha">
                    <th scope="row" className="font-normal">{`${nomeDoMes(m.mes)} de ${m.mes.slice(0, 4)}`}</th>
                    <td>{formatarReais(m.entradas)}</td>
                    <td>{formatarReais(m.saidas)}</td>
                    <td>{formatarReais(m.resultado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Cartao>

      <Cartao id="csv-titulo" titulo={TITULO_CSV}>
        <BaixarCsv
          de={mesAtual.de}
          ate={mesAtual.ate}
          erroDoServidor={parametros.erro === 'periodo'}
          erroDeOrigem={parametros.erro === 'origem'}
        />
      </Cartao>
    </>
  );
}
