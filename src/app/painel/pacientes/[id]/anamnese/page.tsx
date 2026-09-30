import Link from 'next/link';
import { listarAnamneses, listarModelos } from '@/modules/pacientes/anamnese';
import { formatarData } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

export default async function AnamnesesPage({
  params,
}: PageProps<'/painel/pacientes/[id]/anamnese'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const [lista, modelos] = await Promise.all([
    listarAnamneses(ctx, paciente.id),
    listarModelos(ctx),
  ]);
  return (
    <div className="space-y-8">
      {paciente.status !== 'bloqueado' && (
        <form
          action={`/painel/pacientes/${paciente.id}/anamnese/nova`}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1">
            <label htmlFor="modelo" className="block font-medium">
              Modelo
            </label>
            <select id="modelo" name="modelo" className="rounded border p-2">
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
          <button className="rounded bg-emerald-700 px-4 py-2 text-white">
            Preencher anamnese
          </button>
        </form>
      )}
      <section aria-labelledby="anamneses" className="space-y-2">
        <h2 id="anamneses" className="text-lg font-semibold">
          Anamneses
        </h2>
        {lista.length === 0 ? (
          <p>Nenhuma anamnese preenchida.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link
                  href={`/painel/pacientes/${paciente.id}/anamnese/${a.id}`}
                  className="underline"
                >{`${formatarData(a.data)} · ${a.nomeModelo}`}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
