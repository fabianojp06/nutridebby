import { describe, expect, it, vi } from 'vitest';
import { paginasDoPdf, rodapesDoPdf, textoDoPdf, textosPorPagina } from '../../../test/pdf';
import type { DadosExportacao } from './exportacao-job';
import { renderizarProntuario } from './prontuario-pdf';

const agora = '2026-10-01T15:00:00.000Z';

function dados(atendimentos: number, exames: number): DadosExportacao {
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
      cadastro: null,
    },
    anamneses: [],
    antropometria: [],
    gastoEnergetico: [],
    exames: Array.from({ length: exames }, (_, i) => ({
      data: '2026-09-01',
      titulo: `Painel ${i + 1}`,
      temLaudo: false,
      laudo: null,
      valores: Array.from({ length: 8 }, (_, j) => ({ nome: `Marcador ${j + 1}`, valor: j, unidade: 'mg/dL', referencia: null })),
      versoesAnteriores: [], // Plano 22: não vão ao PDF
      notaDeInterpretacao: null,
      mostradoNoAppEm: null, // Plano 22 (PR 3): não vai ao PDF
    })),
    atendimentos: Array.from({ length: atendimentos }, (_, i) => ({
      data: '2026-09-01',
      orientacoes: `Orientação do atendimento ${i + 1}: beber água e manter o plano.`,
    })),
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
    financeiro: [],
    laudosForaDoZip: false,
  };
}

const RODAPE = 'Dados exportados do NutriDebby (LGPD, art. 18)';

/** SUS-99: em toda página, o rodapé e o número "k/n" dentro da margem de baixo do A4 e na mesma linha. */
function confereRodapes(pdf: Buffer) {
  const rodapes = rodapesDoPdf(pdf, RODAPE);
  expect(rodapes.length).toBe(paginasDoPdf(pdf));
  rodapes.forEach(({ rotulo, numero }, i) => {
    expect(rotulo, `rodapé da página ${i + 1}`).toBeDefined();
    expect(numero, `número da página ${i + 1}`).toBeDefined();
    expect(rotulo!.y, `rodapé da página ${i + 1}`).toBeGreaterThan(0);
    expect(rotulo!.y, `rodapé da página ${i + 1}`).toBeLessThan(36);
    expect(Math.abs(numero!.y - rotulo!.y), `número da página ${i + 1} na linha do rodapé`).toBeLessThan(1);
    expect(numero!.x).toBeGreaterThan(rotulo!.x);
  });
}

describe('PDF do prontuário (exportação do titular, US-018)', () => {
  it('SUS-99: prontuário longo (mais de 10 páginas) gera com o rodapé e o número da página dentro de cada página (o rodapé por `bottom` quebrava o @react-pdf 4.9)', async () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pdf = await renderizarProntuario(dados(320, 40), 'Debby Silva');
      const n = paginasDoPdf(pdf);
      expect(n).toBeGreaterThanOrEqual(10);
      const texto = textoDoPdf(pdf);
      expect(texto).toContain(RODAPE);
      expect(texto).toContain(`${n}/${n}`);
      expect(texto).toContain('Orientação do atendimento 320');
      confereRodapes(pdf);
      expect(avisos).not.toHaveBeenCalled();
    } finally {
      avisos.mockRestore();
    }
  });

  it('SUS-99: prontuário curto (1 a poucas páginas): o rodapé e o número ficam dentro da página, não abaixo dela', async () => {
    for (const atendimentos of [3, 80]) {
      const pdf = await renderizarProntuario(dados(atendimentos, 0), 'Debby Silva');
      // curtos, abaixo das ~10 páginas em que o padrão antigo quebrava; a contagem exata muda com as seções do prontuário
      const n = paginasDoPdf(pdf);
      if (atendimentos === 3) expect(n).toBe(1);
      else expect(n).toSatisfy((p: number) => p >= 2 && p < 10);
      confereRodapes(pdf);
    }
  });

  it('o corpo não encosta no rodapé: entre a última linha do corpo e a do rodapé, pelo menos uma linha (14 pt) e 10 pt de folga', async () => {
    const pdf = await renderizarProntuario(dados(320, 40), 'Debby Silva');
    for (const textos of textosPorPagina(pdf)) {
      const rodape = textos.find((t) => t.texto === RODAPE)!;
      const corpo = textos.filter((t) => t !== rodape && !/^\d+\/\d+$/.test(t.texto));
      expect(Math.min(...corpo.map((t) => t.y)) - rodape.y).toBeGreaterThanOrEqual(24); // sem o paddingBottom 48: ~18
    }
  });
});
