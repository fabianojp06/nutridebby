import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { pendenciasDoPaciente } from '@/modules/financeiro/resumo';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { Receber } from '../../lancamentos/receber';
import { marcadorDoEnvio, TopoDoFinanceiro } from '../../topo';

export const dynamic = 'force-dynamic';

const LINK = 'inline-flex min-h-11 items-center text-link underline';

/**
 * US-304: as cobranças em aberto de um paciente, a mais antiga primeiro, com "Marcar como recebido" em cada uma. Receber
 * volta para esta tela com `?ok=recebido` (a action aceita este caminho): a linha sai, a mensagem aparece na região fixa
 * do topo e o foco vai ao h1 (§7). Sem pendência: o estado vazio com a volta à lista. RN-318: com cobrança devolvida, a
 * leitura é auditada ("Visualizou — Financeiro") na transação de `pendenciasDoPaciente`. Paciente de fora ou id inválido → 404.
 */
export default async function PendenciasDoPaciente({
  params,
  searchParams,
}: PageProps<'/painel/financeiro/pendencias/[patientId]'>) {
  const { patientId } = await params;
  const caminho = `/painel/financeiro/pendencias/${patientId}`;
  const { ctx, tenant } = await requireNutri(caminho);
  const parametros = await searchParams;
  const r = await pendenciasDoPaciente(ctx, tenant, patientId);
  if (!r) notFound();
  const { paciente, linhas } = r;
  const hoje = hojeNoFuso(tenant.fuso);
  const marcador = marcadorDoEnvio(parametros.envio);
  const todos = (
    <p>
      <Link href={`/painel/financeiro/lancamentos?paciente=${paciente.id}`} className={LINK}>
        {M.pendentesDoPaciente.verTodos(paciente.nome)}
      </Link>
    </p>
  );
  return (
    <>
      <TopoDoFinanceiro titulo={M.pendentesDoPaciente.titulo(paciente.nome)} parametros={parametros} />
      {paciente.bloqueado && (
        <Aviso tipo="aviso" papel="nenhum">
          {M.bloqueado}
        </Aviso>
      )}
      {linhas.length === 0 ? (
        <>
          <p>{M.pendentesDoPacienteVazio.texto(paciente.nome)}</p>
          <p>
            <Link href="/painel/financeiro/pendencias" className={LINK}>
              {M.pendentesDoPacienteVazio.voltar}
            </Link>
          </p>
          {todos}
        </>
      ) : (
        <>
          <ul className="rounded-3xl border border-borda bg-cartao px-5">
            {linhas.map((l) => {
              const data = formatarData(l.vencimento);
              const valor = formatarReais(l.valorCentavos);
              return (
                // a chave muda a cada envio: depois de receber, o painel aberto da linha fecha
                <li key={`${l.id}-${marcador}`} className="space-y-1 border-t border-linha py-3 first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 wrap-break-word">
                      {`${data} · ${l.categoria.nome}`}
                      {l.descricao && <span className="block text-sm text-suave wrap-break-word">{l.descricao}</span>}
                    </span>
                    <span className="whitespace-nowrap font-medium">{`${valor} · ${M.situacoes[l.situacao]}`}</span>
                  </div>
                  <div className="-mx-2 flex flex-wrap items-center">
                    <Receber
                      id={l.id}
                      tipo={l.tipo}
                      recebido={false}
                      hoje={hoje}
                      volta={caminho}
                      contexto={` ${[l.categoria.nome, data, valor].join(', ')}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {todos}
        </>
      )}
    </>
  );
}
