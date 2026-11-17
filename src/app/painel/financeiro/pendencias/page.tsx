import Link from 'next/link';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { telaDePendencias } from '@/modules/financeiro/telas';
import { formatarData } from '@/modules/pacientes/datas';
import { TopoDoFinanceiro } from '../topo';

export const dynamic = 'force-dynamic';

const TITULO = M.secoes.pendentes;
const CAPTION = 'Pacientes com pagamento pendente';
const LINK = 'inline-flex min-h-11 items-center text-link underline';

/**
 * US-304 / RN-311: os pacientes com cobrança em aberto (prevista ou em atraso), da cobrança mais antiga para a mais nova.
 * Só nome, total e data, como a agenda: sem `auditRead` (RN-318). Uma transação (RNF-301). Sem configuração (RN-301): o
 * primeiro acesso. A tabela rola dentro da própria região (seis colunas não cabem em 360 px), focável pelo teclado.
 */
export default async function PagamentosPendentes({ searchParams }: PageProps<'/painel/financeiro/pendencias'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro/pendencias');
  const parametros = await searchParams;
  const tela = await telaDePendencias(ctx, tenant);
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

  return (
    <>
      <TopoDoFinanceiro titulo={TITULO} parametros={parametros} />
      <p data-guia="financeiro-pendentes">{M.pendentesIntro}</p>
      {tela.pendentes.length === 0 ? (
        <p>{M.pendentes.vazio}</p>
      ) : (
        <div
          role="region"
          aria-labelledby="pendentes-caption"
          tabIndex={0}
          className="overflow-x-auto rounded-3xl border border-borda bg-cartao p-2 focus-visible:outline-offset-[-3px]"
        >
          <table className="min-w-full text-left [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_thead_th]:whitespace-nowrap">
            <caption id="pendentes-caption" className="px-3 pb-2 text-left font-semibold">
              {CAPTION}
            </caption>
            <thead>
              <tr>
                <th scope="col">Paciente</th>
                <th scope="col">Em aberto</th>
                <th scope="col">Cobranças</th>
                <th scope="col">Mais antiga</th>
                <th scope="col">Situação</th>
                <th scope="col">Ação</th>
              </tr>
            </thead>
            <tbody>
              {tela.pendentes.map((p) => (
                <tr key={p.paciente.id} className="border-t border-linha">
                  <th scope="row" className="font-medium">
                    {p.paciente.nome}
                  </th>
                  <td className="whitespace-nowrap tabular-nums">{formatarReais(p.total)}</td>
                  <td className="tabular-nums">{p.quantidade}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatarData(p.maisAntiga)}</td>
                  {/* RN-311: "Em atraso" se alguma venceu; senão, todas previstas (em texto, não só cor) */}
                  <td className="whitespace-nowrap">{p.emAtraso ? M.pendentes.emAtraso : M.situacoes.previsto}</td>
                  <td>
                    <Link href={`/painel/financeiro/pendencias/${p.paciente.id}`} className={LINK}>
                      {M.pendentes.ver}
                      <span className="sr-only">{` os pagamentos pendentes de ${p.paciente.nome}`}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
