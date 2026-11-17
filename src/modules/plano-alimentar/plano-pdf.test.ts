import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { paginasDoPdf, rodapesDoPdf, textoDoPdf, textosPorPagina } from '../../../test/pdf';
import { idTaco } from '@/modules/alimentos/taco';
import { renderizarPlano } from './plano-pdf';
import type { PlanoCompleto } from './tipos';

// "Fonte: " e o texto da TACO saem em dois trechos do PDF, na mesma linha
const RODAPE = 'Fonte:';

function plano(refeicoes: number, itensPorRefeicao: number): PlanoCompleto {
  return {
    id: randomUUID(), patientId: randomUUID(), isTemplate: false, titulo: 'Plano grande', metaKcal: null, energyCalcId: null, status: 'publicado',
    versao: 1, revisao: 1, publicadoEm: '2026-10-01T15:00:00.000Z', mostrarCalorias: true, orientacoes: '', pdfStatus: 'pendente', pdfPath: null,
    refeicoes: Array.from({ length: refeicoes }, (_, r) => ({
      id: randomUUID(), nome: `Refeição ${r + 1}`, horario: `${String(5 + (r % 18)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`, observacao: 'Observação da refeição',
      itens: Array.from({ length: itensPorRefeicao }, (_, k) => ({
        id: randomUUID(), foodId: idTaco(1 + ((r * itensPorRefeicao + k) % 597)), nome: `Alimento ${r * itensPorRefeicao + k + 1}`, origem: 'TACO' as const,
        porCem: { kcal: 100, proteinaG: 1, carboidratoG: 1, lipidioG: 1, fibraG: 1 }, medidas: [],
        quantidadeG: 100, medida: null, medidaCaseiraTxt: null, substituiItemId: null,
      })),
    })),
    origemIa: null,
    iaOrigemEm: null,
  };
}

const renderizar = (p: PlanoCompleto) =>
  renderizarPlano({ plano: p, nutricionista: { nome: 'Debby Silva', crn: null }, paciente: 'Ana Souza', data: '01/10/2026', cor: '#047857', logo: null });

/** SUS-99: em toda página, o crédito da fonte e o número "k/n" dentro da margem de baixo do A4 e na mesma linha. */
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
  for (const [i, textos] of textosPorPagina(pdf).entries()) {
    const rotulo = textos.find((t) => t.texto.startsWith(RODAPE))!;
    expect(textos.some((t) => t.texto.startsWith('TACO 4') && Math.abs(t.y - rotulo.y) < 1), `crédito da TACO na página ${i + 1}`).toBe(true);
  }
}

describe('PDF do plano: rodapé (SUS-99)', () => {
  it('plano longo (mais de 10 páginas) gera, com "Fonte: TACO" e o número da página dentro de cada página (o rodapé por `bottom` quebrava o @react-pdf 4.9)', async () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pdf = await renderizar(plano(10, 60));
      const n = paginasDoPdf(pdf);
      expect(n).toBeGreaterThanOrEqual(10);
      const texto = textoDoPdf(pdf);
      expect(texto).toContain('Alimento 600');
      expect(texto).toContain(`${n}/${n}`);
      confereRodapes(pdf);
      expect(avisos).not.toHaveBeenCalled();
    } finally {
      avisos.mockRestore();
    }
  });

  it('plano curto (1 página): o rodapé fica dentro da página, não abaixo dela', async () => {
    const pdf = await renderizar(plano(1, 3));
    expect(paginasDoPdf(pdf)).toBe(1);
    confereRodapes(pdf);
  });

  it('o corpo não encosta no rodapé: entre a última linha do corpo e a do rodapé, pelo menos uma linha (14 pt) e 10 pt de folga', async () => {
    const pdf = await renderizar(plano(10, 60));
    for (const textos of textosPorPagina(pdf)) {
      const rodape = textos.find((t) => t.texto.startsWith(RODAPE))!;
      const corpo = textos.filter((t) => Math.abs(t.y - rodape.y) >= 1); // fora da linha do rodapé
      expect(Math.min(...corpo.map((t) => t.y)) - rodape.y).toBeGreaterThanOrEqual(24);
    }
  });
});
