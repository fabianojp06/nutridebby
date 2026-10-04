import { ConfirmarBotao } from '@/components/confirmar-botao';
import { signFileUrl } from '@/lib/signed-url';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { listarExames } from '@/modules/pacientes/exames';
import { carregarProntuario } from '../prontuario';
import { excluirExameAction } from './actions';
import { ExameForm } from './exame-form';

export const dynamic = 'force-dynamic';

export default async function ExamesPage({ params }: PageProps<'/painel/pacientes/[id]/exames'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarExames(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="space-y-8">
      {!bloqueado && (
        <section aria-labelledby="novo-exame" className="max-w-4xl space-y-3">
          <h2 id="novo-exame" className="text-lg font-semibold">Novo exame</h2>
          <ExameForm patientId={paciente.id} hoje={hojeNoFuso(tenant.fuso)} />
        </section>
      )}
      <section aria-labelledby="exames" className="space-y-4">
        <h2 id="exames" className="text-lg font-semibold">Exames</h2>
        {lista.length === 0 && <p>Nenhum exame registrado.</p>}
        {lista.map((e) => (
          <article key={e.id} aria-labelledby={`exame-${e.id}`} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id={`exame-${e.id}`} className="font-semibold">{`${e.titulo} · ${formatarData(e.data)}`}</h3>
              <span className="flex gap-4">
                {e.arquivoPath && (
                  <a href={signFileUrl(e.arquivoPath)} rel="noreferrer" className="text-link underline">Baixar laudo</a>
                )}
                {!bloqueado && (
                  <form action={excluirExameAction.bind(null, paciente.id, e.id)}>
                    <ConfirmarBotao mensagem="Excluir este exame e o laudo?" rotulo={`Excluir o exame ${e.titulo} de ${formatarData(e.data)}`}>Excluir</ConfirmarBotao>
                  </form>
                )}
              </span>
            </div>
            {e.valores.length > 0 && (
              <table className="w-full text-left">
                <caption className="sr-only">{`Valores do exame ${e.titulo}`}</caption>
                <thead className="text-sm text-suave">
                  <tr>
                    <th scope="col">Marcador</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Referência</th>
                  </tr>
                </thead>
                <tbody>
                  {e.valores.map((v, i) => (
                    <tr key={`${i}-${v.nome}`} className="border-t">
                      <td>{v.nome}</td>
                      <td>{`${formatarDecimal(v.valor, casasDecimais(v.valor))}${v.unidade ? ` ${v.unidade}` : ''}`}</td>
                      <td>{v.referencia ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
