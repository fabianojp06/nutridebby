'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { cancelarMeuEnvio, EnvioError } from '@/modules/portal/exames-enviados';

export type CancelarState = { erro?: string };

/** US-161 "Cancelar envio": o paciente e o consultório vêm da sessão; o módulo confere o id e a situação. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura do useActionState
export async function cancelarEnvioAction(id: string, _prev: CancelarState, _fd: FormData): Promise<CancelarState> {
  const { ctx } = await requirePaciente('/p/exames');
  try {
    await cancelarMeuEnvio(ctx, id);
  } catch (e) {
    if (!(e instanceof EnvioError)) throw e;
    // 409 = ainda processando ("Aguarde…"); 404 = já não está aguardando (cancelado em outra aba, revisado, expirado):
    // sem texto da spec, a lista refeita mostra a situação atual (em vez de um botão que não faz nada)
    if (e.erros.geral) return { erro: e.erros.geral };
    revalidatePath('/p/exames');
    return {};
  }
  revalidatePath('/p/exames');
  return {};
}
