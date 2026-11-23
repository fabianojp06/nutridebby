'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { FORMAS_TCLE, type FormaTcle } from '@/db/schema';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { liberarConversa, pausarConversa, retomarConversa } from '@/modules/mensagens/conversa';
import { enviarComoNutri } from '@/modules/mensagens/envio';

const M = MSG_MENSAGENS;
const caminho = (patientId: string) => `/painel/mensagens/${patientId}`;

/**
 * O estado do campo (useActionState): o texto volta sempre (o que foi escrito nunca se perde no erro; no sucesso, vazio) e
 * `marca` muda a cada resposta, para o campo remontar com o texto devolvido.
 */
export type EstadoDoEnvio = { marca: string; erro: string | null; texto: string; enviada: boolean };
/** O estado do diálogo de liberação: a forma e a confirmação voltam marcadas; `semCarimbo` mostra o link ao Perfil. */
export type EstadoDaLiberacao = { marca: string; erro: string | null; forma: string; confirmou: boolean; semCarimbo: boolean };
/** O estado do diálogo de pausa (só o erro do carimbo, com o link ao Perfil, ou o genérico). */
export type EstadoDaPausa = { erro: string | null; semCarimbo: boolean };

/** RN-470: o erro inesperado vai ao log só com o nome, o SQLSTATE e o id (nunca texto); a tela mostra o texto genérico. */
function registrarFalha(acao: string, err: unknown, patientId: string) {
  logger.error({ err: nomeDoErro(err), sqlstate: sqlstateDoErro(err), patientId, acao }, 'falha numa ação da conversa no painel');
}

/**
 * US-441: envia texto ao paciente. Erros do módulo (vazio, longo, conversa fechada, carimbo) com o texto da §6.2 e o texto
 * de volta; erro inesperado (paciente de outro consultório, o 42501 do gatilho quando o carimbo some entre a conferência e
 * o INSERT) → "Não foi possível enviar. Tente de novo.", nunca um 500 cru. Enviou → o menu e a conversa refazem
 * (revalidatePath do layout). Sem JS (RNF-443), o campo não manda `js=1`: a página volta pelo redirect (POST → GET).
 */
export async function enviarAction(patientId: string, _anterior: EstadoDoEnvio | null, dados: FormData): Promise<EstadoDoEnvio> {
  const { ctx } = await requireNutri('/painel/mensagens');
  const texto = typeof dados.get('texto') === 'string' ? (dados.get('texto') as string) : '';
  const comJs = dados.get('js') === '1';
  let r: Awaited<ReturnType<typeof enviarComoNutri>>;
  try {
    r = await enviarComoNutri(ctx, patientId, { texto });
  } catch (err) {
    registrarFalha('enviar', err, patientId);
    return { marca: randomUUID(), erro: M.erros.falha, texto, enviada: false };
  }
  if ('erro' in r) return { marca: randomUUID(), erro: r.mensagem, texto, enviada: false };
  revalidatePath('/painel', 'layout');
  if (!comJs) redirect(caminho(patientId));
  return { marca: randomUUID(), erro: null, texto: '', enviada: true };
}

/**
 * US-440 (RN-441): libera com a forma do TCLE e a confirmação. Sem uma delas, o erro junto ao campo (nada gravado). Liberou
 * → `?ok=liberada`; já liberada ou titular inativo → a conversa como está; sem carimbo → o texto com o link ao Perfil.
 */
export async function liberarAction(patientId: string, _anterior: EstadoDaLiberacao | null, dados: FormData): Promise<EstadoDaLiberacao> {
  const { ctx } = await requireNutri('/painel/mensagens');
  const forma = typeof dados.get('forma') === 'string' ? (dados.get('forma') as string) : '';
  const confirmou = dados.get('confirmacao') === 'sim';
  const estado = (erro: string, semCarimbo = false): EstadoDaLiberacao => ({ marca: randomUUID(), erro, forma, confirmou, semCarimbo });
  if (!(FORMAS_TCLE as readonly string[]).includes(forma) || !confirmou) return estado(M.liberacao.erro);
  let r: Awaited<ReturnType<typeof liberarConversa>>;
  try {
    r = await liberarConversa(ctx, patientId, { forma: forma as FormaTcle, confirmou: true });
  } catch (err) {
    registrarFalha('liberar', err, patientId);
    return estado(M.erros.falha);
  }
  if (r === 'sem_carimbo') return estado(M.liberacao.semCarimbo, true);
  revalidatePath('/painel', 'layout');
  redirect(r === 'ok' ? `${caminho(patientId)}?ok=liberada` : caminho(patientId));
}

/**
 * US-450 (RN-442): pausa. Pausou → `?ok=pausada`; não liberada, já pausada ou titular inativo → a conversa como está;
 * sem carimbo (CH-D74: a pausa guarda o nome e o CRN) → o texto com o link ao Perfil.
 */
export async function pausarAction(patientId: string): Promise<EstadoDaPausa> {
  const { ctx } = await requireNutri('/painel/mensagens');
  let r: Awaited<ReturnType<typeof pausarConversa>>;
  try {
    r = await pausarConversa(ctx, patientId);
  } catch (err) {
    registrarFalha('pausar', err, patientId);
    return { erro: M.erros.falha, semCarimbo: false };
  }
  if (r === 'sem_carimbo') return { erro: M.erros.semCarimbo, semCarimbo: true };
  revalidatePath('/painel', 'layout');
  redirect(r === 'ok' ? `${caminho(patientId)}?ok=pausada` : caminho(patientId));
}

/** US-450: retoma, sem novo TCLE. Retomou → `?ok=retomada`; senão, a conversa como está. */
export async function retomarAction(patientId: string): Promise<void> {
  const { ctx } = await requireNutri('/painel/mensagens');
  let r: Awaited<ReturnType<typeof retomarConversa>> | 'falha';
  try {
    r = await retomarConversa(ctx, patientId);
  } catch (err) {
    registrarFalha('retomar', err, patientId);
    r = 'falha';
  }
  revalidatePath('/painel', 'layout');
  redirect(r === 'ok' ? `${caminho(patientId)}?ok=retomada` : caminho(patientId));
}
