import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { MSG_G } from '@/components/portal/textos';
import { TextoLegalView } from '@/components/texto-legal';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { blocoIaDoApp } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao } from '@/modules/ia/textos-legais';
import { autorizarIaAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * US-106 "Ler e autorizar": a autorização numa página própria, com o texto inteiro e em destaque, separada do termo do app
 * (art. 33, VIII; C12). Só com algo a decidir (IA ativa no consultório do vínculo aberto, perfil completo, não vigente);
 * senão volta a Eu. "Agora não" não grava nada (volta a Eu, na âncora do bloco de IA, com "Tudo bem…"). Plano 16: tela de detalhe de Eu, com o
 * cabeçalho compacto e "Voltar para Eu" (como "Meus documentos").
 */
export default async function AutorizacaoIa() {
  const { ctx, tenant } = await requirePaciente('/p/perfil/ia');
  const ia = configIA(getEnv());
  const bloco = await blocoIaDoApp(ctx, tenant, ia);
  const responsavel = responsavelDoTenant(tenant);
  if (!bloco?.podeDecidir || bloco.situacao.tipo === 'vigente' || !responsavel || !ia.destino) redirect('/p/perfil');
  const texto = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...responsavel, destino: ia.destino, canal: 'app' });
  if (!texto) redirect('/p/perfil');
  return (
    <>
      <CabecalhoDetalhe titulo={MSG_AUTORIZACAO.blocoTitulo} voltar={{ href: '/p/perfil', secao: MSG_G.titulos.eu }} />
      <main className="space-y-4 p-4">
        <p className="text-suave">{tenant.nomeExibicao}</p>
        <section className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <TextoLegalView texto={texto} id="autorizacao-ia" nivel="h2" classeTitulo="font-portal-titulo text-lg font-bold" />
        </section>
        <div className="flex flex-wrap gap-3">
          <form action={autorizarIaAction.bind(null, tenant.id)}>
            <button className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">{MSG_AUTORIZACAO.autorizo}</button>
          </form>
          <Link href="/p/perfil?ia=agora-nao#eu-ia" className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4">
            {MSG_AUTORIZACAO.agoraNao}
          </Link>
        </div>
      </main>
    </>
  );
}
