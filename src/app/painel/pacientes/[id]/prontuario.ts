import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { lerCabecalho, type Cabecalho } from '@/modules/ficha/cabecalho';
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

/**
 * Plano 18 (D13, RN-275): a última avaliação do cabeçalho, lida uma vez por requisição (chave texto, como
 * `carregarProntuario`; o ctx vem dele) com UM auditRead de antropometria. Fica aqui, e não em `src/modules`, porque
 * `src/modules` não importa de `@/app`; o layout e as páginas nunca chamam `lerCabecalho` direto (cabecalho-fonte.test.ts).
 */
export const carregarCabecalho = cache(async (patientId: string): Promise<Cabecalho> => {
  const { ctx, paciente } = await carregarProntuario(patientId);
  return lerCabecalho(ctx, paciente.id);
});
