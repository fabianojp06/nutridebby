import { describe, expect, it } from 'vitest';
import {
  DIA_CURTO,
  DIA_EXTENSO,
  diaDaSemanaNoFuso,
  diasSemRefeicao,
  ORDEM_DIAS,
  perfisDeDia,
  refeicoesDoDia,
  rotuloDosDias,
  rotuloDosDiasPorExtenso,
  TODOS_OS_DIAS,
  valeNoDia,
  type DiaDaSemana,
} from './dias';

const SEG_SEX: DiaDaSemana[] = [1, 2, 3, 4, 5];
const FIM: DiaDaSemana[] = [0, 6];
const ref = (id: string, diasSemana: number[]) => ({ id, diasSemana });

describe('D28: dias da semana (0 = domingo), ordem seg…dom', () => {
  it('constantes', () => {
    expect(ORDEM_DIAS).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(TODOS_OS_DIAS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ORDEM_DIAS.map((d) => DIA_CURTO[d])).toEqual(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']);
    expect(ORDEM_DIAS.map((d) => DIA_EXTENSO[d])).toEqual(['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']);
  });

  it('rotuloDosDias: as mesmas saídas do rotuloDosDias do Plano 17', () => {
    expect(rotuloDosDias([0, 1, 2, 3, 4, 5, 6])).toBe('todos os dias');
    expect(rotuloDosDias([6, 5, 4, 3, 2, 1, 0])).toBe('todos os dias');
    expect(rotuloDosDias(SEG_SEX)).toBe('seg a sex');
    expect(rotuloDosDias([0, 6])).toBe('sáb e dom');
    expect(rotuloDosDias([5, 1, 3])).toBe('seg, qua e sex');
    expect(rotuloDosDias([0, 1, 2, 3, 4, 5])).toBe('seg, ter, qua, qui, sex e dom');
    expect(rotuloDosDias([1, 2, 3, 4, 5, 6])).toBe('seg, ter, qua, qui, sex e sáb');
    expect(rotuloDosDias([3])).toBe('qua');
  });

  it('rotuloDosDiasPorExtenso: títulos de perfil (PDF e portal)', () => {
    expect(rotuloDosDiasPorExtenso([6, 5, 4, 3, 2, 1, 0])).toBe('Todos os dias');
    expect(rotuloDosDiasPorExtenso(SEG_SEX)).toBe('Segunda a sexta');
    expect(rotuloDosDiasPorExtenso([0, 6])).toBe('Sábado e domingo');
    expect(rotuloDosDiasPorExtenso([5, 1, 3])).toBe('Segunda, quarta e sexta');
    expect(rotuloDosDiasPorExtenso([0])).toBe('Domingo');
    expect(rotuloDosDiasPorExtenso([0, 1, 2, 3, 4, 5])).toBe('Segunda, terça, quarta, quinta, sexta e domingo');
  });

  it('valeNoDia e refeicoesDoDia', () => {
    const almocoSemana = ref('a', SEG_SEX);
    const almocoFim = ref('b', FIM);
    const cafe = ref('c', [0, 1, 2, 3, 4, 5, 6]);
    expect(valeNoDia(almocoSemana, 1)).toBe(true);
    expect(valeNoDia(almocoSemana, 6)).toBe(false);
    expect(refeicoesDoDia([cafe, almocoSemana, almocoFim], 6).map((r) => r.id)).toEqual(['c', 'b']);
    expect(refeicoesDoDia([cafe, almocoSemana, almocoFim], 3).map((r) => r.id)).toEqual(['c', 'a']);
  });

  it('perfisDeDia: "Almoço" seg–sex e "Almoço" sáb–dom → 2 perfis, em ordem seg…dom', () => {
    const p = perfisDeDia([ref('cafe', [0, 1, 2, 3, 4, 5, 6]), ref('almoco-semana', SEG_SEX), ref('almoco-fim', FIM)]);
    expect(p).toHaveLength(2);
    expect(p[0].dias).toEqual([1, 2, 3, 4, 5]);
    expect(p[0].refeicoes.map((r) => r.id)).toEqual(['cafe', 'almoco-semana']);
    expect(p[1].dias).toEqual([6, 0]);
    expect(p[1].refeicoes.map((r) => r.id)).toEqual(['cafe', 'almoco-fim']);
    expect(rotuloDosDiasPorExtenso(p[1].dias)).toBe('Sábado e domingo');
  });

  it('perfisDeDia: todas as refeições nos 7 dias → 1 perfil (tudo como hoje)', () => {
    const p = perfisDeDia([ref('a', [0, 1, 2, 3, 4, 5, 6]), ref('b', [6, 5, 4, 3, 2, 1, 0])]);
    expect(p).toEqual([{ dias: [1, 2, 3, 4, 5, 6, 0], refeicoes: [ref('a', [0, 1, 2, 3, 4, 5, 6]), ref('b', [6, 5, 4, 3, 2, 1, 0])] }]);
  });

  it('perfisDeDia: dias sem refeição ficam fora; dias não seguidos com o mesmo conjunto formam um perfil', () => {
    const p = perfisDeDia([ref('a', [1, 3, 5]), ref('b', [2, 4])]);
    expect(p.map((x) => x.dias)).toEqual([
      [1, 3, 5],
      [2, 4],
    ]);
    expect(perfisDeDia([])).toEqual([]);
  });

  it('diasSemRefeicao: na ordem seg…dom', () => {
    expect(diasSemRefeicao([ref('a', SEG_SEX)])).toEqual([6, 0]);
    expect(diasSemRefeicao([ref('a', [0, 1, 2, 3, 4, 5, 6])])).toEqual([]);
    expect(diasSemRefeicao([])).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('Review Focus 3: virada domingo 23:59 → segunda 00:00 no fuso do consultório (America/Manaus, UTC−4)', () => {
    expect(diaDaSemanaNoFuso(new Date('2026-11-16T03:59:00Z'), 'America/Manaus')).toBe(0);
    expect(diaDaSemanaNoFuso(new Date('2026-11-16T04:00:00Z'), 'America/Manaus')).toBe(1);
    // o mesmo instante já é segunda em São Paulo (UTC−3)
    expect(diaDaSemanaNoFuso(new Date('2026-11-16T03:59:00Z'), 'America/Sao_Paulo')).toBe(1);
  });
});
