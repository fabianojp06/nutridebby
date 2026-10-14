import 'server-only';
import type { PatientRow, TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { motivoDoPaciente, situacaoIaDoPaciente } from '@/modules/ia/autorizacao';
import { MSG_FALHA, MSG_IA, type MotivoFalha } from '@/modules/ia/constantes';
import { situacaoDaCotaIa } from '@/modules/ia/cota';
import { configIA, estadoIaComPaciente } from '@/modules/ia/modo';
import { iaNoExame, type IaNoExame } from './exames/ia-exame';

/**
 * Plano 14B (US-120, US-121; RN-100): o que a página do paciente e a aba Plano alimentar mostram do resumo e do rascunho —
 * com as mesmas regras e os mesmos textos da aba Exames (`iaNoExame`): o link quando dá para pedir, ou o aviso do estado
 * (aditivo, liberação, retenção), da autorização do paciente para ESTE uso (US-105: sem autorização ou retirada), do
 * paciente indisponível ou da cota. `null` = nada aparece: IA da plataforma ausente, consultório suspenso, paciente não
 * ativo, ou IA ainda não ativada (US-101: antes de ativar, os botões não aparecem e nenhum aviso sai). Sem auditoria (só
 * a situação, como a aba Exames).
 */
export async function iaDoAssistente(
  ctx: TenantContext,
  tenant: TenantRow,
  paciente: Pick<PatientRow, 'id' | 'status' | 'anonimizadoEm'>,
  uso: 'resumo_historico' | 'rascunho_plano',
  agora: Date = new Date(),
): Promise<IaNoExame | null> {
  const ia = configIA(getEnv());
  const estadoIa = estadoIaComPaciente(tenant, ia);
  if (paciente.status !== 'ativo' || estadoIa === 'ausente' || estadoIa === 'suspensa') return null;
  const [situacao, cota] = await Promise.all([
    situacaoIaDoPaciente(ctx, paciente.id, ia.destino),
    estadoIa === 'ativa' ? situacaoDaCotaIa(ctx, tenant, agora) : null,
  ]);
  const r = iaNoExame({ estadoIa, motivo: motivoDoPaciente(paciente, situacao, uso), situacao, cota });
  return r.podePedir || r.aviso ? r : null;
}

/**
 * US-122: o texto da tarefa que falhou. `padrao` = o "Não foi possível gerar agora…" da tela (resumo ou rascunho); o
 * rascunho passa também o `limite` (limite de voltas, prazo ou teto de custo).
 */
export function textoDaFalha(erro: MotivoFalha | null, o: { padrao: string; limite?: string }): string {
  if (o.limite && (erro === 'limite_voltas' || erro === 'limite_custo')) return o.limite;
  if (erro === 'sem_autorizacao' || erro === 'paciente_indisponivel') return MSG_FALHA[erro];
  if (erro === 'cota') return MSG_IA.cotaAcabou;
  if (erro === 'ia_desligada' || erro === 'teto_plataforma') return MSG_IA.indisponivel;
  return o.padrao;
}
