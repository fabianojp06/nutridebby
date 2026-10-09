import type { TenantRow } from '@/db/schema';
import { DESTINO_DO_PROVEDOR, MODELOS_IA, usdParaMicro, type DestinoIA, type GeoIA, type ModeloIA, type ProvedorConfigurado } from './constantes';
import { IA_ADITIVO_VERSAO_MIN, versaoAtende } from './textos-legais';

export { MODELOS_IA };

/** `ausente` = sem IA_PROVEDOR (nada aparece); `emergencia` = IA_DESLIGADA=1 (aparece "indisponível"). */
export type ModoIA = 'ausente' | 'emergencia' | ProvedorConfigurado;
/**
 * `destino` (RN-109): o do provedor configurado, mesmo na emergência (a tela de autorização compara com ele); nulo sem
 * IA_PROVEDOR. `retencaoZero` (A-D4, Plano 14A): sem ela, nenhum uso com dado de paciente (RN-100).
 */
export type ConfigIA = { modo: ModoIA; destino: DestinoIA | null; modelo: ModeloIA; geo: GeoIA; tetoGlobalMicroUsd: number; retencaoZero: boolean };
export type AmbienteIA = {
  IA_PROVEDOR?: ProvedorConfigurado;
  IA_DESLIGADA?: '0' | '1';
  IA_RETENCAO_ZERO?: '0' | '1';
  IA_MODELO_LEITURA: ModeloIA;
  IA_INFERENCE_GEO: GeoIA;
  IA_TETO_GLOBAL_MENSAL_USD: number;
};

export function configIA(e: AmbienteIA): ConfigIA {
  const modo: ModoIA = !e.IA_PROVEDOR ? 'ausente' : e.IA_DESLIGADA === '1' ? 'emergencia' : e.IA_PROVEDOR;
  return {
    modo,
    destino: e.IA_PROVEDOR ? DESTINO_DO_PROVEDOR[e.IA_PROVEDOR] : null,
    modelo: e.IA_MODELO_LEITURA,
    geo: e.IA_INFERENCE_GEO,
    tetoGlobalMicroUsd: usdParaMicro(e.IA_TETO_GLOBAL_MENSAL_USD),
    retencaoZero: e.IA_RETENCAO_ZERO === '1',
  };
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
 * Plano 14A (RN-100, A-D4, D9): o estado para usar a IA COM dado de paciente — o do consultório e, por cima, a retenção
 * zero da plataforma. Configurações, pedidos de autorização e retiradas usam `estadoIaDoTenant` (não dependem dela).
 */
export function estadoIaComPaciente(t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao'>, ia: Pick<ConfigIA, 'modo' | 'retencaoZero'>): EstadoIaTenant {
  const e = estadoIaDoTenant(t, ia.modo);
  return e === 'ativa' && !ia.retencaoZero ? 'sem_retencao' : e;
}
