import { describe, expect, it } from 'vitest';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { novoCatalogo } from './ferramentas-alimentos';
import { limparTexto, validarPlanoIa } from './plano-ia';

const alimento = (n: number, extra: Partial<AlimentoEncontrado> = {}): AlimentoEncontrado => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, nome: `Alimento ${n}`, nomeOriginal: null, grupo: 'G', fonte: 'taco', origem: 'TACO', micros: {},
  porCem: { kcal: 100, proteinaG: 1, carboidratoG: 1, lipidioG: 1, fibraG: 1 }, medidas: [{ id: null, origem: 'IBGE', nome: 'unidade', plural: 'unidades', gramas: 50 }], ...extra,
});
function catalogo(...as: AlimentoEncontrado[]) {
  const c = novoCatalogo();
  as.forEach((a, i) => { c.porLocal.set(`A${i + 1}`, a); c.localDe.set(a.id, `A${i + 1}`); });
  return c;
}
const item = (alimento: string, gramas: number, extra: object = {}) => ({ alimento, gramas, medida: null, substitui: null, ...extra });

describe('validarPlanoIa (RN-121, RN-124, D14): nada do modelo passa sem revalidar', () => {
  it('ids locais viram foodId; descarta alimento inexistente e gramas fora de 0,1–5000, contando', () => {
    const p = validarPlanoIa({ titulo: 'T', meta_kcal: 1800, orientacoes: '', refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: [item('A1', 150), item('A99', 100), item('A1', 6000), item('A1', 0.05)] }] }, catalogo(alimento(3)))!;
    expect(p.refeicoes[0].itens).toEqual([{ foodId: alimento(3).id, quantidadeG: 150, medida: null, substitui: null }]);
    expect(p.descartados).toBe(3);
  });

  it('medida caseira: gramas pelo sistema (quantidade × gramas da medida), ignorando os do modelo', () => {
    const p = validarPlanoIa({ titulo: 'T', meta_kcal: null, orientacoes: '', refeicoes: [{ nome: 'Lanche', horario: '16:00', itens: [item('A1', 999, { medida: { indice: 1, quantidade: 2 } }), item('A1', 10, { medida: { indice: 7, quantidade: 1 } })] }] }, catalogo(alimento(1)))!;
    expect(p.refeicoes[0].itens[0]).toMatchObject({ quantidadeG: 100, medida: { nome: 'unidade', plural: 'unidades', gramas: 50, qtd: 2 } });
    expect(p.descartados).toBe(1); // medida 7 não existe
  });

  it('substituição só de um principal válido da mesma refeição; refeição sem principal válido sai inteira', () => {
    const p = validarPlanoIa({
      titulo: 'T', meta_kcal: null, orientacoes: '',
      refeicoes: [
        { nome: 'Café', horario: '07:00', itens: [item('A1', 50), item('A2', 40, { substitui: 1 }), item('A2', 40, { substitui: 5 })] },
        { nome: 'Ceia', horario: '22:00', itens: [item('A99', 50)] },
      ],
    }, catalogo(alimento(1), alimento(2)))!;
    expect(p.refeicoes).toHaveLength(1);
    expect(p.refeicoes[0].itens.map((i) => i.substitui)).toEqual([null, 0]);
    expect(p.descartados).toBe(2); // a substituição órfã e o item da ceia
  });

  it('limites: horário HH:MM, nome ≤ 60, título ≤ 120, orientações ≤ 2000; os do rascunho da IA, 15 refeições e 200 itens (RN-249, o editor vai a 50/400); meta 500–10000', () => {
    expect(validarPlanoIa({ titulo: 'x'.repeat(121), meta_kcal: null, orientacoes: '', refeicoes: [] }, catalogo())).toBeNull();
    expect(validarPlanoIa({ titulo: 'T', meta_kcal: 100, orientacoes: '', refeicoes: [] }, catalogo())).toMatchObject({ metaKcal: null });
    const muitas = Array.from({ length: 16 }, (_, i) => ({ nome: `R${i}`, horario: '08:00', itens: [item('A1', 10)] }));
    expect(validarPlanoIa({ titulo: 'T', meta_kcal: null, orientacoes: '', refeicoes: muitas }, catalogo(alimento(1)))).toBeNull();
    expect(validarPlanoIa({ titulo: 'T', meta_kcal: null, orientacoes: '', refeicoes: muitas.slice(0, 15) }, catalogo(alimento(1)))).not.toBeNull();
    const itens201 = Array.from({ length: 10 }, (_, i) => ({ nome: `R${i}`, horario: '08:00', itens: Array.from({ length: i ? 20 : 21 }, () => item('A1', 10)) }));
    expect(validarPlanoIa({ titulo: 'T', meta_kcal: null, orientacoes: '', refeicoes: itens201 }, catalogo(alimento(1)))).toBeNull();
    expect(validarPlanoIa({ titulo: 'T', meta_kcal: null, orientacoes: '', refeicoes: itens201.slice(1) }, catalogo(alimento(1)))).not.toBeNull();
    const ruim = validarPlanoIa({ titulo: 'T', meta_kcal: null, orientacoes: '', refeicoes: [{ nome: 'Jantar', horario: '25:00', itens: [item('A1', 10)] }] }, catalogo(alimento(1)))!;
    expect(ruim.refeicoes).toEqual([]);
    expect(ruim.descartados).toBe(1);
  });

  it('texto sem URL nem caractere de controle (§5.8); fora do formato → null', () => {
    const p = validarPlanoIa({ titulo: 'Plano\u0007 https://exemplo.invalid', meta_kcal: null, orientacoes: 'Veja www.exemplo.invalid', refeicoes: [] }, catalogo())!;
    expect(p.titulo).toBe('Plano');
    expect(p.orientacoes).toBe('Veja');
    expect(validarPlanoIa('não é json', catalogo())).toBeNull();
  });

  it('§5.8 como na leitura: link de qualquer esquema ou partido por invisível sai; orientações mantêm parágrafos; título numa linha', () => {
    expect(limparTexto('Leia ht\u200btps://x.invalid ou ftp://y.invalid já')).toBe('Leia ou já');
    expect(limparTexto('Linha 1\r\n\n\n\nLinha\t 2\u0007  ')).toBe('Linha 1\n\nLinha 2');
    const p = validarPlanoIa({ titulo: 'Plano\nnovo', meta_kcal: null, orientacoes: 'a\nb', refeicoes: [{ nome: 'Al\nmoço', horario: '12:00', itens: [item('A1', 10)] }] }, catalogo(alimento(1)))!;
    expect(p).toMatchObject({ titulo: 'Plano novo', orientacoes: 'a\nb', refeicoes: [{ nome: 'Al moço' }] });
  });
});
