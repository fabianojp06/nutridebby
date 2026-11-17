import { SECOES_DA_FICHA } from '@/modules/ficha/secoes';

/**
 * Plano 18 (RN-278): as 8 seções do Início deste plano, na ordem. Os outros planos (o Financeiro do Plano 20) acrescentam
 * as suas no fim de `SECOES_DA_FICHA`; os testes que conferem só as do Plano 18 filtram por esta lista para não quebrar.
 */
export const DO_PLANO_18 = ['plano-alimentar', 'antropometria', 'gasto-energetico', 'anamneses', 'atendimentos', 'exames', 'exames-enviados', 'documentos'] as const;

const IDS_DO_PLANO_18: readonly string[] = DO_PLANO_18;
export const ehDoPlano18 = (id: string): boolean => IDS_DO_PLANO_18.includes(id);
export const SECOES_DO_PLANO_18 = SECOES_DA_FICHA.filter((s) => ehDoPlano18(s.id));
