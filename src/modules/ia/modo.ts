import type { TenantRow } from '@/db/schema';
import { MODELOS_IA, usdParaMicro, type GeoIA, type ModeloIA } from './constantes';
import { IA_ADITIVO_VERSAO_MIN, versaoAtende } from './textos-legais';

export { MODELOS_IA };

/** `ausente` = sem IA_PROVEDOR (nada aparece); `emergencia` = IA_DESLIGADA=1 (aparece "indisponível"). */
export type ModoIA = 'ausente' | 'emergencia' | 'anthropic' | 'sandbox' | 'fake';
export type ConfigIA = { modo: ModoIA; modelo: ModeloIA; geo: GeoIA; tetoGlobalMicroUsd: number };
export type AmbienteIA = {
  IA_PROVEDOR?: 'anthropic' | 'sandbox' | 'fake';
  IA_DESLIGADA?: '0' | '1';
  IA_MODELO_LEITURA: ModeloIA;
  IA_INFERENCE_GEO: GeoIA;
  IA_TETO_GLOBAL_MENSAL_USD: number;
};

export function configIA(e: AmbienteIA): ConfigIA {
  const modo: ModoIA = !e.IA_PROVEDOR ? 'ausente' : e.IA_DESLIGADA === '1' ? 'emergencia' : e.IA_PROVEDOR;
  return { modo, modelo: e.IA_MODELO_LEITURA, geo: e.IA_INFERENCE_GEO, tetoGlobalMicroUsd: usdParaMicro(e.IA_TETO_GLOBAL_MENSAL_USD) };
}

export type EstadoIaTenant = 'ausente' | 'emergencia' | 'suspensa' | 'nao_liberada' | 'nao_ativada' | 'aditivo_desatualizado' | 'ativa';

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
