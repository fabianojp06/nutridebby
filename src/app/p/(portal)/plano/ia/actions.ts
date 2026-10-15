'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { clientIp } from '@/lib/ip';
import { requirePaciente } from '@/lib/paciente-session';
import { configIA } from '@/modules/ia/modo';
import { aceitarNoApp } from '@/modules/ia/nutri-paciente/consentimento';
import { MSG_IA_NUTRI, type CodigoPergunta } from '@/modules/ia/nutri-paciente/constantes';
import { avaliar, encaminhar, enviarANutri, perguntar } from '@/modules/ia/nutri-paciente/conversa';
import { IaNutriError } from '@/modules/ia/nutri-paciente/participacao';
import type { CodigoTextoFixo } from '@/modules/ia/nutri-paciente/textos';
import { origemIaNutri } from './origem';

/**
 * O que a conversa recebe de volta: nunca o texto da pergunta. `limpar` = a pergunta foi gravada (o campo esvazia); `feito`
 * = a avaliação ou o encaminhamento foi gravado (a tela muda o item sem reler a conversa, /code-review do PR #37).
 */
export type RetornoConversa = { aviso?: string; limpar?: boolean; textoFixo?: CodigoTextoFixo | null; feito?: boolean; risco?: boolean };

/**
 * Revisão da T12 (I1): o sinal de risco — "A resposta chegou." na região de status e o foco no texto fixo (com o 188 e o
 * 192), que o leitor de tela lê; nunca a região vazia. Gravada a mensagem, o texto fixo vem na conversa relida.
 */
const retornoDoRisco = (textoFixo: CodigoTextoFixo | null, mensagemId: string | null): RetornoConversa => ({
  limpar: true,
  textoFixo: mensagemId ? null : textoFixo,
  aviso: MSG_IA_NUTRI.respostaChegou,
  risco: true,
});

const MSG_DO_CODIGO: Partial<Record<CodigoPergunta, string>> = {
  limite_dia: MSG_IA_NUTRI.limiteDia,
  limite_mes: MSG_IA_NUTRI.limiteMes,
  em_andamento: MSG_IA_NUTRI.emAndamento,
  indisponivel: MSG_IA_NUTRI.naoDisponivel,
  sem_plano: MSG_IA_NUTRI.semPlano,
};

/** RN-183: IP e user-agent da requisição (como em Eu › Privacidade). */
async function origemDaRequisicao() {
  const h = await headers();
  return { ip: clientIp(h, getEnv().TRUSTED_PROXIES), userAgent: h.get('user-agent') };
}

const depsDaConversa = async () => {
  const env = getEnv();
  return { ia: configIA(env), appUrl: env.APP_URL, ...(await origemDaRequisicao()) };
};

/**
 * US-172: a pergunta. `tenantId` = o consultório que a tela mostrou (troca de vínculo em outra aba → nada gravado). Sem
 * redirect: devolve o retorno; o `revalidatePath('/p/plano/ia')` da própria action atualiza a tela na mesma ida (a conversa
 * mostra a pergunta e "Pensando…", ou o texto fixo do risco na hora; com risco sem mensagem gravada — teto do dia ou IA Nutri
 * indisponível —, o texto fixo vem no retorno).
 */
export async function perguntarAction(tenantId: string, fd: FormData): Promise<RetornoConversa> {
  const { ctx } = await requirePaciente('/p/plano/ia');
  if (ctx.tenantId !== tenantId) redirect('/p/plano/ia');
  try {
    const r = await perguntar(ctx, String(fd.get('texto') ?? ''), await depsDaConversa());
    revalidatePath('/p/plano/ia');
    if (r.codigo === 'ok') return { limpar: true };
    if (r.codigo === 'risco') return retornoDoRisco(r.textoFixo, r.mensagemId);
    return { aviso: MSG_DO_CODIGO[r.codigo] ?? MSG_IA_NUTRI.naoDisponivel };
  } catch (e) {
    if (e instanceof IaNutriError) return { aviso: e.mensagem };
    throw e;
  }
}

