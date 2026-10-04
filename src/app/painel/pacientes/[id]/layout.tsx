import Link from 'next/link';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { seloDoPaciente } from '../valores';
import { Abas } from './abas';
import { carregarProntuario } from './prontuario';

export default async function ProntuarioLayout({ children, params }: LayoutProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { tenant, paciente } = await carregarProntuario(id);
  const selo = seloDoPaciente(paciente);
  const partes = [
    paciente.dataNascimento ? `${idadeEm(paciente.dataNascimento, hojeNoFuso(tenant.fuso))} anos` : null,
    paciente.sexo === 'F' ? 'Feminino' : paciente.sexo === 'M' ? 'Masculino' : null,
    paciente.email,
  ].filter(Boolean);
  return (
    <>
      <div className="space-y-4 p-6">
        <header className="space-y-1">
          <p className="text-sm"><Link href="/painel/pacientes" className="underline">Pacientes</Link></p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{paciente.nome}</h1>
            {selo && <span className="rounded bg-zinc-200 px-2 py-0.5 text-sm text-zinc-900">{selo}</span>}
          </div>
          <p className="text-sm text-zinc-700">{partes.join(' · ')}</p>
        </header>
        <Abas patientId={paciente.id} />
        {children}
      </div>
    </>
  );
}
