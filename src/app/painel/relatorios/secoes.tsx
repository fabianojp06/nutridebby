import Link from 'next/link';
import { BotaoLink } from '@/components/ui/botao';
import { textoTaxa } from '@/modules/agenda/presenca';
import { formatarDecimal } from '@/lib/numero';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { taxaDeFaltas } from '@/modules/relatorios/agenda';
import { MSG_RELATORIOS, type Secao } from '@/modules/relatorios/constantes';
import { mesPorExtenso } from '@/modules/relatorios/periodo';
import type {
  DadosDaSecao,
  LinhaContagem,
  RelAgenda,
  RelAtendimentos,
  RelFinanceiro,
  RelPacientes,
  RelPlanos,
  RelRanking,
} from '@/modules/relatorios/tipos';
import { BarrasPorMes } from './barras';
import { Bloco, Notas, Tabela, type LinhaDaTabela } from './tabela';

/**
 * Plano 26, T3 (US-480 a US-485, §6.2): o conteúdo de cada seção, o mesmo na tela e na impressão (RN-495: "as mesmas
 * tabelas da tela, sem barras"). Na impressão (`impressao`), o Ranking mostra o nome de registro, sem link (RN-492), e os
 * links para outras telas ("Configurar o Financeiro", "Fluxo de caixa…") ficam de fora. Só formata: os números vêm prontos.
 */
const M = MSG_RELATORIOS;
const SEM_VALOR = '—';
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
/** RN-486: uma casa, vírgula; com total 0, "—". */
const percentual = (n: number, base: number) =>
  base > 0 ? `${formatarDecimal((n / base) * 100, 1)}%` : SEM_VALOR;
const LINK = 'inline-flex min-h-11 items-center text-link underline';

/** US-486: "Ainda não há dados neste período." — nada para contar na seção. */
export function semDados<S extends Secao>(secao: S, dados: DadosDaSecao[S]): boolean {
  switch (secao) {
    case 'pacientes': {
      const d = dados as RelPacientes;
      return d.situacao.total === 0 && d.novosPorMes.every((m) => m.n === 0);
    }
    case 'atendimentos':
      return (dados as RelAtendimentos).meses.every(
        (m) => m.atendidos + m.consultasRealizadas + m.atendimentosRegistrados === 0,
      );
    case 'planos': {
      const d = dados as RelPlanos;
      return d.hoje.ativos === 0 && d.meses.every((m) => m.publicacoes === 0);
    }
    case 'agenda':
      return (dados as RelAgenda).meses.every(
        (m) => m.marcadas + m.canceladasPaciente + m.canceladasConsultorio === 0,
      );
    case 'financeiro': {
      const d = dados as RelFinanceiro;
      // não configurado tem o próprio estado vazio (US-484)
      return (
        d.configurado &&
        d.meses.every((m) => m.recebido === 0 && !m.pago) &&
        !d.porCategoria.entradas.length &&
        !d.porCategoria.saidas.length
      );
    }
    case 'ranking':
      // o Ranking diz "vazio" dentro do próprio bloco, abaixo do título do critério escolhido
      return false;
  }
  return false;
}

const linhaDoMes = (mes: string, valores: (string | number)[]): LinhaDaTabela => ({
  chave: mes,
  rotulo: mesPorExtenso(mes),
  valores,
});

