import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
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
      <div className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <header data-guia="cabecalho-paciente" className="space-y-1 rounded-3xl border border-borda bg-cartao p-5 print:hidden">
          <p className="text-sm"><Link href="/painel/pacientes" className="text-link underline">Pacientes</Link></p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-titulo text-2xl font-semibold">{paciente.nome}</h1>
            {selo && <Selo>{selo}</Selo>}
          </div>
          <p className="text-sm text-suave">{partes.join(' · ')}</p>
        </header>
        {/* US-108: o termo da IA impresso sai sem o cabeçalho do paciente nem as abas */}
        <div className="print:hidden">
          <Abas patientId={paciente.id} documentos={tenant.documentosLiberados} />
        </div>
        {children}
      </div>
    </>
  );
}
