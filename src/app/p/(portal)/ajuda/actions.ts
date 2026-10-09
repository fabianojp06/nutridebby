'use server';

import { requirePaciente } from '@/lib/paciente-session';
import { GUIA_PORTAL } from '@/modules/ajuda/portal';
import { ESTADOS_GUIA, marcarGuia, type EstadoGuia } from '@/modules/plataforma/preferencias';

/**
 * RN-212 / CLAUDE.md regra 1: o progresso do manual guiado do portal na conta do PACIENTE da sessão (`userId` de
 * requirePaciente, nunca do formulário). Só o guia do portal, até a versão atual; o resto é recusa calada (como a do painel).
 */
export async function marcarGuiaPortalAction(versao: number, estado: EstadoGuia): Promise<void> {
  const { data } = await requirePaciente('/p/inicio');
  if (!Number.isInteger(versao) || versao < 1 || versao > GUIA_PORTAL.versao || !ESTADOS_GUIA.includes(estado)) return;
  await marcarGuia(data.user.id, GUIA_PORTAL.id, versao, estado);
}
