import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { depoisDoEnvio } from './depois-do-envio';

// /code-review do PR 2 (I2): o envio a partir da página das anteriores (`?antes=`) — a mensagem nova não aparecia (o refresh
// refazia a mesma `?antes=`, com a consulta desligada) e quem enviava de novo duplicava a mensagem no prontuário
describe('depoisDoEnvio (o campo da conversa, painel e portal)', () => {
  it('na página das anteriores: vai para a conversa sem `?antes=` e o foco espera a página nova', () => {
    expect(depoisDoEnvio({ naAnterior: true })).toEqual({ focarJa: false, irParaAConversa: true });
    expect(depoisDoEnvio({ naAnterior: true, limpar: true })).toEqual({ focarJa: false, irParaAConversa: true });
  });
  it('na conversa: o foco vai já; com um `?ok=` na URL (nit 4), a URL perde o retorno; senão, fica', () => {
    expect(depoisDoEnvio({ naAnterior: false })).toEqual({ focarJa: true, irParaAConversa: false });
    expect(depoisDoEnvio({ naAnterior: false, limpar: true })).toEqual({ focarJa: true, irParaAConversa: true });
  });
  it('o hook: router.replace para a conversa sem rolar ao topo; o foco guardado roda quando `naAnterior` cai', () => {
    const f = readFileSync('src/components/mensagens/depois-do-envio.ts', 'utf8');
    expect(f).toMatch(/^'use client';/);
    expect(f).toMatch(/router\.replace\(conversa, \{ scroll: false \}\)/);
    expect(f).toMatch(/if \(onde\.naAnterior \|\| !pendente\.current\) return;[\s\S]*?focar\(\);\s*\}, \[onde\.naAnterior\]\);/);
  });
  it('os dois campos dão o foco pelo hook, com a URL da conversa sem `?antes=`', () => {
    const painel = readFileSync('src/app/painel/mensagens/[patientId]/campo.tsx', 'utf8');
    expect(painel).toMatch(/useDepoisDoEnvio\(`\/painel\/mensagens\/\$\{patientId\}`, \{ naAnterior, limpar: limparRetorno \}\)/);
    const portal = readFileSync('src/app/p/(portal)/mensagens/conversa-portal.tsx', 'utf8');
    expect(portal).toMatch(/useDepoisDoEnvio\('\/p\/mensagens', \{ naAnterior \}\)/);
    for (const [f, fonte] of [
      ['painel', painel],
      ['portal', portal],
    ]) {
      expect(fonte, f).toMatch(/aplicarResposta\(ref\.current, estado\)\) return;[\s\S]*?depois\(\(\) => \{/);
      expect(fonte, f).toMatch(/<Texto [^>]*depois=\{depois\}/);
    }
  });
});
