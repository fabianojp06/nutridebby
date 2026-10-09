import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS } from './conteudo';
import { AVISO_PORTAL, GUIA_PORTAL } from './portal';

const FONTES = ['src/app/p', 'src/components/portal']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('manual guiado do portal (Plano 16, RN-212, US-199)', () => {
  it('id no formato do progresso e fora dos guias do painel; versão 1; 5 passos com "1 de 5"', () => {
    expect(GUIA_PORTAL.id).toBe('portal-novidades');
    expect(GUIA_PORTAL.id).toMatch(ID_GUIA);
    expect(GUIAS.map((g) => g.id)).not.toContain(GUIA_PORTAL.id);
    expect(GUIA_PORTAL.versao).toBe(1);
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
});
