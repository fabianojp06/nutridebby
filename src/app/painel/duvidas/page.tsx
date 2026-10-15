import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { filaDeDuvidas } from '@/modules/ia/nutri-paciente/duvidas';
import { horasDesde, ROTULO_DO_SELO } from './apresentacao';

export const dynamic = 'force-dynamic';

/**
 * US-175 "Fila": as dúvidas abertas dos pacientes — "Sinal de risco" no topo, depois as mais antigas — com o paciente, "há
 * {n} horas" e o selo. Só lista (sem auditoria, como "Exames recebidos"); abrir é auditado. `?vista=1` (de "Marcar como
 * vista") vai para a região `role="status"` sempre montada.
 */
export default async function Duvidas({ searchParams }: PageProps<'/painel/duvidas'>) {
  const { ctx } = await requireNutri('/painel/duvidas');
  const { vista } = await searchParams;
  const fila = await filaDeDuvidas(ctx);
  const agora = new Date();
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">{MSG_IA_NUTRI.fila}</h1>
      <p role="status">{vista === '1' ? MSG_IA_NUTRI.vista : ''}</p>
      {fila.length === 0 ? (
        <p>{MSG_IA_NUTRI.filaVazia}</p>
      ) : (
        <table data-guia="fila-duvidas" className="w-full text-left">
          <caption className="sr-only">Dúvidas enviadas pelos pacientes aguardando a nutricionista</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Paciente</th>
              <th scope="col">Recebida</th>
              <th scope="col">Situação</th>
              <th scope="col">
                <span className="sr-only">Ação</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fila.map((d) => (
              <tr key={d.id} className="border-t border-linha">
                <td>{d.paciente}</td>
                <td>{MSG_IA_NUTRI.haHoras(horasDesde(d.criadaEm, agora))}</td>
                <td>{d.selo ? <Selo>{ROTULO_DO_SELO[d.selo]}</Selo> : null}</td>
                <td>
                  {/* abrir grava aberta_pela_nutri_em, audita e apaga a de risco revogada (D22): nada de prefetch */}
                  <Link href={`/painel/duvidas/${d.id}`} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
                    Abrir dúvida
                    <span className="sr-only">{` de ${d.paciente}`}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
