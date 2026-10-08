import { getDb, type Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { listarAntropometrias } from '@/modules/pacientes/antropometria';
import { diferencas, seriesDasAvaliacoes, type Diferenca, type SerieEvolucao } from '@/modules/pacientes/evolucao';
import { pesoOcultoNaTransacao, semPeso } from '@/modules/pacientes/peso-oculto';
import { pacienteDaSessao } from './sessao';

/** D14: o que o paciente vê da antropometria. Dobras, densidade e exames nunca; % de gordura só com a opção do tenant. */
const permitida = (id: string, mostrarPercGordura: boolean) => id === 'peso' || id === 'imc' || id.startsWith('circ_') || (mostrarPercGordura && id === 'perc_gordura');

/**
 * US-044 / Plano 16: as medidas de "Todas as medidas" (tabela por avaliação e gráficos). Leitura auditada (D22). As
 * orientações moram na Jornada (`jornadaDoPaciente`, que faz a leitura auditada delas); aqui seriam uma leitura sem tela.
 * Plano 16 (RN-203): com "Não mostrar peso no app", peso e IMC saem AQUI, antes de montar a resposta — nenhum componente
 * recebe o valor (CS-194).
 */
export async function evolucaoParaPaciente(ctx: TenantContext, tenant: { mostrarPercGorduraPaciente: boolean }, db: Db = getDb()) {
  const patientId = pacienteDaSessao(ctx, 'evolucaoParaPaciente');
  const oculto = await withTenant(ctx, (tx) => pesoOcultoNaTransacao(tx, patientId), db);
  // Mesma leitura auditada do painel (D22): a RLS do contexto de paciente restringe às linhas dele.
  const avaliacoes = await listarAntropometrias(ctx, patientId, db);
  const todas: SerieEvolucao[] = seriesDasAvaliacoes(avaliacoes).filter((s) => permitida(s.id, tenant.mostrarPercGorduraPaciente));
  const series = oculto ? semPeso(todas) : todas;
  const difs: Diferenca[] = diferencas(series);
  return { avaliacoes: avaliacoes.length, series, diferencas: difs };
}
