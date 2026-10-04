'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DPA_PATH, requireNutri } from '@/lib/tenant-session';
import { DPA_NAO_ACEITO, registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { atualizarPerfil, PerfilError, type ErrosPerfil } from '@/modules/plataforma/marca';

export type DpaState = { erro?: string };

export async function aceitarDpaAction(_prev: DpaState, formData: FormData): Promise<DpaState> {
  const { data, tenant, ctx } = await requireNutri(DPA_PATH, { permitirDpaPendente: true });
  if (formData.get('dpa') !== 'on') return { erro: DPA_NAO_ACEITO };
  await getDb().transaction((tx) => registrarAceiteDpa(tx, { userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null }));
  // T14: o layout do painel (cabeçalho mínimo com o DPA pendente) é reaproveitado na navegação; sem isto o menu só
  // apareceria depois de recarregar a página
  revalidatePath('/painel', 'layout');
  redirect('/painel');
}

export type PerfilState = { erros?: ErrosPerfil; ok?: boolean; valores?: Record<string, string> };

const campoPerfil = (f: FormData, k: string) => String(f.get(k) ?? '');

/** PF-N9: os valores digitados voltam em `state.valores` para o formulário não perder o que a nutricionista preencheu num erro. */
export async function salvarPerfilAction(_prev: PerfilState, formData: FormData): Promise<PerfilState> {
  const { tenant } = await requireNutri('/painel/configuracoes/perfil');
  // T10-R2: o checkbox também entra em `valores` (como 'on'/''), para o formulário conseguir
  // distinguir "não veio no submit" (renderização inicial, sem erro) de "veio desmarcado".
  const valores = {
    nomeExibicao: campoPerfil(formData, 'nomeExibicao'),
    crn: campoPerfil(formData, 'crn'),
    corPrimaria: campoPerfil(formData, 'corPrimaria'),
    enderecoConsultorio: campoPerfil(formData, 'enderecoConsultorio'),
    linkOnlinePadrao: campoPerfil(formData, 'linkOnlinePadrao'),
    antecedenciaMinH: campoPerfil(formData, 'antecedenciaMinH'),
    cancelamentoMinH: campoPerfil(formData, 'cancelamentoMinH'),
    fuso: campoPerfil(formData, 'fuso'),
    agendamentoPublicoAtivo: formData.get('agendamentoPublicoAtivo') === 'on' ? 'on' : '',
    mostrarPercGorduraPaciente: formData.get('mostrarPercGorduraPaciente') === 'on' ? 'on' : '',
  };
  try {
    await atualizarPerfil(tenant.id, {
      ...valores,
      agendamentoPublicoAtivo: valores.agendamentoPublicoAtivo === 'on',
      mostrarPercGorduraPaciente: valores.mostrarPercGorduraPaciente === 'on',
    });
  } catch (e) {
    if (e instanceof PerfilError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  return { ok: true };
}
