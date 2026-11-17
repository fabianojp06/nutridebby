import Link from 'next/link';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { AVISO_PORTAL } from '@/modules/ajuda/portal';
import { blocoIaDoApp, type SituacaoAutorizacao } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { blocoIaNutriDoApp } from '@/modules/ia/nutri-paciente/estado';
import { temLembretesNaTela } from '@/modules/lembretes/paciente';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { situacaoDoWhatsapp } from '@/modules/portal/perfil';
import { molduraDaSecao } from '../../moldura';
import { AtivarNotificacoes } from '../../notificacoes';
import { SairPortal } from '../../sair-portal';
import { InstalarNoEu } from './instalar-no-eu';
import { Privacidade, type BlocoIaNaTela } from './privacidade';
import { WhatsappForm } from './whatsapp-form';

export const dynamic = 'force-dynamic';

const CARTAO = 'space-y-2 rounded-2xl border border-borda bg-cartao p-4';
const H2 = 'font-portal-titulo text-lg font-bold';
const LINK = 'inline-flex min-h-11 items-center font-semibold text-link underline';

/**
 * US-106 / US-109: a frase da situação e os botões do bloco de IA (datas no fuso do consultório). "Ler e decidir" só com
 * algo a decidir (D10) e sem autorização em vigor; "Retirar autorização" sempre que houver uma autorização dada que não foi
 * retirada (US-106 "Retirar sempre possível", também com a IA desligada). O retorno vem só dos dois valores conhecidos do
 * `?ia=` (nunca o texto da URL).
 */
function blocoNaTela(b: { situacao: SituacaoAutorizacao; podeDecidir: boolean }, fuso: string, ia: string | undefined): BlocoIaNaTela {
  const s = b.situacao;
  const data = (d: Date) => formatarDataNoFuso(d, fuso);
  const situacao =
    s.tipo === 'vigente' ? MSG_AUTORIZACAO.voceAutorizou(data(s.em), s.versao)
    : s.tipo === 'retirada' ? MSG_AUTORIZACAO.voceRetirou(data(s.em))
    : s.tipo === 'nunca' ? MSG_AUTORIZACAO.voceNaoAutorizou
    : MSG_AUTORIZACAO.textoMudou; // versão antiga ou outro destino (RN-109)
  return {
    situacao,
    lerEDecidir: b.podeDecidir && s.tipo !== 'vigente',
    retirar: s.tipo === 'vigente' || s.tipo === 'versao_antiga' || s.tipo === 'outro_destino',
    retorno: ia === 'autorizou' ? MSG_AUTORIZACAO.registradaApp : ia === 'agora-nao' ? MSG_AUTORIZACAO.tudoBem : '',
  };
}

/**
 * Plano 16 (US-197, G-01g, molde D-Assuntos): Eu — a conta, o consultório ("Trocar de nutricionista" com 2+ vínculos,
 * RN-210), Meus documentos (US-146: só com os documentos liberados, D20 do 10A), Lembretes (Plano 17: com lembrete ligado pela equipe),
 * Notificações (push e WhatsApp), Instalar
 * o app, Privacidade (US-046 + RN-214 + o bloco de IA do Plano 14A, US-106/US-109), Como usar o app (/p/ajuda, RN-212) e, no fim, Sair (RN-211). "Meus exames" saiu daqui: Exames
 * é seção (G-D9).
 */
export default async function Eu({ searchParams }: PageProps<'/p/perfil'>) {
  const acesso = await requirePaciente('/p/perfil');
  const { ctx, data, tenant, vinculo, vinculos } = acesso;
  const busca = await searchParams;
  const ia = configIA(getEnv());
  const [moldura, whatsapp, bloco, iaNutri, comLembretes] = await Promise.all([
    molduraDaSecao(acesso),
    situacaoDoWhatsapp(ctx),
    blocoIaDoApp(ctx, tenant, ia),
    blocoIaNutriDoApp(ctx, tenant, ia),
    temLembretesNaTela(ctx),
  ]);
  const blocoIa = bloco ? blocoNaTela(bloco, tenant.fuso, typeof busca.ia === 'string' ? busca.ia : undefined) : null;
  return (
    <>
      <Faixa {...moldura} atual="/p/perfil" titulo={MSG_G.titulos.eu} />
      <main className="space-y-4 p-4">
        <section aria-labelledby="eu-conta" className={CARTAO}>
          <h2 id="eu-conta" className={H2}>Conta</h2>
          <p>{`Conectado como ${data.user.email}.`}</p>
        </section>
        <section aria-labelledby="eu-consultorio" className={CARTAO}>
          <h2 id="eu-consultorio" className={H2}>Consultório</h2>
          {/* US-197: "o consultório (logo, nome)" — o logo como na faixa (URL assinada de 5 min, fundo branco) */}
          <p className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, sem otimização do Next */}
            {moldura.marca.logoUrl && <img src={moldura.marca.logoUrl} alt={`Logo de ${moldura.marca.nome}`} className="h-10 w-auto rounded bg-white p-1" />}
            <span>{moldura.marca.nome}</span>
          </p>
          {vinculos.length > 1 && (
            <Link href="/p/escolher?volta=%2Fp%2Finicio" className={LINK}>
              Trocar de nutricionista
            </Link>
          )}
        </section>
        {tenant.documentosLiberados && (
          <section aria-labelledby="eu-documentos" className={CARTAO}>
            <h2 id="eu-documentos" className={H2}>Meus documentos</h2>
            <Link href="/p/documentos" className={LINK}>
              Ver meus documentos
            </Link>
          </section>
        )}
        {/* Plano 17 (Tarefa 6, revisão T6-01): com algum lembrete ligado pela equipe, mesmo que o paciente tenha desligado todos
            ou pausado — é o caminho para religar (§5.3); o cartão de Hoje usa temLembretes */}
        {comLembretes && (
          <section aria-labelledby="eu-lembretes" className={CARTAO}>
            <h2 id="eu-lembretes" className={H2}>Lembretes</h2>
            <Link href="/p/perfil/lembretes" className={LINK}>
              Ver meus lembretes
            </Link>
          </section>
        )}
        <section aria-labelledby="notificacoes" className={CARTAO}>
          <h2 id="notificacoes" className={H2}>Notificações</h2>
          <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
          <WhatsappForm ativo={whatsapp.ativo} />
        </section>
        <InstalarNoEu />
        <section aria-labelledby="privacidade" className={CARTAO}>
          <h2 id="privacidade" className={H2}>Privacidade</h2>
          <Privacidade ia={blocoIa} iaNutri={iaNutri} />
        </section>
        {/* Plano 16 (US-199, RN-212): o manual do portal, que também reabre o tour */}
        <p>
          <Link href="/p/ajuda" className={LINK}>
            {AVISO_PORTAL.comoUsar}
          </Link>
        </p>
        {/* RN-211: o "Sair" do portal fica no fim de "Eu". <div>, não <p>: o SairPortal é um <form>, e <form> dentro de <p>
            quebra a hidratação (o parser do HTML fecha o <p> antes do <form>) */}
        <div>
          <SairPortal />
        </div>
      </main>
    </>
  );
}
