import { describe, expect, it } from 'vitest';
import { FAIXAS_ETARIAS, MESES_MAX, MSG_RELATORIOS, RANKING_LIMITE, SECOES } from './constantes';

/** Spec §6.2: os textos exatos (amostra; a revisão confere o resto chave por chave). */
describe('MSG_RELATORIOS', () => {
  const M = MSG_RELATORIOS;

  it('seções na ordem das abas, com os rótulos e o h2 do Ranking', () => {
    expect(SECOES.map((s) => M.abas[s])).toEqual(['Pacientes', 'Atendimentos', 'Planos alimentares', 'Agenda', 'Financeiro', 'Ranking']);
    expect(M.titulosDaSecao.ranking).toBe('Ranking de pacientes');
    expect(M.menu).toBe('Relatórios');
  });

  it('filtros, erros do período e vazio', () => {
    expect([M.filtros.de, M.filtros.ate, M.filtros.local, M.filtros.todosOsLocais, M.filtros.aplicar]).toEqual(['De', 'Até', 'Local', 'Todos os locais', 'Aplicar']);
    expect([M.filtros.baixarCsv, M.filtros.verImpressao]).toEqual(['Baixar CSV', 'Ver versão para imprimir']);
    expect(M.erros).toEqual({
      ordem: 'O mês inicial não pode ser depois do final.',
      longo: 'Escolha um período de até 12 meses.',
      invalido: 'Período inválido. Mostrando os últimos 12 meses.',
    });
    expect(M.vazio).toBe('Ainda não há dados neste período.');
  });

  it('Ranking, Financeiro e impressão', () => {
    expect(M.ranking.aviso).toBe("Lista com nomes de pacientes. Ao exportar, cada paciente da lista registra 'Exportou — Relatórios' no Histórico de acessos.");
    expect(M.financeiro.naoConfigurado).toBe('O Financeiro ainda não foi configurado.');
    expect(M.financeiro.peca).toBe('Peça à nutricionista para configurar o Financeiro.');
    expect(M.impressao.tituloDaAba('Agenda', 'Consultório Debby')).toBe('Relatório de Agenda — Consultório Debby');
    expect(M.impressao.periodo('01/2026', '06/2026')).toBe('Período: 01/2026 a 06/2026');
    expect(M.impressao.geradoEm('17/11/2026', '10:32')).toBe('Gerado em 17/11/2026 às 10:32');
    expect(M.impressao.rodape).toBe('Documento interno do consultório, com dados de pacientes. Guarde com sigilo.');
  });
});

describe('limites e faixas', () => {
  it('Ranking com 20, período com 12 meses', () => {
    expect(RANKING_LIMITE).toBe(20);
    expect(MESES_MAX).toBe(12);
  });

  it('faixas etárias (RN-485): "Menos de 18" e as cinco faixas, sem buraco nem sobreposição', () => {
    expect(FAIXAS_ETARIAS.map((f) => f.rotulo)).toEqual(['Menos de 18', '18 a 29', '30 a 39', '40 a 49', '50 a 59', '60 ou mais']);
    for (let i = 1; i < FAIXAS_ETARIAS.length; i++) expect(FAIXAS_ETARIAS[i].min).toBe(FAIXAS_ETARIAS[i - 1].max! + 1);
    expect(FAIXAS_ETARIAS.at(-1)!.max).toBeNull();
  });
});