function Pacientes({ d }: { d: RelPacientes }) {
  const L = M.pacientes.linhas;
  const T = M.pacientes.titulos;
  const comPercentual = (linhas: LinhaContagem[], recuo = false): LinhaDaTabela[] =>
    linhas.map((l) => ({
      chave: l.rotulo,
      rotulo: l.rotulo,
      valores: [l.n, percentual(l.n, d.situacao.ativos)],
      recuo,
    }));
  const colunas = ['', M.csv.pacientes, M.csv.percentual];
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Bloco id="rel-situacao" titulo={T.situacao}>
          <Tabela
            id="rel-situacao-tabela"
            titulo={T.situacao}
            colunas={['', M.csv.pacientes]}
            linhas={[
              { chave: 'ativos', rotulo: L.ativos, valores: [d.situacao.ativos] },
              { chave: 'arquivados', rotulo: L.arquivados, valores: [d.situacao.arquivados] },
              // RE-D39: na sessão da recepção a linha não existe
              ...(d.situacao.bloqueados === undefined
                ? []
                : [
                    { chave: 'bloqueados', rotulo: L.bloqueados, valores: [d.situacao.bloqueados] },
                  ]),
              { chave: 'total', rotulo: L.total, valores: [d.situacao.total], destaque: true },
            ]}
          />
          <Notas
            textos={[
              d.situacao.bloqueados === undefined
                ? M.pacientes.notas.recepcao
                : M.pacientes.notas.anonimizados,
            ]}
          />
        </Bloco>
        <Bloco id="rel-sexo" titulo={T.sexo}>
          <Tabela
            id="rel-sexo-tabela"
            titulo={T.sexo}
            colunas={colunas}
            linhas={comPercentual(d.sexo)}
          />
        </Bloco>
        <Bloco id="rel-fase" titulo={T.fase}>
          <Tabela
            id="rel-fase-tabela"
            titulo={T.fase}
            colunas={colunas}
            linhas={[...comPercentual(d.fase), ...comPercentual(d.faixas, true)]}
          />
          <Notas textos={[M.pacientes.notas.arredondados]} />
        </Bloco>
      </div>
      <Bloco id="rel-novos" titulo={T.novos}>
        <Tabela
          id="rel-novos-tabela"
          titulo={T.novos}
          rolavel
          colunas={[M.atendimentos.colunas.mes, M.csv.novos]}
          linhas={[
            ...d.novosPorMes.map((m) => linhaDoMes(m.mes, [m.n])),
            {
              chave: 'total',
              rotulo: L.total,
              valores: [soma(d.novosPorMes.map((m) => m.n))],
              destaque: true,
            },
          ]}
        />
      </Bloco>
    </>
  );
}

function Atendimentos({ d }: { d: RelAtendimentos }) {
  const C = M.atendimentos.colunas;
  return (
    <Bloco id="rel-atendimentos" titulo={M.titulosDaSecao.atendimentos}>
      <Tabela
        id="rel-atendimentos-tabela"
        titulo={M.titulosDaSecao.atendimentos}
        rolavel
        colunas={[
          C.mes,
          C.atendidos,
          C.novos,
          C.retorno,
          C.consultasRealizadas,
          C.atendimentosRegistrados,
        ]}
        linhas={d.meses.map((m) =>
          linhaDoMes(m.mes, [
            m.atendidos,
            m.novos,
            m.retorno,
            m.consultasRealizadas,
            m.atendimentosRegistrados,
          ]),
        )}
      />
      <Notas textos={[M.atendimentos.notas.umaVez, M.atendimentos.notas.retorno]} />
    </Bloco>
  );
}

function Planos({ d }: { d: RelPlanos }) {
  const C = M.planos.colunas;
  return (
    <>
      <p className="rounded-3xl border border-borda bg-cartao p-5 font-semibold print:border-0 print:p-0">
        {M.planos.cartaoHoje(d.hoje.comPlano, d.hoje.ativos)}
      </p>
      <Bloco id="rel-planos" titulo={M.titulosDaSecao.planos}>
        <Tabela
          id="rel-planos-tabela"
          titulo={M.titulosDaSecao.planos}
          rolavel
          colunas={[C.mes, C.publicacoes, C.pacientes]}
          linhas={d.meses.map((m) => linhaDoMes(m.mes, [m.publicacoes, m.pacientes]))}
        />
        <Notas textos={[M.planos.notas.publicacoes]} />
      </Bloco>
    </>
  );
}

