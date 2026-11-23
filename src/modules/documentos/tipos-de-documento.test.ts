import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { caminhoAte, grafoDeImports } from '../../../test/grafo-de-imports';
import { DECLARACAO_POR_TIPO, DECLARACAO_SOLICITACAO, TIPO_DOCUMENTO_COM_ARTIGO, TIPO_DOCUMENTO_ROTULO } from './constantes';
import { exigeHabilitacao as daPrescricao } from './prescricao';
import { assertNever, conteudoVazio, exigeHabilitacao, rotuloDoTipo, semCopia, TIPOS_DE_DOCUMENTO } from './tipos-de-documento';

/** O CHECK `signed_documents_tipo_valido` do schema (o mesmo de `document_verifications_tipo_valido`, EP-D49). */
function tiposDoCheck(nome: string): string[] {
  const fonte = readFileSync('src/db/schema/documentos.ts', 'utf8');
  const m = fonte.match(new RegExp(`check\\('${nome}', sql\`\\$\\{t\\.tipo\\} in \\(([^)]*)\\)\`\\)`));
  if (!m) throw new Error(`CHECK ${nome} não encontrado`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

describe('tipos de documento (Plano 22, RN-397, DEP-E7, EP-D34)', () => {
  it('TIPOS_DE_DOCUMENTO = as chaves de TIPO_DOCUMENTO_ROTULO = os CHECKs do banco (signed_documents e document_verifications)', () => {
    expect([...TIPOS_DE_DOCUMENTO].sort()).toEqual(Object.keys(TIPO_DOCUMENTO_ROTULO).sort());
    expect([...TIPOS_DE_DOCUMENTO].sort()).toEqual(tiposDoCheck('signed_documents_tipo_valido').sort());
    expect([...TIPOS_DE_DOCUMENTO].sort()).toEqual(tiposDoCheck('document_verifications_tipo_valido').sort());
  });

  it('RN-397: rótulo, artigo e declaração da solicitação (texto exato da spec)', () => {
    expect(TIPO_DOCUMENTO_ROTULO.solicitacao_exames).toBe('Solicitação de exames laboratoriais');
    expect(TIPO_DOCUMENTO_COM_ARTIGO.solicitacao_exames).toBe('da solicitação de exames laboratoriais');
    expect(DECLARACAO_POR_TIPO.solicitacao_exames).toBe(DECLARACAO_SOLICITACAO);
    for (const t of TIPOS_DE_DOCUMENTO) {
      expect(TIPO_DOCUMENTO_COM_ARTIGO[t], t).toBeTruthy();
      expect(DECLARACAO_POR_TIPO[t], t).toBeTruthy();
    }
  });

  it('rotuloDoTipo: o rótulo de cada tipo (nunca undefined); um tipo desconhecido lança, sem cair em "Receita"', () => {
    for (const t of TIPOS_DE_DOCUMENTO) expect(rotuloDoTipo(t)).toBe(TIPO_DOCUMENTO_ROTULO[t]);
    expect(() => rotuloDoTipo('atestado' as never)).toThrow();
  });

  it('conteudoVazio de cada tipo', () => {
    // Plano 22 (T9, RN-395): a receita nova também nasce em marcação mínima
    expect(conteudoVazio('receita')).toEqual({ versao: 1, tipo: 'receita', itens: [], orientacoes: '', orientacoesFormato: 'marcacao' });
    expect(conteudoVazio('parecer')).toEqual({ versao: 1, tipo: 'parecer', exames: [], avaliacao: '', conduta: '', encaminhamentos: '' });
    expect(conteudoVazio('solicitacao_exames')).toEqual({ versao: 1, tipo: 'solicitacao_exames', exames: [], indicacaoClinica: null, orientacoes: '', orientacoesFormato: 'marcacao' });
    // um objeto novo a cada chamada (o rascunho de um não muda o de outro)
    expect(conteudoVazio('receita')).not.toBe(conteudoVazio('receita'));
    expect(() => conteudoVazio('atestado' as never)).toThrow();
  });

  it('semCopia: mantém todas as chaves do conteúdo (orientacoesFormato, indicacaoClinica, uma desconhecida) e tira só copia e declaracao', () => {
    const solicitacao = {
      versao: 1 as const, tipo: 'solicitacao_exames' as const, exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true as const }],
      indicacaoClinica: 'Acompanhar a resposta à dieta.', orientacoes: 'Jejum de **8 h**.', orientacoesFormato: 'marcacao' as const,
      chaveFutura: { x: 1 },
      copia: { profissional: { nomeCompleto: 'Débora', crn: 'CRN-3 1', email: 'd@x.com', telefone: '1', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana' } },
      declaracao: DECLARACAO_SOLICITACAO,
    };
    const v = semCopia(solicitacao as never);
    expect(v).toEqual({
      versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true }],
      indicacaoClinica: 'Acompanhar a resposta à dieta.', orientacoes: 'Jejum de **8 h**.', orientacoesFormato: 'marcacao', chaveFutura: { x: 1 },
    });
    // a receita com orientacoesFormato (T9) também passa inteira
    const receita = { versao: 1 as const, tipo: 'receita' as const, itens: [], orientacoes: 'Com água.', orientacoesFormato: 'marcacao', declaracao: 'x' };
    expect(semCopia(receita as never)).toEqual({ versao: 1, tipo: 'receita', itens: [], orientacoes: 'Com água.', orientacoesFormato: 'marcacao' });
    // não muda o original
    expect(solicitacao).toHaveProperty('copia');
  });

  it('exigeHabilitacao é a mesma função de prescricao.ts; assertNever lança sem levar o valor à mensagem (regra 3)', () => {
    expect(exigeHabilitacao).toBe(daPrescricao);
    expect(exigeHabilitacao('fitoterapico')).toBe(true);
    expect(exigeHabilitacao('formula_fitoterapica')).toBe(true);
    expect(exigeHabilitacao('suplemento')).toBe(false);
    let msg = '';
    try {
      assertNever({ tipo: 'x', orientacoes: 'Jejum de 8 h' } as never);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBeTruthy();
    expect(msg).not.toContain('Jejum');
  });

  it('puro: nada alcançável importa @/db/client, @/db/tenant, server-only, pg ou drizzle-orm (o formulário "use client" lê daqui)', () => {
    const g = grafoDeImports(['src/modules/documentos/tipos-de-documento.ts']);
    for (const a of ['src/db/client.ts', 'src/db/tenant.ts']) expect(g.arquivos.has(a), `${a} alcançado por: ${caminhoAte(g, a).join(' → ')}`).toBe(false);
    for (const p of ['server-only', 'pg', 'drizzle-orm', 'pg-boss']) expect(g.pacotes.get(p), `${p} importado por`).toBeUndefined();
  });
});
