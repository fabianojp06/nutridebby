'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { requestIp } from '@/lib/request-ip';
import { requireUserComTenant } from '@/lib/session';
import { ACESSO_DESATIVADO_PATH } from '@/lib/session-rules';
import { MSG_EQUIPE, MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';
import { aceitarTermoPendente } from '@/modules/plataforma/membro-da-equipe';
import { leuAVersaoEmVigor, MSG_TEXTO_ATUALIZADO, SIGILO_EQUIPE_VERSAO } from '@/modules/plataforma/textos-versionados';

export type AceiteDoTermoState = { erro?: string };

const M = MSG_RECEPCAO.acessoDesativado;

/**
 * Revisão do code review do PR 2 do Plano 26 (RN-500): o aceite da versão em vigor do Termo de confidencialidade da equipe
 * pela recepção que já entrou (a versão subiu, ou a senha veio de fora do convite). Tudo conferido de novo aqui, no servidor:
 * só a sessão `recepcao` (outro papel: a sessão recusa e redireciona), com o 2FA, a linha ativa em `equipe_membros` e o aceite
 * da versão em vigor ainda pendente; a versão que a página mostrou é a em vigor (P08-06); a caixa marcada. O registro é o do
 * convite (`registrarAceiteDoSigilo`: conta, consultório e IP). Depois, o painel.
 */
export async function aceitarTermoAction(_prev: AceiteDoTermoState, formData: FormData): Promise<AceiteDoTermoState> {
  const { data, membro } = await requireUserComTenant(['recepcao'], ACESSO_DESATIVADO_PATH);
  const tenantId = data.user.tenantId;
  // a conta desativada (ou sem linha, ou sem consultório) não aceita nada: só o aviso de desativada
  if (!membro?.ativo || !tenantId) return { erro: M.texto };
  // já aceito (outra aba, clique repetido): nada a gravar
  if (membro.termoAceito) redirect('/painel');
  // a página só mostra o formulário depois do 2FA (RE-D20); o POST direto sem ele também não aceita
  if (!data.user.twoFactorEnabled) return { erro: M.termoPendente };
  if (!leuAVersaoEmVigor(formData, SIGILO_EQUIPE_VERSAO)) return { erro: MSG_TEXTO_ATUALIZADO };
  if (formData.get('sigilo') !== 'on') return { erro: MSG_EQUIPE.convite.termoNaoAceito };
  const r = await aceitarTermoPendente(getDb(), { tenantId, userId: data.user.id, ip: await requestIp() });
  if (r === 'sem_acesso') return { erro: M.texto };
  redirect('/painel');
}
