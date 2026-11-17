import type { SecaoDaFicha } from '../tipos';
import { secaoAnamneses } from './anamneses';
import { secaoAntropometria } from './antropometria';
import { secaoAtendimentos } from './atendimentos';
import { secaoDocumentos } from './documentos';
import { secaoExames } from './exames';
import { secaoExamesEnviados } from './exames-enviados';
import { secaoFinanceiro } from './financeiro';
import { secaoGastoEnergetico } from './gasto-energetico';
import { secaoPlanoAlimentar } from './plano-alimentar';

/**
 * RN-277/RN-278: as seções do Início, na ordem da tela. Um plano novo pendura a sua com um arquivo em `secoes/` e UMA linha
 * no fim desta lista, sem reordenar as outras (spec §11).
 */
export const SECOES_DA_FICHA: readonly SecaoDaFicha[] = [
  secaoPlanoAlimentar,
  secaoAntropometria,
  secaoGastoEnergetico,
  secaoAnamneses,
  secaoAtendimentos,
  secaoExames,
  secaoExamesEnviados,
  secaoDocumentos,
  secaoFinanceiro, // Plano 20 (US-308)
];
