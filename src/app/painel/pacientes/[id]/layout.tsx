import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
import { linhaDoCabecalho } from '@/modules/ficha/cabecalho';
import { MSG_FICHA } from '@/modules/ficha/textos';
import { temParticipacao } from '@/modules/ia/nutri-paciente/participacao';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { seloDoPaciente } from '../valores';
import { Abas } from './abas';
import { carregarCabecalho, carregarProntuario } from './prontuario';

export default async function ProntuarioLayout({ children, params }: LayoutProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  // Plano 15 (US-175, DP-17): a aba "IA Nutri" com a IA Nutri ativada no consultório ou com participação (o paciente
  // arquivado ou bloqueado, ou de consultório que desligou, ainda tem a conversa e o registro da desativação)
  // Plano 18 (D13, RN-275): a última avaliação, uma leitura auditada por execução do layout; as duas consultas em paralelo
  const [iaNutri, cabecalho] = await Promise.all([
    tenant.iaNutriAtivadaEm !== null ? true : temParticipacao(ctx, paciente.id),
    carregarCabecalho(id),
  ]);
  const medidas = linhaDoCabecalho(cabecalho);
  const selo = seloDoPaciente(paciente);
  const nomeSocial = paciente.nomeSocial;
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
            {/* D7, RN-266: com nome social, a tela abre por ele e o papel pelo nome civil (Res. CFN 594/2017, art. 4º, § 1º, I) */}
            {nomeSocial ? (
              <h1 className="font-titulo text-2xl font-semibold">
                <span className="print:hidden">{nomeSocial}</span>
                <span className="hidden print:inline">{paciente.nome}</span>
              </h1>
            ) : (
              <h1 className="font-titulo text-2xl font-semibold">{paciente.nome}</h1>
            )}
            {selo && <Selo>{selo}</Selo>}
            {paciente.pesoOcultoNoAppEm && <Selo>{MSG_FICHA.cabecalho.pesoOculto}</Selo>}
          </div>
          {nomeSocial && (
            <>
              <p className="text-sm print:hidden">{MSG_FICHA.cabecalho.nomeDeRegistro(paciente.nome)}</p>
              <p className="hidden text-sm print:block">{MSG_FICHA.cabecalho.nomeSocial(nomeSocial)}</p>
            </>
          )}
          <p className="text-sm text-suave">{partes.join(' · ')}</p>
          {/* RN-275: as medidas não saem no papel (a folha pode ir para a mão do paciente com o peso oculto, RN-203) */}
          <p className="text-sm print:hidden">{medidas}</p>
        </header>
        {/* US-108: o termo da IA esconde este cabeçalho e as abas só na impressão dele (o <style> de privacidade/termo-ia/page.tsx) */}
        <Abas patientId={paciente.id} documentos={tenant.documentosLiberados} iaNutri={iaNutri} />
        {children}
      </div>
    </>
  );
}
