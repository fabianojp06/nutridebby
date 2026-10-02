'use server';

import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { requireNutri } from '@/lib/tenant-session';
import { conectarWhatsapp, desconectarWhatsapp, provedorDoApp } from '@/modules/notificacoes/whatsapp/conexao';
import { WhatsappIndisponivelError } from '@/modules/notificacoes/whatsapp/provedor';

export type ConectarState = { qr?: string; conectada?: boolean; erro?: string; envio?: number };
const MSG_FORA = 'Não foi possível falar com o serviço de WhatsApp. Tente de novo em alguns minutos.';

export async function conectarAction(): Promise<ConectarState> {
  const { ctx } = await requireNutri('/painel/whatsapp');
  const provedor = provedorDoApp();
  if (!provedor) return { erro: 'O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.' };
  try {
    const r = await conectarWhatsapp(ctx, provedor);
    revalidatePath('/painel/whatsapp');
    return r.estado === 'qr' ? { qr: r.qr, envio: Date.now() } : { conectada: true };
  } catch (e) {
    if (!(e instanceof WhatsappIndisponivelError)) throw e;
    logger.warn({ tenantId: ctx.tenantId, err: e.message }, 'falha ao conectar o WhatsApp');
    return { erro: MSG_FORA };
  }
}

export type DesconectarState = { erro?: string };

/** Revisão da T9 (c): o serviço fora do ar aparece na tela (a conexão continua; a nutricionista tenta de novo). */
export async function desconectarAction(): Promise<DesconectarState> {
  const { ctx } = await requireNutri('/painel/whatsapp');
  const provedor = provedorDoApp();
  if (!provedor) return {};
  try {
    await desconectarWhatsapp(ctx, provedor);
  } catch (e) {
    if (!(e instanceof WhatsappIndisponivelError)) throw e;
    logger.warn({ tenantId: ctx.tenantId, err: e.message }, 'falha ao desconectar o WhatsApp');
    return { erro: MSG_FORA };
  }
  revalidatePath('/painel/whatsapp');
  return {};
}
