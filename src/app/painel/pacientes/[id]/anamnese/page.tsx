import Link from 'next/link';
import { listarAnamneses, listarModelos } from '@/modules/pacientes/anamnese';
import { formatarData } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

export default async function AnamnesesPage({ params }: PageProps<'/painel/pacientes/[id]/anamnese'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const [lista, modelos] = await Promise.all([listarAnamneses(ctx, paciente.id), listarModelos(ctx)]);
  return (
    <div className="space-y-8">
      {paciente.status !== 'bloqueado' && (
        <form method="get" action={`/painel/pacientes/${paciente.id}/anamnese/nova`} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="modelo" className="block font-medium">Modelo</label>
            <select id="modelo" name="modelo" className="rounded-xl border border-campo bg-cartao p-2 text-texto">
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Preencher anamnese</button>
        </form>
      )}
      <section aria-labelledby="anamneses" className="space-y-2">
        <h2 id="anamneses" className="text-lg font-semibold">Anamneses</h2>
        {lista.length === 0 ? (
          <p>Nenhuma anamnese preenchida.</p>
        ) : (
          <ul className="divide-y divide-linha">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/painel/pacientes/${paciente.id}/anamnese/${a.id}`} className="text-link underline">{`${formatarData(a.data)} · ${a.nomeModelo}`}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
