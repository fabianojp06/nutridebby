import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { configIA } from '@/modules/ia/modo';
import { MSG_IA_NUTRI, NOME_IA_NUTRI, SESSAO_MS } from '@/modules/ia/nutri-paciente/constantes';
import { conversaDoPaciente } from '@/modules/ia/nutri-paciente/conversa';
import { entradaDoPaciente, temConversaGuardada } from '@/modules/ia/nutri-paciente/estado';
import { idValido } from '@/modules/pacientes/base';
import { planoDoPaciente } from '@/modules/portal/plano';
import { Conversa } from './conversa';
import { ORIGENS_IA_NUTRI } from './origem';
import { ComTelefones } from './texto-fixo';

export const dynamic = 'force-dynamic';

/**
 * `?sobre=<id da refeição>` → "Sobre {nome da refeição}: " resolvido NO SERVIDOR contra as refeições do plano publicado do
 * próprio paciente; id inválido, de outra refeição ou texto qualquer → nada. O texto da URL nunca chega ao campo.
 */
async function textoSobreRefeicao(ctx: TenantContext, fuso: string, sobre: string): Promise<string | null> {
  if (!idValido(sobre)) return null;
  const plano = await planoDoPaciente(ctx, fuso);
  const r = plano?.refeicoes.find((x) => x.id === sobre);
  return r ? `Sobre ${r.nome}: ` : null;
}

/**
 * Plano 15 (D29, §7.8, US-172): a conversa mora dentro de Plano (`secaoDe` casa por prefixo: a seção Plano fica marcada sem
 * mudar SECOES_DO_PORTAL). Não abre sem internet (o service worker serve a cópia de /p/plano). Sem consentimento → a tela
 * de decisão (nada lido antes), salvo o "Ler as conversas" de Eu (`?ler=1`) com conversa guardada: só para ler (revisão
 * da T12, I5); bloqueado, consultório desligado, pausa, sem plano ou sem IA_PROVEDOR → o aviso e a conversa guardada só
 * para ler (aviso da T7: o link "Ler as conversas" de Eu › Privacidade continua valendo no modo
 * ausente). RN-173: a mensagem de abertura aparece ANTES da próxima pergunta quando a conversa está vazia ou a última
 * mensagem tem mais de 30 min (sessão nova) — decidido aqui, pelo relógio do servidor. §7.8: "Como a IA Nutri funciona",
 * aberto na 1ª vez.
 */
export default async function IaNutri({ searchParams }: PageProps<'/p/plano/ia'>) {
  const { ctx, tenant } = await requirePaciente('/p/plano/ia');
  const ia = configIA(getEnv());
  const entrada = await entradaDoPaciente(ctx, tenant, ia);
  const busca = await searchParams;
  // "Ler as conversas" de Eu › Privacidade (`?ler=1`, valor fixo): volta para Eu e, com algo a decidir, só lê
  const ler = busca.ler === '1';
  const aDecidir = entrada === 'decidir' || entrada === 'texto_mudou';
  // Revisão da T12 (I5; §7.6, RN-182, LGPD art. 18, II): o titular lê as conversas guardadas sem aceitar o texto de agora
  // (texto mudou, ou desativou com a mensagem de risco guardada pela D22). Sem conversa guardada (só a existência, sem
  // auditRead), ou vindo de Plano para perguntar → a tela de decisão, sem ler nada.
  if (aDecidir && !(ler && (await temConversaGuardada(ctx)))) {
    redirect(`/p/plano/ia/autorizar?de=${ler ? 'eu' : 'plano'}${entrada === 'texto_mudou' ? '&mudou=1' : ''}`);
  }
  const mensagens = await conversaDoPaciente(ctx);
  const podePerguntar = entrada === 'conversa';
  const ultima = mensagens.at(-1);
  const agora = new Date(); // o relógio do servidor, como em /p/plano
  const sessaoNova = podePerguntar && (!ultima || agora.getTime() - new Date(ultima.criadaEm).getTime() > SESSAO_MS);
  const { sobre } = busca;
  const textoInicial = podePerguntar && typeof sobre === 'string' ? await textoSobreRefeicao(ctx, tenant.fuso, sobre) : null;
  return (
    <>
      <CabecalhoDetalhe titulo={NOME_IA_NUTRI} voltar={ler ? ORIGENS_IA_NUTRI.eu : ORIGENS_IA_NUTRI.plano} />
      <main className="space-y-4 p-4">
        <p className="text-sm">
          <ComTelefones texto={MSG_IA_NUTRI.emergencia} />
        </p>
        <details open={mensagens.length === 0} className="rounded-2xl border border-borda px-3">
          {/* o summary com 44 px (min-h no próprio list-item; nunca block/flex/grid: some o marcador ▶/▼, molde do Plano) */}
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">{MSG_IA_NUTRI.comoFunciona}</summary>
          <div className="space-y-2 pb-3">
            {MSG_IA_NUTRI.comoFuncionaTexto.map((t) => (
              <p key={t}>
                <ComTelefones texto={t} />
              </p>
            ))}
          </div>
        </details>
        {entrada === 'sem_plano' && <p role="status">{MSG_IA_NUTRI.semPlano}</p>}
        {(entrada === 'indisponivel' || entrada === 'nenhuma') && <p role="status">{MSG_IA_NUTRI.naoDisponivel}</p>}
        {aDecidir && (
          <div className="space-y-2">
            {entrada === 'texto_mudou' && <p role="status" className="font-semibold">{MSG_IA_NUTRI.textoMudou}</p>}
            <Link href="/p/plano/ia/autorizar?de=eu" className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4 font-semibold">
              {MSG_IA_NUTRI.lerEDecidir}
            </Link>
          </div>
        )}
        <Conversa tenantId={tenant.id} mensagens={mensagens} podePerguntar={podePerguntar} sessaoNova={sessaoNova} textoInicial={textoInicial} />
      </main>
    </>
  );
}
