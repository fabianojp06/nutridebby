import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
import { temParticipacao } from '@/modules/ia/nutri-paciente/participacao';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { seloDoPaciente } from '../valores';
import { Abas } from './abas';
import { carregarProntuario } from './prontuario';

export default async function ProntuarioLayout({ children, params }: LayoutProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  // Plano 15 (US-175, DP-17): a aba "IA Nutri" com a IA Nutri ativada no consultório ou com participação (o paciente
  // arquivado ou bloqueado, ou de consultório que desligou, ainda tem a conversa e o registro da desativação)
  const iaNutri = tenant.iaNutriAtivadaEm !== null || (await temParticipacao(ctx, paciente.id));
  const selo = seloDoPaciente(paciente);
  const partes = [
    paciente.dataNascimento ? `${idadeEm(paciente.dataNascimento, hojeNoFuso(tenant.fuso))} anos` : null,
    paciente.sexo === 'F' ? 'Feminino' : paciente.sexo === 'M' ? 'Masculino' : null,
    paciente.email,
  ].filter(Boolean);
  return (
    <>
      <div className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <header data-guia="cabecalho-paciente" className="space-y-1 rounded-3xl border border-borda bg-cartao p-5">
          <p className="text-sm"><Link href="/painel/pacientes" className="text-link underline">Pacientes</Link></p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-titulo text-2xl font-semibold">{paciente.nome}</h1>
            {selo && <Selo>{selo}</Selo>}
          </div>
          <p className="text-sm text-suave">{partes.join(' · ')}</p>
        </header>
        {/* US-108: o termo da IA esconde este cabeçalho e as abas só na impressão dele (o <style> de privacidade/termo-ia/page.tsx) */}
        <Abas patientId={paciente.id} documentos={tenant.documentosLiberados} iaNutri={iaNutri} />
        {children}
      </div>
    </>
  );
}
