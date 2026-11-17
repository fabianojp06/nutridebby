import { describe, expect, it, vi } from 'vitest';
import { paginasDoPdf, textoDoPdf } from '../../../test/pdf';
import type { DadosExportacao } from './exportacao-job';
import { renderizarProntuario } from './prontuario-pdf';

const agora = '2026-10-01T15:00:00.000Z';

function dadosLongos(): DadosExportacao {
  return {
    versao: 1,
    geradoEm: agora,
    dataEmissao: '2026-10-01',
    paciente: {
      nome: 'Ana Souza',
      dataNascimento: '1991-03-10',
      sexo: 'F',
      email: 'ana@ex.com',
      telefone: null,
      status: 'ativo',
      cadastradoEm: agora,
      autorizacoesIa: [],
      pesoOcultoNoAppEm: null,
      lembretesPausadosEm: null,
    },
    anamneses: [],
    antropometria: [],
    gastoEnergetico: [],
    exames: Array.from({ length: 40 }, (_, i) => ({
      data: '2026-09-01',
      titulo: `Painel ${i + 1}`,
      temLaudo: false,
      laudo: null,
      valores: Array.from({ length: 8 }, (_, j) => ({ nome: `Marcador ${j + 1}`, valor: j, unidade: 'mg/dL', referencia: null })),
    })),
    atendimentos: Array.from({ length: 300 }, (_, i) => ({
      data: '2026-09-01',
      orientacoes: `Orientação do atendimento ${i + 1}: beber água e manter o plano.`,
    })) as DadosExportacao['atendimentos'],
    planos: [],
    pedidosLgpd: [],
    consultas: [],
    lembretes: [],
    lembretesDeRotina: [],
    aceitesDoTermo: [],
    dispositivosPush: [],
    diario: [],
    conteudos: { vistos: [], favoritos: [] },
    documentos: [],
    ia: [],
    examesEnviados: [],
    iaNutri: { consentimentos: [], mensagens: [] },
    laudosForaDoZip: false,
  };
}

describe('PDF do prontuário (exportação do titular, US-018)', () => {
  it('SUS-99: prontuário longo (mais de 10 páginas) gera com o rodapé e o número da página (o número por `bottom` quebrava o @react-pdf 4.9)', async () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pdf = await renderizarProntuario(dadosLongos(), 'Debby Silva');
      expect(paginasDoPdf(pdf)).toBeGreaterThanOrEqual(10);
      const texto = textoDoPdf(pdf);
      expect(texto).toContain('Dados exportados do NutriDebby (LGPD, art. 18)');
      expect(texto).toContain('12/');
      expect(texto).toContain('Orientação do atendimento 300');
      expect(avisos).not.toHaveBeenCalled();
    } finally {
      avisos.mockRestore();
    }
  });
});
