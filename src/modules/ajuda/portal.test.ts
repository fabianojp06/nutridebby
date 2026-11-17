import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS } from './conteudo';
import { MSG_MURAL } from '@/modules/portal/mural-regras';
import { AVISO_PORTAL, avisoDoGuia, GUIA_PORTAL } from './portal';

const FONTES = ['src/app/p', 'src/components/portal']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('manual guiado do portal (Plano 16, RN-212, US-199)', () => {
  it('id no formato do progresso e fora dos guias do painel; versão 3 (Plano 17: os lembretes em "Perguntas comuns"); 5 passos com "1 de 5"', () => {
    expect(GUIA_PORTAL.id).toBe('portal-novidades');
    expect(GUIA_PORTAL.id).toMatch(ID_GUIA);
    expect(GUIAS.map((g) => g.id)).not.toContain(GUIA_PORTAL.id);
    expect(GUIA_PORTAL.versao).toBe(3);
    expect(GUIA_PORTAL.passos).toHaveLength(5);
  });
  it('todo alvo do tour existe numa tela do portal (data-guia); a faixa, o mural, as respostas, as ações e a seção Eu', () => {
    expect(GUIA_PORTAL.passos.map((p) => p.alvo)).toEqual(['faixa', 'mural', 'respostas', 'acoes', 'secao-eu']);
    for (const p of GUIA_PORTAL.passos) expect(FONTES, p.alvo).toMatch(new RegExp(`['"]${p.alvo}['"]`));
  });
  it('textos do aviso (US-199; G-D17 = a: boas-vindas para quem entra pela primeira vez) e nenhum texto do tour fala pela nutricionista', () => {
    expect(AVISO_PORTAL).toMatchObject({
      pergunta: 'O app mudou. Quer ver onde ficou cada coisa?',
      boasVindas: 'Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?',
      ver: 'Ver como funciona',
      agoraNao: 'Agora não',
    });
    for (const p of GUIA_PORTAL.passos) expect(p.texto).not.toMatch(/^Sua nutricionista/);
  });
  it('RN-203/RN-214: nem a ajuda nem o tour falam de peso ou IMC (o mesmo texto vai a quem tem o peso oculto)', () => {
    expect(JSON.stringify({ ajuda: GUIA_PORTAL.ajuda, passos: GUIA_PORTAL.passos, aviso: AVISO_PORTAL })).not.toMatch(/peso|IMC/i);
  });
  it('Plano 15 (D34, §7.8): a frase do mural igual ao rodapé, os dois pedidos separados de IA e a IA Nutri em Plano; nada de "canal de conversa" nem de peso', () => {
    const itens = GUIA_PORTAL.ajuda.secoes.find((s) => s.titulo === 'Perguntas comuns')?.itens ?? [];
    expect(itens).toContain(MSG_MURAL.rodape);
    expect(itens).toContain(
      'Se o seu consultório usar IA, você pode receber dois pedidos separados: um para os exames (em Eu › Privacidade) e outro para a IA Nutri (em Plano). Cada um é opcional. Recusar ou retirar não muda nada no seu atendimento.',
    );
    const onde = GUIA_PORTAL.ajuda.secoes.find((s) => s.titulo === 'Onde fica cada coisa')?.itens ?? [];
    expect(onde).toContain('Plano: as refeições do dia, o PDF, a lista de compras, os conteúdos e, quando liberada, a IA Nutri.');
    const tudo = JSON.stringify(GUIA_PORTAL);
    expect(tudo).not.toContain('canal de conversa');
    expect(tudo).not.toContain('o pedido de autorização aparece em Eu');
    expect(itens.join('\n')).not.toMatch(/peso|IMC/i);
  });

  it('§7.8: o aviso de novidade — quem já viu uma versão anterior recebe "atualizado", nunca "O app mudou" de novo', () => {
    expect(AVISO_PORTAL.atualizado).toBe('O manual do app foi atualizado. Quer ver o que há de novo?');
    for (const estado of ['visto', 'dispensado', 'concluido'] as const) {
      expect(avisoDoGuia({ [GUIA_PORTAL.id]: { v: 1, estado } }, true), estado).toBe(AVISO_PORTAL.atualizado);
      expect(avisoDoGuia({ [GUIA_PORTAL.id]: { v: 1, estado } }, false), estado).toBe(AVISO_PORTAL.atualizado);
    }
    expect(avisoDoGuia({}, true)).toBe(AVISO_PORTAL.pergunta); // já usava o app e nunca viu o guia (Plano 16, G-D17)
    expect(avisoDoGuia({}, false)).toBe(AVISO_PORTAL.boasVindas);
    expect(avisoDoGuia({ [GUIA_PORTAL.id]: { v: 2, estado: 'visto' } }, true)).toBe(AVISO_PORTAL.atualizado); // Plano 17: a versão 2 já é anterior
    expect(avisoDoGuia({ [GUIA_PORTAL.id]: { v: 3, estado: 'visto' } }, true)).not.toBe(AVISO_PORTAL.atualizado);
    expect(avisoDoGuia({ outro: { v: 1, estado: 'visto' } }, false)).toBe(AVISO_PORTAL.boasVindas); // o progresso de outro guia não conta
  });

  it('Plano 17 (Tarefa 6): os lembretes em "Perguntas comuns", com a ressalva de que dependem da nutricionista; o tour não muda', () => {
    const itens = GUIA_PORTAL.ajuda.secoes.find((s) => s.titulo === 'Perguntas comuns')?.itens ?? [];
    expect(itens).toContain('Se a sua nutricionista configurou lembretes, eles ficam em Eu › Lembretes, e você pode desligar qualquer um.');
    expect(GUIA_PORTAL.passos.map((p) => p.alvo)).toEqual(['faixa', 'mural', 'respostas', 'acoes', 'secao-eu']);
  });
});
