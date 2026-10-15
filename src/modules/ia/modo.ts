import type { TenantRow } from '@/db/schema';
import { DESTINO_DO_PROVEDOR, MODELOS_IA, usdParaMicro, type DestinoIA, type GeoIA, type ModeloIA, type ProvedorConfigurado, type RegiaoIA } from './constantes';
import { IA_ADITIVO_VERSAO_MIN, versaoAtende } from './textos-legais';

export { MODELOS_IA };

/** `ausente` = sem IA_PROVEDOR (nada aparece); `emergencia` = IA_DESLIGADA=1 (aparece "indisponível"). */
export type ModoIA = 'ausente' | 'emergencia' | ProvedorConfigurado;
/**
 * A retenção do fornecedor que libera o uso com dado de paciente (RN-100): `zero` = retenção zero confirmada
 * (IA_RETENCAO_ZERO=1: ZDR da Anthropic concedida por escrito, ou o Bedrock na UE conferido no runbook — A-D4);
 * `30-dias` = só na Anthropic direta, a retenção padrão (até 30 dias, segurança e abuso, sem treino) aceita pelo dono
 * (IA_RETENCAO_ACEITA_30_DIAS=1, A-D27, 09/10/2026). Nunca é retenção zero. `null` = nenhum uso com dado de paciente.
 */
export type RetencaoIA = 'zero' | '30-dias' | null;
/**
 * `destino` (RN-109): o do provedor configurado, mesmo na emergência (a tela de autorização compara com ele); nulo sem
 * IA_PROVEDOR. `retencao`: ver RetencaoIA.
 */
export type ConfigIA = {
  modo: ModoIA;
  destino: DestinoIA | null;
  modelo: ModeloIA;
  /** Plano 14B (A-D3): o modelo do resumo, do rascunho e dos modelos sugeridos (IA_MODELO_ASSISTENTE). */
  modeloAssistente: ModeloIA;
  geo: RegiaoIA;
  tetoGlobalMicroUsd: number;
  /** Plano 14B (RN-121, D5): o teto por tarefa de rascunho (IA_TETO_RASCUNHO_USD), em micro-dólares. */
  tetoRascunhoMicroUsd: number;
  retencao: RetencaoIA;
  /** Plano 15 (D5): o modelo da IA Nutri do paciente (IA_MODELO_PACIENTE; sem ela, Haiku 5.5 na Anthropic direta e Sonnet 5.5 no Bedrock). */
  modeloPaciente: ModeloIA;
  /** Plano 15 (RN-185): IA_NUTRI_DESLIGADA=1 — a segunda barreira (exige redeploy); a primeira é a pausa no banco. */
  nutriDesligada: boolean;
};
export type AmbienteIA = {
  IA_PROVEDOR?: ProvedorConfigurado;
  IA_DESLIGADA?: '0' | '1';
  IA_RETENCAO_ZERO?: '0' | '1';
  IA_RETENCAO_ACEITA_30_DIAS?: '0' | '1';
  IA_MODELO_LEITURA: ModeloIA;
  IA_MODELO_ASSISTENTE: ModeloIA;
  IA_INFERENCE_GEO: GeoIA;
  IA_TETO_GLOBAL_MENSAL_USD: number;
  IA_TETO_RASCUNHO_USD: number;
  /** Plano 15 (§14): opcional, sem padrão no esquema — o padrão depende do provedor (configIA). */
  IA_MODELO_PACIENTE?: ModeloIA;
  IA_NUTRI_DESLIGADA?: '0' | '1';
};

export function configIA(e: AmbienteIA): ConfigIA {
  const modo: ModoIA = !e.IA_PROVEDOR ? 'ausente' : e.IA_DESLIGADA === '1' ? 'emergencia' : e.IA_PROVEDOR;
  return {
    modo,
    destino: e.IA_PROVEDOR ? DESTINO_DO_PROVEDOR[e.IA_PROVEDOR] : null,
    modelo: e.IA_MODELO_LEITURA,
    modeloAssistente: e.IA_MODELO_ASSISTENTE,
    // D5: a região efetiva — `eu` no Bedrock (vem do perfil); IA_INFERENCE_GEO só vale para a API direta (§12)
    geo: e.IA_PROVEDOR === 'bedrock-eu' ? 'eu' : e.IA_INFERENCE_GEO,
    tetoGlobalMicroUsd: usdParaMicro(e.IA_TETO_GLOBAL_MENSAL_USD),
    tetoRascunhoMicroUsd: usdParaMicro(e.IA_TETO_RASCUNHO_USD),
    retencao: retencaoDoAmbiente(e),
    // D5: o Haiku 5.5 não está no perfil eu. do Bedrock (MODELOS_BEDROCK_EU) — lá o padrão é o Sonnet 5.5
    modeloPaciente: e.IA_MODELO_PACIENTE ?? (e.IA_PROVEDOR === 'bedrock-eu' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'),
    nutriDesligada: e.IA_NUTRI_DESLIGADA === '1',
  };
}

/** A-D4 e A-D27: a retenção zero vale para qualquer destino; a de 30 dias, só para a Anthropic direta (`anthropic-us`). */
function retencaoDoAmbiente(e: AmbienteIA): RetencaoIA {
  if (!e.IA_PROVEDOR) return null;
  if (e.IA_RETENCAO_ZERO === '1') return 'zero';
  if (DESTINO_DO_PROVEDOR[e.IA_PROVEDOR] === 'anthropic-us' && e.IA_RETENCAO_ACEITA_30_DIAS === '1') return '30-dias';
  return null;
}

export type EstadoIaTenant = 'ausente' | 'emergencia' | 'suspensa' | 'nao_liberada' | 'nao_ativada' | 'aditivo_desatualizado' | 'sem_retencao' | 'ativa';

/** RN-100 (parte do consultório), na ordem em que a tela explica: plataforma → conta → admin → nutricionista → aditivo. */
export function estadoIaDoTenant(t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao'>, modo: ModoIA): EstadoIaTenant {
  if (modo === 'ausente') return 'ausente';
  if (modo === 'emergencia') return 'emergencia';
  if (t.status !== 'ativa') return 'suspensa';
  if (!t.iaLiberada) return 'nao_liberada';
  if (!t.iaAtivadaEm) return 'nao_ativada';
  if (!versaoAtende(t.iaAditivoVersao, IA_ADITIVO_VERSAO_MIN)) return 'aditivo_desatualizado';
  return 'ativa';
}

/**
 * Plano 14A (RN-100, A-D4, D9) e A-D27: o estado para usar a IA COM dado de paciente — o do consultório e, por cima, a
 * retenção aceita da plataforma (zero, ou a de 30 dias na Anthropic direta). Configurações, pedidos de autorização e
 * retiradas usam `estadoIaDoTenant` (não dependem dela).
 */
export function estadoIaComPaciente(t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao'>, ia: Pick<ConfigIA, 'modo' | 'retencao'>): EstadoIaTenant {
  const e = estadoIaDoTenant(t, ia.modo);
  return e === 'ativa' && !ia.retencao ? 'sem_retencao' : e;
}
