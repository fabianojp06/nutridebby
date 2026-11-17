import { describe, expect, it } from 'vitest';
import { normalizarNome, SINONIMOS } from '@/modules/ia/correspondencia';
import { CATALOGO_MAX, CATEGORIAS_DO_CONSULTORIO, COMPARAR_MAX, COMPARAR_MIN, COMPONENTES_MAX, COMPONENTES_MIN, FAIXAS_MAX, MODELO_NOTA_MAX, MSG_EXAMES, NOMES_PARA_COMECAR, NOTA_MAX, PAINEIS_PARA_COMECAR, SINONIMOS_MAX } from './constantes';

describe('constantes do Plano 22 (RN-372, RN-381, §6.2)', () => {
  it('limites da spec', () => {
    expect({ CATALOGO_MAX, SINONIMOS_MAX, COMPONENTES_MIN, COMPONENTES_MAX, FAIXAS_MAX, NOTA_MAX, MODELO_NOTA_MAX, COMPARAR_MIN, COMPARAR_MAX }).toEqual({
      CATALOGO_MAX: 500,
      SINONIMOS_MAX: 10,
      COMPONENTES_MIN: 2,
      COMPONENTES_MAX: 30,
      FAIXAS_MAX: 20,
      NOTA_MAX: 2000,
      MODELO_NOTA_MAX: 1000,
      COMPARAR_MIN: 2,
      COMPARAR_MAX: 6,
    });
  });

  it('NOMES_PARA_COMECAR: só nome e outros nomes — nenhuma chave de unidade, faixa ou ordem', () => {
    for (const n of NOMES_PARA_COMECAR) expect(Object.keys(n).sort()).toEqual(['nome', 'sinonimos']);
    for (const p of PAINEIS_PARA_COMECAR) expect(Object.keys(p).sort()).toEqual(['componentes', 'nome']);
    const texto = JSON.stringify([NOMES_PARA_COMECAR, PAINEIS_PARA_COMECAR]);
    expect(texto).not.toMatch(/unidade|faixa|ordem|refMin|refMax|referencia/i);
  });

  it('sem testes sem respaldo científico: nada de "mineralograma" nem "IgG" (RN-372; Res. CFN 306/2003, art. 2º, parágrafo único, V)', () => {
    const texto = JSON.stringify([NOMES_PARA_COMECAR, PAINEIS_PARA_COMECAR]).toLowerCase();
    expect(texto).not.toContain('mineralograma');
    expect(texto).not.toContain('igg');
  });

  it('todo grupo de SINONIMOS (correspondencia.ts) está lá, com todos os nomes do grupo', () => {
    for (const grupo of SINONIMOS) {
      const achado = NOMES_PARA_COMECAR.find((n) => grupo.includes(normalizarNome(n.nome)));
      expect(achado, grupo[0]).toBeDefined();
      const nomes = new Set([achado!.nome, ...achado!.sinonimos].map(normalizarNome));
      for (const s of grupo) expect(nomes.has(s), `${grupo[0]}: ${s}`).toBe(true);
    }
  });

  it('os componentes do hemograma estão nos nomes; o painel tem de 2 a 30; os nomes cabem no catálogo (1–80, até 10 outros nomes, sem repetição normalizada)', () => {
    const [hemograma] = PAINEIS_PARA_COMECAR;
    expect(hemograma.nome).toBe('Hemograma completo');
    expect(hemograma.componentes.length).toBeGreaterThanOrEqual(COMPONENTES_MIN);
    expect(hemograma.componentes.length).toBeLessThanOrEqual(COMPONENTES_MAX);
    const principais = new Set(NOMES_PARA_COMECAR.map((n) => normalizarNome(n.nome)));
    for (const c of hemograma.componentes) expect(principais.has(normalizarNome(c)), c).toBe(true);
    const todos = [...NOMES_PARA_COMECAR.flatMap((n) => [n.nome, ...n.sinonimos]), hemograma.nome].map(normalizarNome);
    expect(new Set(todos).size).toBe(todos.length);
    for (const n of NOMES_PARA_COMECAR) {
      expect(n.sinonimos.length).toBeLessThanOrEqual(SINONIMOS_MAX);
      for (const s of [n.nome, ...n.sinonimos]) expect(s.length >= 1 && s.length <= 80, s).toBe(true);
    }
  });

  it('CATEGORIAS_DO_CONSULTORIO igual à lista da RN-381, sem "Desnutrição"', () => {
    expect(CATEGORIAS_DO_CONSULTORIO).toEqual([
      'Baixo',
      'Normal',
      'Alto',
      'Ótimo',
      'Desejável',
      'Adequado',
      'Suficiente',
      'Aceitável',
      'Limítrofe',
      'Elevado',
      'Muito elevado',
      'Insuficiente',
      'Deficiência',
      'Depleção leve',
      'Depleção moderada',
      'Depleção grave',
    ]);
    expect(CATEGORIAS_DO_CONSULTORIO).not.toContain('Desnutrição');
  });

  it('amostra de MSG_EXAMES igual à §6.2', () => {
    expect(MSG_EXAMES.catalogo.titulo).toBe('Catálogo de exames');
    expect(MSG_EXAMES.catalogo.vazio).toBe('Seu catálogo ainda está vazio.');
    expect(MSG_EXAMES.catalogo.tituloDialogoComecar).toBe('Nomes de exames para começar (você escolhe o que usar)');
    expect(MSG_EXAMES.catalogo.painel(20)).toBe('Painel (20 exames)');
    expect(MSG_EXAMES.erros.nomeRepetido('Glicemia de jejum')).toBe('Já existe um exame com este nome ou com um destes outros nomes: Glicemia de jejum.');
    expect(MSG_EXAMES.erros.confirmarExcluir('Ferritina')).toBe('Excluir Ferritina do catálogo? Exames, modelos e documentos já gravados não mudam.');
    expect(MSG_EXAMES.lancamento.usarFaixa('70', '99')).toBe('Usar 70 a 99');
    expect(MSG_EXAMES.lancamento.usarFaixaRotulo('70', '99', 3)).toBe('Usar 70 a 99 (linha 3)');
    expect(MSG_EXAMES.lancamento.faixaDiverge).toBe('A faixa numérica não bate com o texto da referência. Confira no laudo.');
    expect(MSG_EXAMES.lancamentoErros.mudou).toBe('O exame mudou desde que você abriu. Recarregue a página.');
    expect(MSG_EXAMES.classificacao.aviso).toBe('Classificação automática pela faixa de referência informada. Não é diagnóstico.');
    expect(MSG_EXAMES.classificacao.gestacao).toBe('As faixas do consultório não consideram gestação.');
    expect(MSG_EXAMES.ref.botao).toBe('Ver referência');
    expect(MSG_EXAMES.ref.rotulo('Glicose')).toBe('Referência de Glicose');
    expect(MSG_EXAMES.nota.linhaFixa).toBe('Escreva fatores a investigar e encaminhamentos; não afirme doença.');
    expect(MSG_EXAMES.nota.max).toBe('A nota tem no máximo 2000 caracteres.');
    expect(MSG_EXAMES.exame.versao(1, '01/11/2026', 'Débora')).toBe('Versão 1 — 01/11/2026, por Débora');
    expect(MSG_EXAMES.comparativo.titulo).toBe('Comparativo de exames');
    expect(MSG_EXAMES.app.confirmar).toBe(
      'O paciente verá no app o título, a data, os valores e a referência deste exame, com o aviso de que não é diagnóstico. A nota de interpretação, as categorias do consultório e o laudo não aparecem.',
    );
    expect(MSG_EXAMES.portal.aviso).toBe('Não é diagnóstico. Converse com sua nutricionista.');
    expect(MSG_EXAMES.vazios.catalogoVazio).toBe('Seu catálogo está vazio. Cadastre exames em Catálogo de exames.');
    expect(MSG_EXAMES.modelosSolicitacao.vazio).toBe('Nenhum modelo de solicitação ainda. Crie o primeiro em Novo modelo.');
  });
});
