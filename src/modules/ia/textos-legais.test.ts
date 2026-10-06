import { describe, expect, it } from 'vitest';
import { AVISO_IA_VERSAO, AVISO_IA_VERSAO_MIN, avisoDaVersao, IA_ADITIVO_TERMO, IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN, versaoAtende } from './textos-legais';

describe('textos legais da IA (A-D19, A-D20; provisórios até o E-09)', () => {
  it('versaoAtende compara a parte numérica; nulo nunca atende', () => {
    expect(versaoAtende('0.1-provisorio', '0.1-provisorio')).toBe(true);
    expect(versaoAtende('1.0', '0.1-provisorio')).toBe(true);
    expect(versaoAtende('0.1-provisorio', '1.0')).toBe(false);
    expect(versaoAtende('1.10', '1.9')).toBe(true);
    expect(versaoAtende(null, '0.1')).toBe(false);
    expect(versaoAtende('lixo', '0.1')).toBe(false);
  });

  it('a versão atual atende à mínima; o termo do aditivo tem o prefixo ia-aditivo-', () => {
    expect(versaoAtende(AVISO_IA_VERSAO, AVISO_IA_VERSAO_MIN)).toBe(true);
    expect(versaoAtende(IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN)).toBe(true);
    expect(IA_ADITIVO_TERMO).toBe(`ia-aditivo-${IA_ADITIVO_VERSAO}`);
  });

  it('o aviso declara provedor, país, finalidade, retenção e como pedir "Não usar IA" (spec §5.3)', () => {
    const texto = avisoDaVersao(AVISO_IA_VERSAO).paragrafos.join(' ');
    for (const parte of ['Anthropic', 'Estados Unidos', 'laudos', 'não usar inteligência artificial', 'nutricionista']) expect(texto).toContain(parte);
    expect(avisoDaVersao('versao-que-nao-existe').titulo).toBe(avisoDaVersao(AVISO_IA_VERSAO).titulo);
  });
});
