import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { filaDeEnvios } from '@/modules/pacientes/exames-enviados';
import { diasEntre, haDias, MSG_REVISAO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';

export const dynamic = 'force-dynamic';

/** US-162: a fila — os envios "recebido" de todos os pacientes, os mais antigos primeiro. Só lista (sem auditoria). */
export default async function ExamesRecebidos({ searchParams }: PageProps<'/painel/exames-recebidos'>) {
  const { ctx, tenant } = await requireNutri('/painel/exames-recebidos');
  const { recusado } = await searchParams;
  const fila = await filaDeEnvios(ctx);
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">Exames recebidos</h1>
      {recusado === '1' && <Aviso tipo="ok">{MSG_REVISAO.recusado}</Aviso>}
      {fila.length === 0 ? (
        <p>{MSG_REVISAO.filaVazia}</p>
      ) : (
        <table data-guia="fila-exames" className="w-full text-left">
          <caption className="sr-only">Exames enviados pelos pacientes aguardando revisão</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Paciente</th>
              <th scope="col">Exame</th>
              <th scope="col">Enviado em</th>
              <th scope="col">Coleta</th>
              <th scope="col">Aguardando</th>
            </tr>
          </thead>
          <tbody>
            {fila.map((e) => {
              const enviado = formatarDataNoFuso(e.enviadoEm, tenant.fuso);
              const nome = nomeDoEnvio(e.nome, enviado);
              return (
                <tr key={e.id} className="border-t border-linha">
                  <td>
                    <Link href={`/painel/exames-recebidos/${e.id}`} className="inline-flex min-h-11 items-center text-link underline">
                      {e.paciente}
                      <span className="sr-only">{` — abrir ${nome}`}</span>
                    </Link>
                  </td>
                  <td>{nome}</td>
                  <td>{enviado}</td>
                  <td>{formatarData(e.dataColeta)}</td>
                  <td>{haDias(diasEntre(hojeNoFuso(tenant.fuso, e.enviadoEm), hoje))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
