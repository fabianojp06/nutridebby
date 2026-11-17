import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais, valorParaCampo } from '@/modules/financeiro/dinheiro';
import { telaDeEdicao } from '@/modules/financeiro/telas';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { marcadorDoEnvio, TopoDoFinanceiro } from '../../topo';
import { Cancelar } from '../cancelar';
import { FormLancamento } from '../form-lancamento';
import { Receber } from '../receber';

export const dynamic = 'force-dynamic';

const LINK = 'text-link underline';

/**
 * US-302: a edição do lançamento, h1 "Entrada — {categoria}" / "Saída — {categoria}" (sem paciente nem data, §4.1).
 * Tipo, paciente e consulta como texto (fixos, RN-308; a consulta é link). Paciente bloqueado (RN-315): o aviso, só o
 * valor no formulário, receber/desfazer e cancelar. Cancelado ou anonimizado: só leitura, com a mensagem da §6.2.
 * Com paciente, abrir é leitura auditada (RN-318), na transação da tela (`telaDeEdicao`, RNF-301).
 */
export default async function EditarLancamento({
  params,
  searchParams,
}: PageProps<'/painel/financeiro/lancamentos/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/financeiro/lancamentos/${id}`);
  const parametros = await searchParams;
  // RNF-301: o lançamento (com o `ler` da RN-318) e as categorias do formulário numa transação só
  const tela = await telaDeEdicao(ctx, tenant, id);
  if (!tela) notFound();
  const { lancamento: l, categorias } = tela;
  const hoje = hojeNoFuso(tenant.fuso);
  const titulo = `${M.csv.tipos[l.tipo]} — ${l.categoria.nome}`;
  const volta = `/painel/financeiro/lancamentos/${l.id}`;
  const fechado = l.anonimizado
    ? M.erros.anonimizado
    : l.situacao === 'cancelado'
      ? M.erros.cancelado
      : null;
  const consulta = l.consulta && partesNoFuso(l.consulta.inicio, tenant.fuso);

  const fixos = (
    <>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium">{M.filtros.tipo}</dt>
        <dd>{M.csv.tipos[l.tipo]}</dd>
        {l.paciente && (
          <>
            <dt className="font-medium">{M.csv.colunas.paciente}</dt>
            <dd>{l.paciente.nome}</dd>
          </>
        )}
        <dt className="font-medium">{M.filtros.situacao}</dt>
        <dd>{M.situacoes[l.situacao]}</dd>
      </dl>
      {l.consulta && consulta && (
        <p>
          <Link
            href={`/painel/agenda/consultas/${l.consulta.id}`}
            className={`inline-flex min-h-11 items-center ${LINK}`}
          >
            {M.cobrancaDaConsulta(formatarData(consulta.data), consulta.hora)}
          </Link>
        </p>
      )}
    </>
  );

  if (fechado) {
    return (
      <>
        <TopoDoFinanceiro titulo={titulo} parametros={parametros} />
        <Aviso tipo="aviso" papel="nenhum">
          {fechado}
        </Aviso>
        <div className="max-w-2xl space-y-2 rounded-3xl border border-borda bg-cartao p-5">
          {fixos}
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium">{M.campos.valor}</dt>
            <dd>{formatarReais(l.valorCentavos)}</dd>
            <dt className="font-medium">{M.campos.vencimento}</dt>
            <dd>{formatarData(l.vencimento)}</dd>
            {l.pagoEm && (
              <>
                <dt className="font-medium">{M.campos.dataDoPagamento[l.tipo]}</dt>
                <dd>{formatarData(l.pagoEm)}</dd>
              </>
            )}
            {l.forma && (
              <>
                <dt className="font-medium">{M.campos.forma}</dt>
                <dd>{M.formas[l.forma]}</dd>
              </>
            )}
            {l.descricao && (
              <>
                <dt className="font-medium">{M.csv.colunas.descricao}</dt>
                <dd>{l.descricao}</dd>
              </>
            )}
            {l.motivoCancelamento && (
              <>
                <dt className="font-medium">{M.acoes.motivo}</dt>
                <dd>{l.motivoCancelamento}</dd>
              </>
            )}
          </dl>
        </div>
      </>
    );
  }

  const bloqueado = l.paciente?.bloqueado ?? false;
  // depois de receber, desfazer ou salvar, a mesma tela volta com outro envio: o formulário e os painéis remontam com o
  // que está gravado (os campos não controlados não seguiriam o `defaultValue` novo)
  const chave = [marcadorDoEnvio(parametros.envio), l.valorCentavos, l.pagoEm, l.forma].join('|');
  return (
    <>
      <TopoDoFinanceiro titulo={titulo} parametros={parametros} />
      {bloqueado && (
        <Aviso tipo="aviso" papel="nenhum">
          {M.bloqueado}
        </Aviso>
      )}
      <div className="max-w-2xl">{fixos}</div>
      <FormLancamento
        key={chave}
        tipo={l.tipo}
        id={l.id}
        categorias={categorias}
        hoje={hoje}
        bloqueado={
          bloqueado
            ? {
                categoria: l.categoria.nome,
                vencimento: formatarData(l.vencimento),
                descricao: l.descricao ?? '',
              }
            : undefined
        }
        inicial={{
          valor: valorParaCampo(l.valorCentavos),
          categoriaId: l.categoria.id,
          vencimento: l.vencimento,
          pacienteId: '',
          descricao: l.descricao ?? '',
          jaFoi: l.pagoEm ? 'on' : '',
          pagoEm: l.pagoEm ?? '',
          forma: l.forma ?? '',
        }}
      />
      <div key={chave} className="-mx-2 flex max-w-2xl flex-wrap items-center">
        <Receber id={l.id} tipo={l.tipo} recebido={l.pagoEm !== null} hoje={hoje} volta={volta} />
        <Cancelar id={l.id} volta={volta} />
      </div>
    </>
  );
}
