import type { ChaveDeAcao } from '@/modules/ficha/tipos';
import { criarParecerAction, criarReceitaAction } from '../documentos/actions';

/** RN-280: cada `ChaveDeAcao` do registro é a mesma Server Action do botão da aba Documentos ("Nova receita", "Novo parecer nutricional"). */
const ACOES: Record<ChaveDeAcao, (patientId: string) => Promise<void>> = {
  'criar-receita': criarReceitaAction,
  'criar-parecer': criarParecerAction,
};

/** As ações que o diálogo Adicionar usa, já ligadas ao paciente (`bind`, como em documentos/page.tsx). */
export function acoesDoAdicionar(patientId: string, chaves: readonly ChaveDeAcao[]): Partial<Record<ChaveDeAcao, () => Promise<void>>> {
  return Object.fromEntries(chaves.map((c) => [c, ACOES[c].bind(null, patientId)]));
}
