import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FILTRO_LOCAL } from '@/modules/agenda/constantes';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { mesDe, nomeDoMes } from '@/modules/financeiro/meses';
import { resumoDoMes } from '@/modules/financeiro/resumo';
import { dataDeReferencia } from '@/modules/financeiro/situacao';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { TopoDoFinanceiro } from './topo';

export const dynamic = 'force-dynamic';

const LINK = 'inline-flex min-h-11 items-center text-link underline';

/**
 * US-305 (Resumo do mês) e US-300 (primeiro acesso). Sem configuração (RN-301): só "Comece por aqui" e o botão das
 * Configurações, sem "Nova entrada"/"Nova saída". Uma transação (RNF-301); sem `auditRead` (RN-318). Plano 23 (RN-437):
 * de todos os locais, sem filtro.
 */
export default async function ResumoDoFinanceiro({ searchParams }: PageProps<'/painel/financeiro'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro');
  const parametros = await searchParams;
  const agora = new Date();
  const r = await resumoDoMes(ctx, tenant, { agora });

  if (!r.configurado) {
    return (
      <>
        <TopoDoFinanceiro titulo={M.menu} parametros={parametros} />
        <Cartao id="comece-titulo" titulo={M.comecePorAqui} className="max-w-2xl">
          <p>{M.comeceTexto}</p>
          <BotaoLink href="/painel/financeiro/configuracoes" className="mt-4">
            {M.configurar}
          </BotaoLink>
        </Cartao>
      </>
    );
  }

  const mes = nomeDoMes(mesDe(hojeNoFuso(tenant.fuso, agora)));
  const reais = formatarReais;
  return (
    <>
      <TopoDoFinanceiro
        titulo={M.menu}
        parametros={parametros}
        acoes={
          <>
            <BotaoLink href="/painel/financeiro/lancamentos/novo?tipo=entrada">{M.novaEntrada}</BotaoLink>
            <BotaoLink href="/painel/financeiro/lancamentos/novo?tipo=saida" variante="secundario">
              {M.novaSaida}
            </BotaoLink>
          </>
        }
      />
      {r.semValorConsulta && (
        <Aviso tipo="aviso" papel="nenhum">
          {M.semValorConsulta}{' '}
          <Link href="/painel/financeiro/configuracoes#valorConsulta" className="font-semibold underline">
            {M.informarValor}
          </Link>
        </Aviso>
      )}
      {/* Plano 23 (US-416, RN-437): o Resumo e o saldo não se dividem por local */}
      <p className="text-sm text-suave">{MSG_FILTRO_LOCAL.todosOsLocais}</p>
      <div data-guia="financeiro-cartoes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao id="cartao-saldo" titulo={M.cartaoSaldo.titulo}>
          <p className="font-titulo text-2xl font-semibold">{reais(r.saldoAtual ?? 0)}</p>
          {r.saldoDesde && <p className="text-sm text-suave">{M.cartaoSaldo.desde(formatarData(r.saldoDesde))}</p>}
        </Cartao>
        <Cartao id="cartao-entradas" titulo={M.cartaoEntradas.titulo(mes)}>
          <ul className="space-y-1">
            <li>{M.cartaoEntradas.recebido(reais(r.entradas.recebido))}</li>
            <li>{M.cartaoEntradas.aReceber(reais(r.entradas.aReceber))}</li>
            {r.entradas.atrasoAnterior > 0 && <li>{M.cartaoEntradas.atrasoAnterior(reais(r.entradas.atrasoAnterior))}</li>}
          </ul>
        </Cartao>
        <Cartao id="cartao-saidas" titulo={M.cartaoSaidas.titulo(mes)}>
          <ul className="space-y-1">
            <li>{M.cartaoSaidas.pago(reais(r.saidas.pago))}</li>
            <li>{M.cartaoSaidas.aPagar(reais(r.saidas.aPagar))}</li>
            {r.saidas.atrasoAnterior > 0 && <li>{M.cartaoSaidas.atrasoAnterior(reais(r.saidas.atrasoAnterior))}</li>}
          </ul>
        </Cartao>
        <Cartao id="cartao-pendentes" titulo={M.cartaoPendentes.titulo}>
          {r.pendentes.pacientes > 0 ? (
            <>
              <p>{M.cartaoPendentes.resumo(r.pendentes.pacientes, reais(r.pendentes.total))}</p>
              <Link href="/painel/financeiro/pendencias" className={LINK}>
                {M.cartaoPendentes.ver}
                <span className="sr-only"> pagamentos pendentes</span>
              </Link>
            </>
          ) : (
            <p>{M.cartaoPendentes.vazio}</p>
          )}
        </Cartao>
      </div>
      <section aria-labelledby="ultimos-titulo" className="space-y-2 rounded-3xl border border-borda bg-cartao p-5">
        <h2 id="ultimos-titulo" className="font-titulo text-lg font-semibold">
          {M.ultimos.titulo}
        </h2>
        {r.ultimos.length === 0 ? (
          <p>{M.ultimos.vazio}</p>
        ) : (
          <ul>
            {r.ultimos.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-linha py-2 first:border-t-0">
                <span>
                  {[formatarData(dataDeReferencia(l)), M.csv.tipos[l.tipo], l.paciente?.nome, l.categoria.nome].filter(Boolean).join(' · ')}
                </span>
                <span className="whitespace-nowrap">{`${reais(l.valorCentavos)} · ${M.situacoes[l.situacao]}`}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/painel/financeiro/lancamentos" className={LINK}>
          {M.ultimos.verTodos}
        </Link>
      </section>
    </>
  );
}