function Agenda({ d, impressao }: { d: RelAgenda; impressao: boolean }) {
  const C = M.agenda.colunas;
  // Plano 23 (T11a): as colunas das previsões só quando a leitura as traz
  const comPrevisoes = d.meses.some((m) => m.retornosPrevistos !== undefined);
  const taxa = (m: RelAgenda['meses'][number]) => textoTaxa(taxaDeFaltas(m), m.faltas, m.iniciadas);
  return (
    <Bloco id="rel-agenda" titulo={M.titulosDaSecao.agenda}>
      {!impressao && (
        <BarrasPorMes
          meses={d.meses.map((m) => m.mes)}
          series={[
            {
              rotulo: C.realizadas,
              fill: 'fill-ok',
              bg: 'bg-ok',
              valores: d.meses.map((m) => m.realizadas),
            },
            {
              rotulo: C.faltas,
              fill: 'fill-erro',
              bg: 'bg-erro',
              valores: d.meses.map((m) => m.faltas),
            },
          ]}
        />
      )}
      <Tabela
        id="rel-agenda-tabela"
        titulo={M.titulosDaSecao.agenda}
        rolavel
        colunas={[
          C.mes,
          C.marcadas,
          C.realizadas,
          C.faltas,
          C.taxa,
          C.canceladasPaciente,
          C.canceladasConsultorio,
          C.marcadasPeloPaciente,
          C.retornos,
          ...(comPrevisoes ? [C.retornosPrevistos, C.previstosComConsulta] : []),
        ]}
        linhas={d.meses.map((m) =>
          linhaDoMes(m.mes, [
            m.marcadas,
            m.realizadas,
            m.faltas,
            taxa(m),
            m.canceladasPaciente,
            m.canceladasConsultorio,
            m.marcadasPeloPaciente,
            m.retornos,
            ...(comPrevisoes ? [m.retornosPrevistos ?? 0, m.previstosComConsulta ?? 0] : []),
          ]),
        )}
      />
      <Notas textos={[M.agenda.notaTaxa]} />
    </Bloco>
  );
}

function Financeiro({ d, impressao }: { d: RelFinanceiro; impressao: boolean }) {
  const F = M.financeiro;
  const C = F.colunas;
  if (!d.configurado) {
    return (
      <div className="space-y-3">
        <p>{F.naoConfigurado}</p>
        {!impressao && (
          <BotaoLink href="/painel/financeiro/configuracoes">{F.configurar}</BotaoLink>
        )}
      </div>
    );
  }
  const semLocal = d.meses.some((m) => m.pago === null);
  const valor = (v: number | null) => (v === null ? SEM_VALOR : formatarReais(v));
  const recebido = soma(d.meses.map((m) => m.recebido));
  const pago = semLocal ? null : soma(d.meses.map((m) => m.pago ?? 0));
  const linha = (
    chave: string,
    rotulo: string,
    r: number,
    p: number | null,
    destaque = false,
  ): LinhaDaTabela => ({
    chave,
    rotulo,
    valores: [formatarReais(r), valor(p), p === null ? SEM_VALOR : formatarReais(r - p)],
    destaque,
  });
  const categorias = (id: string, coluna: string, linhas: { categoria: string; valor: number }[]) =>
    linhas.length > 0 && (
      <Tabela
        id={id}
        titulo={`${F.porCategoria}: ${coluna}`}
        colunas={[M.csv.categoria, coluna]}
        linhas={linhas.map((l, i) => ({
          chave: `${i}`,
          rotulo: l.categoria,
          valores: [formatarReais(l.valor)],
        }))}
      />
    );
  return (
    <>
      <Bloco id="rel-financeiro" titulo={M.titulosDaSecao.financeiro}>
        {!impressao && (
          <BarrasPorMes
            meses={d.meses.map((m) => m.mes)}
            series={[
              {
                rotulo: C.recebido,
                fill: 'fill-ok',
                bg: 'bg-ok',
                valores: d.meses.map((m) => m.recebido),
              },
              ...(semLocal
                ? []
                : [
                    {
                      rotulo: C.pago,
                      fill: 'fill-erro',
                      bg: 'bg-erro',
                      valores: d.meses.map((m) => m.pago ?? 0),
                    },
                  ]),
            ]}
          />
        )}
        <Tabela
          id="rel-financeiro-tabela"
          titulo={M.titulosDaSecao.financeiro}
          rolavel
          colunas={[C.mes, C.recebido, C.pago, C.resultado]}
          linhas={[
            ...d.meses.map((m) => linha(m.mes, mesPorExtenso(m.mes), m.recebido, m.pago)),
            linha('total', M.pacientes.linhas.total, recebido, pago, true),
          ]}
        />
        {semLocal && <Notas textos={[F.saidasSemLocal]} />}
        {!impressao && (
          <Link href="/painel/financeiro/relatorios" className={LINK}>
            {F.linkFluxo}
          </Link>
        )}
      </Bloco>
      {(d.porCategoria.entradas.length > 0 || d.porCategoria.saidas.length > 0) && (
        <Bloco id="rel-categorias" titulo={F.porCategoria}>
          <div className="grid gap-4 md:grid-cols-2">
            {categorias('rel-categorias-entradas', C.recebido, d.porCategoria.entradas)}
            {categorias('rel-categorias-saidas', C.pago, d.porCategoria.saidas)}
          </div>
        </Bloco>
      )}
    </>
  );
}

