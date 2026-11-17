import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { mesDe } from '@/modules/financeiro/meses';
import { dataDeReferencia } from '@/modules/financeiro/situacao';
import { telaDeLancamentos } from '@/modules/financeiro/telas';
import type { LancamentoNaTela } from '@/modules/financeiro/tipos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { marcadorDoEnvio, TopoDoFinanceiro } from '../topo';
import { Cancelar } from './cancelar';
import { FiltrosDaLista } from './filtros';
import { ACAO_DA_LINHA } from './comum';
import { Receber } from './receber';
import { filtrosDaUrl, urlDaLista } from './url';

export const dynamic = 'force-dynamic';

const TITULO = M.secoes.lancamentos;

/**
 * US-302 / RN-306: "Lançamentos". Sem `mes`, o mês atual no fuso; com `paciente` e sem `mes`, todos os meses (até 200,
 * com o aviso). Totais do filtro em duas linhas, sem os cancelados. A leitura com filtro de paciente é auditada na
 * transação da tela (`telaDeLancamentos`, RN-318; RNF-301). Sem configuração (RN-301): o primeiro acesso, sem "Nova entrada"/"Nova saída".
 */
export default async function Lancamentos({
  searchParams,
}: PageProps<'/painel/financeiro/lancamentos'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro/lancamentos');
  const parametros = await searchParams;
  const f = filtrosDaUrl(parametros);
  // RNF-301: a tela inteira numa transação (configuração, paciente do filtro, lista com o `ler` da RN-318 e categorias)
  const tela = await telaDeLancamentos(ctx, tenant, {
    mes: f.mes,
    tipo: f.tipo,
    situacao: f.situacao,
    categoriaId: f.categoria,
    forma: f.forma,
    pacienteId: f.paciente,
  });
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

  const { config, lista: r, categorias, paciente } = tela;
  const hoje = hojeNoFuso(tenant.fuso);
  // o mês efetivo: o da URL; sem ele, todos ('') com paciente, ou o atual no fuso
  const mes = f.mes ?? (paciente ? '' : mesDe(hoje));
  const filtros = { ...f, mes, paciente: paciente?.id };
  const volta = urlDaLista(filtros);
  const reais = formatarReais;
  const t = r.totais;
  const novaEntrada =
    paciente && !paciente.bloqueado && !paciente.anonimizado
      ? `?tipo=entrada&paciente=${paciente.id}`
      : '?tipo=entrada';
  const marcador = marcadorDoEnvio(parametros.envio);
  return (
    <>
      <TopoDoFinanceiro
        titulo={TITULO}
        parametros={parametros}
        avisos={{ antes_do_saldo: M.antesDoSaldo(formatarData(config.saldoInicialEm)) }}
        acoes={
          <>
            <BotaoLink href={`/painel/financeiro/lancamentos/novo${novaEntrada}`}>
              {M.novaEntrada}
            </BotaoLink>
            <BotaoLink href="/painel/financeiro/lancamentos/novo?tipo=saida" variante="secundario">
              {M.novaSaida}
            </BotaoLink>
          </>
        }
      />
      <FiltrosDaLista
        filtros={filtros}
        meses={r.meses}
        categorias={categorias}
        paciente={paciente}
      />
      <div className="space-y-1 rounded-2xl border border-borda bg-cartao p-3">
        <p>
          {M.totaisDaLista.recebidoOuPago(
            reais(t.entradas.recebido),
            reais(t.saidas.pago),
            reais(t.entradas.recebido - t.saidas.pago),
          )}
        </p>
        <p>{M.totaisDaLista.emAberto(reais(t.entradas.aReceber), reais(t.saidas.aPagar))}</p>
      </div>
      {r.maisDe200 && (
        <Aviso tipo="aviso" papel="nenhum">
          {M.filtros.mais200}
        </Aviso>
      )}
      {r.linhas.length === 0 ? (
        <p>{M.vazioDaLista}</p>
      ) : (
        <ul className="rounded-3xl border border-borda bg-cartao px-5">
          {r.linhas.map((l) => (
            // a chave muda a cada envio: depois de receber ou cancelar, os painéis abertos da linha fecham
            <LinhaDoLancamento key={`${l.id}-${marcador}`} l={l} hoje={hoje} volta={volta} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Uma linha: data de referência, tipo, paciente, categoria e descrição; valor e situação em texto. Ações: "Editar",
 * receber/desfazer e "Cancelar lançamento" — nenhuma no cancelado nem no anonimizado (US-302: sem reabrir nem editar).
 * O nome acessível de cada ação começa pelo texto visível e identifica a linha (WCAG 2.5.3).
 */
function LinhaDoLancamento({
  l,
  hoje,
  volta,
}: {
  l: LancamentoNaTela;
  hoje: string;
  volta: string;
}) {
  const data = formatarData(dataDeReferencia(l));
  const contexto = ` ${[M.csv.tipos[l.tipo], l.paciente?.nome, l.categoria.nome, data, formatarReais(l.valorCentavos)].filter(Boolean).join(', ')}`;
  const ativo = l.situacao !== 'cancelado' && !l.anonimizado;
  return (
    <li className="space-y-1 border-t border-linha py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* texto livre sem espaço (código de barras, Pix copia-e-cola) quebra em vez de alargar a página a 360 px */}
        <span className="min-w-0 wrap-break-word">
          {[data, M.csv.tipos[l.tipo], l.paciente?.nome, l.categoria.nome]
            .filter(Boolean)
            .join(' · ')}
          {l.descricao && <span className="block text-sm text-suave wrap-break-word">{l.descricao}</span>}
        </span>
        <span className="whitespace-nowrap font-medium">{`${formatarReais(l.valorCentavos)} · ${M.situacoes[l.situacao]}`}</span>
      </div>
      {ativo && (
        <div className="-mx-2 flex flex-wrap items-center">
          <Link href={`/painel/financeiro/lancamentos/${l.id}`} className={ACAO_DA_LINHA}>
            {M.acoes.editar}
            <span className="sr-only">{contexto}</span>
          </Link>
          <Receber
            id={l.id}
            tipo={l.tipo}
            recebido={l.pagoEm !== null}
            hoje={hoje}
            volta={volta}
            contexto={contexto}
          />
          <Cancelar id={l.id} volta={volta} contexto={contexto} />
        </div>
      )}
    </li>
  );
}
