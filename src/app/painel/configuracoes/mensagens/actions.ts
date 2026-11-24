'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { requireNutri } from '@/lib/tenant-session';
import { salvarConfiguracao } from '@/modules/mensagens/horario';
import { configDoFormulario, estadoDeFalha, type EstadoDoHorario } from './formulario';

const CAMINHO = '/painel/configuracoes/mensagens';

/**
 * US-446 (RN-451, RN-472): grava o horário e o aviso por e-mail. Erro de faixa → o texto da §6.2 junto à faixa e o que foi
 * enviado de volta (nada gravado). Erro inesperado → "Não foi possível salvar. Tente de novo." (CH-D76) com o que foi
 * enviado de volta; o log leva só o nome e o SQLSTATE. Formulário que o `<select>` não produz → Error (adulteração).
 * Gravou → a tela com "Configuração salva." (`?ok=salva`; `r` muda a cada gravação, para a região refocar e reanunciar).
 */
export async function salvarHorarioAction(_anterior: EstadoDoHorario | null, dados: FormData): Promise<EstadoDoHorario> {
  const { ctx } = await requireNutri(CAMINHO);
  const config = configDoFormulario(dados);
  let r: Awaited<ReturnType<typeof salvarConfiguracao>>;
  try {
    r = await salvarConfiguracao(ctx, config);
  } catch (err) {
    logger.error({ err: nomeDoErro(err), sqlstate: sqlstateDoErro(err), tenantId: ctx.tenantId }, 'falha ao salvar o atendimento por mensagens');
    return estadoDeFalha(dados, config);
  }
  if (r !== 'ok') {
    const k = config.faixas.slice(0, r.indice + 1).filter((x) => x.diaSemana === r.diaSemana).length;
    return { ...estadoDeFalha(dados, config), erroGeral: undefined, erro: { dia: r.diaSemana, k, mensagem: r.mensagem } };
  }
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?ok=salva&r=${randomBytes(4).toString('hex')}`);
}