/** RN-492: na tela, o nome exibido com link para a ficha (`prefetch={false}`); na impressão, o nome de registro, sem link. */
function Ranking({ d, impressao }: { d: RelRanking; impressao: boolean }) {
  const C = M.ranking.colunas;
  const titulo = M.ranking.titulos[d.por];
  return (
    <Bloco id="rel-ranking" titulo={titulo}>
      {d.linhas.length === 0 ? (
        <p>{M.vazio}</p>
      ) : (
        <table className="min-w-full text-left text-sm tabular-nums [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2 [&_thead_th:last-child]:text-right">
          <caption id="rel-ranking-caption" className="sr-only">
            {titulo}
          </caption>
          <thead>
            <tr>
              <th scope="col">{C.posicao}</th>
              <th scope="col">{impressao ? C.pacienteRegistro : C.paciente}</th>
              <th scope="col">{d.por === 'consultas' ? C.consultas : C.receita}</th>
            </tr>
          </thead>
          <tbody>
            {d.linhas.map((l, i) => (
              <tr key={l.patientId} className="border-t border-linha">
                <td>{i + 1}</td>
                <th scope="row" className="font-normal">
                  {impressao ? (
                    l.nomeRegistro
                  ) : (
                    <Link
                      href={`/painel/pacientes/${l.patientId}`}
                      prefetch={false}
                      className={LINK}
                    >
                      {l.nomeExibido}
                    </Link>
                  )}
                </th>
                <td className="whitespace-nowrap text-right">
                  {d.por === 'consultas' ? l.valor : formatarReais(l.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Bloco>
  );
}

export function ConteudoDaSecao<S extends Secao>({
  secao,
  dados,
  impressao = false,
}: {
  secao: S;
  dados: DadosDaSecao[S];
  impressao?: boolean;
}) {
  switch (secao) {
    case 'pacientes':
      return <Pacientes d={dados as RelPacientes} />;
    case 'atendimentos':
      return <Atendimentos d={dados as RelAtendimentos} />;
    case 'planos':
      return <Planos d={dados as RelPlanos} />;
    case 'agenda':
      return <Agenda d={dados as RelAgenda} impressao={impressao} />;
    case 'financeiro':
      return <Financeiro d={dados as RelFinanceiro} impressao={impressao} />;
    case 'ranking':
      return <Ranking d={dados as RelRanking} impressao={impressao} />;
  }
  return null;
}
