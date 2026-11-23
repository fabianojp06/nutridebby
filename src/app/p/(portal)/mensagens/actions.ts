'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_PORTAL_MENSAGENS, type CodigoTextoFixo } from '@/modules/mensagens/constantes';
import { enviarComoPaciente } from '@/modules/mensagens/envio';

const CAMINHO = '/p/mensagens';

/**
 * O estado do campo (useActionState): o texto volta sempre (o que foi escrito nunca se perde no erro; no sucesso, vazio),
 * `marca` muda a cada resposta (o campo remonta com o texto devolvido) e `textoFixo` traz o sinal de risco (RN-449): no
 * envio gravado, o socorro aparece sob a mensagem (e recebe o foco); no "muitas" recusado, junto ao campo.
 */
export type EstadoDoEnvioPortal = { marca: string; erro: string | null; texto: string; enviada: boolean; textoFixo: CodigoTextoFixo | null };

/**
 * US-443: o paciente envia texto à nutricionista. Erros do módulo (vazio, longo, pausada, muitas) com o texto da §6.2 e o
 * rascunho de volta; erro inesperado → "Não foi possível enviar. Tente de novo.", com log só do nome, do SQLSTATE e da ação
 * (RN-470: nunca o texto). Enviou → a conversa refaz (revalidatePath). Sem JS (RNF-443), o campo não manda `js=1`: a página
 * volta pelo redirect (POST → GET), com a mensagem e, se houver, o socorro sob ela.
 */
export async function enviarMensagemAction(_anterior: EstadoDoEnvioPortal | null, dados: FormData): Promise<EstadoDoEnvioPortal> {
  const { ctx } = await requirePaciente(CAMINHO);
  const texto = typeof dados.get('texto') === 'string' ? (dados.get('texto') as string) : '';
  const comJs = dados.get('js') === '1';
  let r: Awaited<ReturnType<typeof enviarComoPaciente>>;
  try {
    r = await enviarComoPaciente(ctx, { texto });
  } catch (err) {
    logger.error({ err: nomeDoErro(err), sqlstate: sqlstateDoErro(err), acao: 'enviar' }, 'falha ao enviar mensagem pelo app');
    return { marca: randomUUID(), erro: MSG_PORTAL_MENSAGENS.erros.falha, texto, enviada: false, textoFixo: null };
  }
  if ('erro' in r) return { marca: randomUUID(), erro: r.mensagem, texto, enviada: false, textoFixo: r.textoFixo ?? null };
  revalidatePath(CAMINHO);
  if (!comJs) redirect(CAMINHO);
  return { marca: randomUUID(), erro: null, texto: '', enviada: true, textoFixo: r.textoFixo };
}
