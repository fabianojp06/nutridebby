import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { resumoFinanceiroDoPaciente } from '@/modules/financeiro/resumo';
import type { SecaoDaFicha } from '../tipos';

/**
 * Plano 20 (US-308, RN-329): os lançamentos do paciente — "Entrada — {categoria}", a data de referência e a situação, sem
 * valor nem descrição —, lidos pelo módulo do Financeiro numa consulta. Sempre disponível: sem configuração, "Financeiro (0)"
 * e o "Nova entrada" leva às Configurações (RN-301). "Ver todos" e "Nova entrada" fora da ficha, com o paciente. O "ler"
 * da RN-318 é o de `inicio.ts` (`leitura`), uma vez por abertura e só com lançamento; nada no "No app" (RN-300).
 */
export const secaoFinanceiro: SecaoDaFicha = {
  id: 'financeiro',
  titulo: MSG_FINANCEIRO.menu,
  aba: '',
  verTodos: (patientId) => `/painel/financeiro/lancamentos?paciente=${patientId}`,
  disponivel: () => true,
  resumo: (tx, patientId, fuso) => resumoFinanceiroDoPaciente(tx, patientId, fuso),
  leitura: { entidade: 'financeiro' },
  adicionar: [
    { grupo: 'outros', rotulo: MSG_FINANCEIRO.novaEntrada, destino: { hrefDoPaciente: (patientId) => `/painel/financeiro/lancamentos/novo?tipo=entrada&paciente=${patientId}` } },
  ],
};
