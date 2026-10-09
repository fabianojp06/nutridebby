import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import { getEnv } from '@/env';
import { painelDaAutorizacao } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO, MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';
import { configIA, estadoIaDoTenant } from '@/modules/ia/modo';
import { AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao } from '@/modules/ia/textos-legais';
import { carregarProntuario } from '../../prontuario';
import { Imprimir } from './imprimir';
import { TermoPapelForm } from './termo-papel-form';

export const dynamic = 'force-dynamic';

/**
 * US-108: o termo impresso (o texto da versão atual com o destino em uso e a forma de retirar do papel, com ou sem e-mail),
 * o nome do paciente, o código de referência (RN-107), "Recebi uma via deste termo." e os campos de data e assinatura;
 * abaixo, fora da impressão, o envio do termo assinado e a recomendação de guardar o original. Só com a IA ativa e o perfil
 * completo (D10) e com o paciente ativo. F5 (§18.5, D21): todas as páginas impressas levam no rodapé o código de referência
 * e "Página x de y" — caixa de margem do `@page` (`@bottom-center`, com `counter(page)`/`counter(pages)`), impressa pelo
 * Chrome/Edge (o navegador do consultório; o runbook e o manual guiado dizem para imprimir por eles). O código é só
 * [0-9A-Z-] (Crockford), então pode ir na string do CSS sem escape. Só esta página tira da impressão o cabeçalho do paciente e
 * as abas do layout do prontuário (`data-guia`); as outras abas continuam saindo no papel com o nome do paciente.
 */
export default async function TermoIaPage({ params }: PageProps<'/painel/pacientes/[id]/privacidade/termo-ia'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const ia = configIA(getEnv());
  const responsavel = responsavelDoTenant(tenant);
  const motivo =
    estadoIaDoTenant(tenant, ia.modo) !== 'ativa' || !ia.destino
      ? MSG_IA.indisponivel
      : !responsavel
        ? MSG_AUTORIZACAO.perfilIncompleto
        : paciente.status !== 'ativo' || paciente.anonimizadoEm
          ? MSG_FALHA.paciente_indisponivel
          : null;
  if (motivo || !responsavel || !ia.destino) return <Aviso tipo="aviso">{motivo}</Aviso>;
  const texto = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...responsavel, destino: ia.destino, canal: paciente.email ? 'papel_com_email' : 'papel_sem_email' })!;
  const { codigoDeReferencia } = await painelDaAutorizacao(ctx, paciente, ia.destino);
  const impressao = `@page { margin: 18mm 16mm 22mm; @bottom-center { content: "${MSG_AUTORIZACAO.rodapeTermo(codigoDeReferencia)} " counter(page) " de " counter(pages); font-size: 9pt; } } @media print { [data-guia="cabecalho-paciente"], [data-guia="abas-prontuario"] { display: none; } }`;
  return (
    <div className="max-w-3xl space-y-6">
      <style>{impressao}</style>
      <Imprimir />
      <div className="space-y-3 rounded-3xl border border-borda bg-cartao p-5 print:border-0 print:p-0">
        <TextoLegalView texto={texto} id="termo-ia" nivel="h2" />
        <p>{MSG_AUTORIZACAO.nomePaciente(paciente.nome)}</p>
        <p>{MSG_AUTORIZACAO.codigoReferencia(codigoDeReferencia)}</p>
        <p className="pt-4">{MSG_AUTORIZACAO.recebiVia}</p>
        <p className="pt-4">{MSG_AUTORIZACAO.campoData}</p>
        <p className="pt-4">{MSG_AUTORIZACAO.campoAssinatura}</p>
      </div>
      <section aria-labelledby="guardar-termo" className="space-y-3 print:hidden">
        <h2 id="guardar-termo" className="text-lg font-semibold">
          {MSG_AUTORIZACAO.registrarPapel}
        </h2>
        <p className="text-suave">{MSG_AUTORIZACAO.guardarOriginal}</p>
        <TermoPapelForm patientId={paciente.id} versao={AUTORIZACAO_IA_VERSAO} codigo={codigoDeReferencia} />
      </section>
    </div>
  );
}
