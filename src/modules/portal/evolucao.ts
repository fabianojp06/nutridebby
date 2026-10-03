import { getDb, type Db } from '@/db/client';
import type { TenantContext } from '@/db/tenant';
import { listarAntropometrias } from '@/modules/pacientes/antropometria';
import { orientacoesDoPaciente } from '@/modules/pacientes/atendimentos';
import { diferencas, seriesDasAvaliacoes, type Diferenca, type SerieEvolucao } from '@/modules/pacientes/evolucao';
import { pacienteDaSessao } from './sessao';

/** D14: o que o paciente vê da antropometria. Dobras, densidade e exames nunca; % de gordura só com a opção do tenant. */
const permitida = (id: string, mostrarPercGordura: boolean) => id === 'peso' || id === 'imc' || id.startsWith('circ_') || (mostrarPercGordura && id === 'perc_gordura');

/** US-044: gráficos de peso e medidas e as orientações de cada consulta. Leituras auditadas (D22). */
export async function evolucaoParaPaciente(ctx: TenantContext, tenant: { mostrarPercGorduraPaciente: boolean }, db: Db = getDb()) {
  const patientId = pacienteDaSessao(ctx, 'evolucaoParaPaciente');
  // Mesma leitura auditada do painel (D22): a RLS do contexto de paciente restringe às linhas dele.
  const avaliacoes = await listarAntropometrias(ctx, patientId, db);
  const series: SerieEvolucao[] = seriesDasAvaliacoes(avaliacoes).filter((s) => permitida(s.id, tenant.mostrarPercGorduraPaciente));
  const difs: Diferenca[] = diferencas(series);
  const orientacoes = await orientacoesDoPaciente(ctx, db);
  return { avaliacoes: avaliacoes.length, series, diferencas: difs, orientacoes };
}