/** DP-16: "Enviar direto para minha nutricionista" do formulário (também com o limite do dia/mês ou a cota esgotada). */
export async function enviarANutriAction(tenantId: string, fd: FormData): Promise<RetornoConversa> {
  const { ctx } = await requirePaciente('/p/plano/ia');
  if (ctx.tenantId !== tenantId) redirect('/p/plano/ia');
  try {
    const r = await enviarANutri(ctx, String(fd.get('texto') ?? ''), await depsDaConversa());
    revalidatePath('/p/plano/ia');
    if (r.codigo === 'encaminhada') return { limpar: true, aviso: MSG_IA_NUTRI.encaminhada };
    if (r.codigo === 'risco') return retornoDoRisco(r.textoFixo, r.mensagemId);
    return { aviso: r.codigo === 'limite' ? MSG_IA_NUTRI.limiteDuvidas : MSG_IA_NUTRI.naoDisponivel };
  } catch (e) {
    if (e instanceof IaNutriError) return { aviso: e.mensagem };
    throw e;
  }
}

/**
 * US-172 "Ajudou / Não ajudou". Sem `revalidatePath` (/code-review do PR #37): reler a página relê a conversa, e cada leitura
 * grava um auditRead; a tela troca os botões por "Obrigado pela avaliação." pelo estado local (`feito`). Id ou valor fora do
 * formato (argumentos vindos do cliente) → "não disponível", nunca erro 500 (`avaliar` devolve false sem tocar o banco).
 */
export async function avaliarAction(tenantId: string, mensagemId: string, valor: string): Promise<RetornoConversa> {
  const { ctx } = await requirePaciente('/p/plano/ia');
  if (ctx.tenantId !== tenantId) redirect('/p/plano/ia');
  if (valor !== 'ajudou' && valor !== 'nao_ajudou') return { aviso: MSG_IA_NUTRI.naoDisponivel };
  return (await avaliar(ctx, mensagemId, valor)) ? { feito: true, aviso: MSG_IA_NUTRI.avaliado } : { aviso: MSG_IA_NUTRI.naoDisponivel };
}

/**
 * US-174 / RN-177: "Enviar para minha nutricionista" abaixo da resposta (ou da pergunta que falhou). Sem `revalidatePath`, como
 * avaliar. A RN-170 (/code-review do PR #37: aba antiga depois de pausa, bloqueio ou desativação) com a configuração do
 * servidor, como perguntar; fora dela → "A IA Nutri não está disponível no momento.".
 */
export async function encaminharAction(tenantId: string, perguntaId: string): Promise<RetornoConversa> {
  const { ctx } = await requirePaciente('/p/plano/ia');
  if (ctx.tenantId !== tenantId) redirect('/p/plano/ia');
  const r = await encaminhar(ctx, perguntaId, await depsDaConversa());
  if (r === 'encaminhada') return { feito: true, aviso: MSG_IA_NUTRI.encaminhada };
  return { aviso: r === 'limite' ? MSG_IA_NUTRI.limiteDuvidas : MSG_IA_NUTRI.naoDisponivel };
}

/**
 * US-171 "Autorizo o uso da IA Nutri" (/p/plano/ia/autorizar). `exibido` = o texto que a página mostrou (versão e destino,
 * `textoExibidoIaNutri`), conferido com o de agora por `aceitarNoApp`; `de` = a origem, só da lista fechada (`origemIaNutri`).
 * Aceite → a conversa. O texto mudou entre a leitura e o toque → a tela de decisão de novo, com "O texto mudou. Leia de novo
 * antes de decidir.". Outra recusa (paciente bloqueado, consultório desligado, pausa) → Plano com "A IA Nutri não está
 * disponível no momento." (`?ia-nutri=indisponivel`, valor de lista fechada; nunca um redirect mudo — revisão final da 14A).
 * Os redirects ficam fora do try (o redirect do Next é um erro).
 */
export async function aceitarIaNutriAction(tenantId: string, exibido: unknown, de: string): Promise<void> {
  const { ctx } = await requirePaciente('/p/plano/ia/autorizar');
  if (ctx.tenantId !== tenantId) redirect('/p/plano/ia');
  const origem = origemIaNutri(de);
  let destino = '/p/plano/ia';
  try {
    await aceitarNoApp(ctx, exibido, await depsDaConversa());
  } catch (e) {
    if (!(e instanceof IaNutriError)) throw e;
    destino = e.mensagem === MSG_IA_NUTRI.textoMudouNoToque ? `/p/plano/ia/autorizar?de=${origem}&mudou=1` : '/p/plano?ia-nutri=indisponivel';
  }
  redirect(destino);
}
