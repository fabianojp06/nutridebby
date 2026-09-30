import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { buscarPaciente } from '@/modules/pacientes/pacientes';

/**
 * Uma leitura (auditada, US-007) do paciente por requisição, compartilhada entre o layout e a
 * página pelo `cache` do React — sem isso, cada abertura gravaria duas linhas "Visualizou".
 * Paciente de outro tenant ou id malformado → 404.
 */
export const carregarProntuario = cache(async (id: string) => {
  const acesso = await requireNutri(`/painel/pacientes/${id}`);
  const paciente = await buscarPaciente(acesso.ctx, id);
  if (!paciente) notFound();
  return { ...acesso, paciente };
});
