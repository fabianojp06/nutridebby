import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemAtual, secaoDe, SECOES_DO_PORTAL, secoesDoPortal } from './navegacao';

const ID = '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';

/** Toda página de /p/(portal) como rota ([id] vira um uuid; o grupo (portal) some da URL). */
function rotasDoPortal(): string[] {
  const raiz = join(process.cwd(), 'src/app/p/(portal)');
  return (readdirSync(raiz, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => f === 'page.tsx' || f.endsWith(`${sep}page.tsx`))
    .map((f) => `/p/${f.split(sep).slice(0, -1).join('/')}`.replace(/\[[^\]]+\]/g, ID).replace(/\/$/, ''))
    .sort();
}

describe('seções do portal (Plano 16, RN-190, §4.1)', () => {
  it('cinco seções, nessa ordem, todas dentro do escopo /p/ do PWA; a única rota de seção nova é /p/jornada', () => {
    expect(SECOES_DO_PORTAL.map((s) => [s.rotulo, s.href])).toEqual([
      ['Hoje', '/p/inicio'],
      ['Jornada', '/p/jornada'],
      ['Plano', '/p/plano'],
      ['Exames', '/p/exames'],
      ['Eu', '/p/perfil'],
    ]);
  });

  it('a tabela da §4.1: o que cada rota marca (as URLs antigas continuam, C-195)', () => {
    const casos: [string, string][] = [
      ['/p/inicio', '/p/inicio'],
      ['/p/diario', '/p/inicio'],
      ['/p/jornada', '/p/jornada'],
      ['/p/evolucao', '/p/jornada'],
      ['/p/agenda', '/p/jornada'],
      ['/p/agenda/nova', '/p/jornada'],
      [`/p/agenda/${ID}`, '/p/jornada'],
      ['/p/plano', '/p/plano'],
      [`/p/plano/refeicao/${ID}`, '/p/plano'],
      ['/p/compras', '/p/plano'],
      ['/p/conteudos', '/p/plano'], // G-D8 ★ = a
      [`/p/conteudos/${ID}`, '/p/plano'],
      ['/p/exames', '/p/exames'],
      ['/p/perfil', '/p/perfil'],
      ['/p/documentos', '/p/perfil'],
      [`/p/meus-dados/exportacoes/${ID}`, '/p/perfil'],
      ['/p/ajuda', '/p/perfil'],
    ];
    for (const [rota, secao] of casos) expect(itemAtual(rota), rota).toBe(secao);
    expect(itemAtual('/p/iniciozinho')).toBeNull();
    expect(itemAtual('/p/escolher')).toBeNull(); // fora do layout do portal
    expect(secaoDe('/p/compras')?.rotulo).toBe('Plano');
  });

  it('RN-191: toda página de /p/(portal) marca exatamente uma seção (uma rota nova sem `tambem` quebra aqui)', () => {
    const rotas = rotasDoPortal();
    expect(rotas.length).toBeGreaterThan(10);
    for (const rota of rotas) {
      const marcam = SECOES_DO_PORTAL.filter((s) => [s.href, ...s.tambem].some((h) => rota === h || rota.startsWith(`${h}/`)));
      expect(marcam.map((s) => s.rotulo), rota).toHaveLength(1);
    }
  });

  it('RN-192 (G-D9 ★ = a): sem o recebimento de exames e sem envio, quatro seções — "Exames" some', () => {
    expect(secoesDoPortal({ exames: true }).map((s) => s.rotulo)).toEqual(['Hoje', 'Jornada', 'Plano', 'Exames', 'Eu']);
    expect(secoesDoPortal({ exames: false }).map((s) => s.rotulo)).toEqual(['Hoje', 'Jornada', 'Plano', 'Eu']);
  });
});
