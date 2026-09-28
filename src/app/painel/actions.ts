'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DPA_PATH, requireNutri } from '@/lib/tenant-session';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';

export type DpaState = { erro?: string };

export async function aceitarDpaAction(_prev: DpaState, formData: FormData): Promise<DpaState> {
  const { data, tenant, ctx } = await requireNutri(DPA_PATH, { permitirDpaPendente: true });
  if (formData.get('dpa') !== 'on') return { erro: 'Para continuar, aceite o contrato de tratamento de dados (DPA).' };
  await getDb().transaction((tx) => registrarAceiteDpa(tx, { userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null }));
  redirect('/painel');
}
