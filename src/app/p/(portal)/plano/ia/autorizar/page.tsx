import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { TextoLegalView } from '@/components/texto-legal';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { configIA } from '@/modules/ia/modo';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { entradaDoPaciente } from '@/modules/ia/nutri-paciente/estado';
import { IA_NUTRI_TERMO_VERSAO, responsavelDoTenant, textoDoConsentimentoIaNutri, textoExibidoIaNutri } from '@/modules/ia/textos-legais';
import { aceitarIaNutriAction } from '../actions';
import { ORIGENS_IA_NUTRI, origemIaNutri } from '../origem';

export const dynamic = 'force-dynamic';

/**
 * US-171 "Antes de usar a IA Nutri" (molde de /p/perfil/ia, 14A): o texto inteiro do consentimento, em destaque, na
 * variante do destino em uso, numa página própria. Só com algo a decidir (entrada `decidir` ou `texto_mudou`) e o perfil
 * da responsável completo; senão volta à origem. `?de=` só da lista fechada (`ORIGENS_IA_NUTRI`): "Agora não" e "Voltar"
 * levam a ela, nunca a uma URL da busca, e nada é gravado. "Autorizo o uso da IA Nutri" leva o texto mostrado (versão e
 * destino) à ação, que o confere com o de agora antes de gravar. Sem caixa de seleção (padrão da 14A).
 */
export default async function AutorizarIaNutri({ searchParams }: PageProps<'/p/plano/ia/autorizar'>) {
  const { ctx, tenant } = await requirePaciente('/p/plano/ia/autorizar');
  const busca = await searchParams;
  const de = origemIaNutri(busca.de);
  const origem = ORIGENS_IA_NUTRI[de];
  const ia = configIA(getEnv());
  const entrada = await entradaDoPaciente(ctx, tenant, ia);
  const responsavel = responsavelDoTenant(tenant);
  if ((entrada !== 'decidir' && entrada !== 'texto_mudou') || !responsavel || !ia.destino) redirect(origem.href);
  const texto = textoDoConsentimentoIaNutri(IA_NUTRI_TERMO_VERSAO, { ...responsavel, destino: ia.destino });
  if (!texto) redirect(origem.href);
  const aviso = busca.mudou === '1' ? MSG_IA_NUTRI.textoMudouNoToque : entrada === 'texto_mudou' ? MSG_IA_NUTRI.textoMudou : '';
  return (
    <>
      <CabecalhoDetalhe titulo={texto.titulo} voltar={origem} />
      <main className="space-y-4 p-4">
        <p className="text-suave">{tenant.nomeExibicao}</p>
        {aviso && <p role="status" className="font-semibold">{aviso}</p>}
        <section className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <TextoLegalView texto={texto} id="consentimento-ia-nutri" nivel="h2" classeTitulo="font-portal-titulo text-lg font-bold" />
        </section>
        <div className="flex flex-wrap gap-3">
          <form action={aceitarIaNutriAction.bind(null, tenant.id, textoExibidoIaNutri(ia.destino), de)}>
            <button className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">{MSG_IA_NUTRI.autorizo}</button>
          </form>
          <Link href={origem.href} className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4">
            {MSG_IA_NUTRI.agoraNao}
          </Link>
        </div>
      </main>
    </>
  );
}
