import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECOES_DA_FICHA } from './secoes';
import { MSG_FICHA } from './textos';
import type { ChaveDeAcao, GrupoDoAdicionar } from './tipos';

// Plano 18 (RN-277, RN-278): o registro de seções do Início — ordem, ids, destinos e a guarda de fonte dos arquivos de seção.
const PASTA = path.resolve('src/modules/ficha/secoes');
const FONTES = readdirSync(PASTA)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ f, src: readFileSync(path.join(PASTA, f), 'utf8') }));
// A palavra do contexto de paciente sem login é montada aqui para não aparecer escrita neste arquivo (sem-conta-guarda)
const PALAVRA_DO_CONTEXTO_SEM_LOGIN = new RegExp(`\\bsem${'Conta'}\\b`);
const ACOES: readonly ChaveDeAcao[] = ['criar-receita', 'criar-parecer'];
const GRUPOS: readonly GrupoDoAdicionar[] = ['avaliacoes', 'prescricoes', 'outros'];
const UUID = '0b6c3c9e-8a3f-4a1d-9a54-6f7c2a1e9d11';
/** As 8 seções do Plano 18, na ordem da RN-278; os outros planos acrescentam as suas no fim (spec §11). */
const DO_PLANO_18 = ['plano-alimentar', 'antropometria', 'gasto-energetico', 'anamneses', 'atendimentos', 'exames', 'exames-enviados', 'documentos'];
const SECOES_18 = SECOES_DA_FICHA.filter((s) => DO_PLANO_18.includes(s.id));

describe('registro de seções (RN-277, RN-278)', () => {
  it('ordem da RN-278 (as do Plano 18 primeiro; as de outros planos no fim) e títulos da spec §8.3', () => {
    expect(SECOES_DA_FICHA.slice(0, DO_PLANO_18.length).map((s) => s.id)).toEqual(DO_PLANO_18);
    expect(SECOES_18.map((s) => s.titulo)).toEqual([
      'Plano alimentar',
      'Antropometria',
      'Gasto energético',
      'Anamneses',
      'Atendimentos',
      'Exames',
      'Exames enviados pelo paciente',
      'Documentos',
    ]);
    expect(SECOES_18.map((s) => s.titulo)).toEqual(Object.values(MSG_FICHA.titulos));
  });

  it('ids únicos', () => {
    const ids = SECOES_DA_FICHA.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('um arquivo por seção (mais index.ts e comum.ts), e nenhum chama auditRead nem usa o contexto de paciente sem login', () => {
    const arquivos = FONTES.map((x) => x.f).filter((f) => f !== 'index.ts' && f !== 'comum.ts');
    expect(arquivos.map((f) => f.replace(/\.ts$/, '')).sort()).toEqual(SECOES_DA_FICHA.map((s) => s.id).sort());
    for (const { f, src } of FONTES) {
      expect(src, f).not.toMatch(/auditRead|recordAudit/);
      expect(src, f).not.toMatch(PALAVRA_DO_CONTEXTO_SEM_LOGIN);
      expect(src, f).not.toMatch(/liberarReceitasDoPlano/);
    }
  });

  it('todo destino do Adicionar é href (relativo sem "/" inicial ou absoluto em /painel/) ou uma ChaveDeAcao', () => {
    const entradas = SECOES_DA_FICHA.flatMap((s) => s.adicionar ?? []);
    expect(entradas.length).toBeGreaterThan(0);
    for (const e of entradas) {
      expect(GRUPOS).toContain(e.grupo);
      expect(e.rotulo.length).toBeGreaterThan(0);
      if ('href' in e.destino) {
        const { href } = e.destino;
        expect(href.startsWith('/painel/') || (!href.startsWith('/') && href.length > 0 && !href.includes('//')), href).toBe(true);
      } else {
        expect(ACOES).toContain(e.destino.acao);
      }
    }
  });

  it('Adicionar (RN-280, US-263): os itens, os grupos e os destinos por âncora', () => {
    const por = Object.fromEntries(SECOES_DA_FICHA.map((s) => [s.id, (s.adicionar ?? []).map((e) => ({ ...e }))]));
    expect(por['plano-alimentar']).toEqual([{ grupo: 'prescricoes', rotulo: 'Plano alimentar', destino: { href: 'plano-alimentar' } }]);
    expect(por.antropometria).toEqual([{ grupo: 'avaliacoes', rotulo: 'Antropometria', destino: { href: 'antropometria#nova-avaliacao' } }]);
    expect(por['gasto-energetico']).toEqual([{ grupo: 'avaliacoes', rotulo: 'Gasto energético', destino: { href: 'gasto-energetico#novo-calculo' } }]);
    expect(por.anamneses).toEqual([{ grupo: 'avaliacoes', rotulo: 'Anamnese', destino: { href: 'anamnese#modelo' } }]);
    expect(por.atendimentos).toEqual([{ grupo: 'avaliacoes', rotulo: 'Atendimento', destino: { href: 'atendimentos#novo-atendimento' } }]);
    expect(por.exames).toEqual([{ grupo: 'avaliacoes', rotulo: 'Exame', destino: { href: 'exames#novo-exame' } }]);
    expect(por['exames-enviados']).toEqual([]);
    expect(por.documentos).toEqual([
      { grupo: 'prescricoes', rotulo: 'Receita', destino: { acao: 'criar-receita' } },
      { grupo: 'prescricoes', rotulo: 'Parecer nutricional', destino: { acao: 'criar-parecer' } },
    ]);
  });

  it('exames-enviados: "Ver todos" na aba Exames e o item abre em /painel/exames-recebidos/{id}', () => {
    const envios = SECOES_DA_FICHA.find((s) => s.id === 'exames-enviados')!;
    expect(envios.aba).toBe('exames');
    expect(FONTES.find((x) => x.f === 'exames-enviados.ts')!.src).toContain('/painel/exames-recebidos/');
  });

  it('abas das seções (o "Ver todos" sem verTodos)', () => {
    expect(Object.fromEntries(SECOES_18.map((s) => [s.id, s.aba]))).toEqual({
      'plano-alimentar': 'plano-alimentar',
      antropometria: 'antropometria',
      'gasto-energetico': 'gasto-energetico',
      anamneses: 'anamnese',
      atendimentos: 'atendimentos',
      exames: 'exames',
      'exames-enviados': 'exames',
      documentos: 'documentos',
    });
  });

  it('verTodos, quando existe, devolve caminho absoluto em /painel/', () => {
    for (const s of SECOES_DA_FICHA) if (s.verTodos) expect(s.verTodos(UUID), s.id).toMatch(/^\/painel\//);
  });

  it('nenhuma das 8 seções do Plano 18 declara leitura (o Início não grava auditRead delas)', () => {
    expect(SECOES_18.filter((s) => s.leitura)).toEqual([]);
  });

  it('documentos só com documentosLiberados; envios com o recebimento ligado ou algum envio (RN-192)', () => {
    const p = { id: UUID, status: 'ativo', anonimizadoEm: null };
    const doc = SECOES_DA_FICHA.find((s) => s.id === 'documentos')!;
    const env = SECOES_DA_FICHA.find((s) => s.id === 'exames-enviados')!;
    const t = (o: { documentosLiberados?: boolean; examesPacienteAtivadoEm?: Date | null }) => ({ fuso: 'America/Sao_Paulo', documentosLiberados: false, examesPacienteAtivadoEm: null, ...o });
    expect(doc.disponivel(t({}), p, 3)).toBe(false);
    expect(doc.disponivel(t({ documentosLiberados: true }), p, 0)).toBe(true);
    expect(env.disponivel(t({}), p, 0)).toBe(false);
    expect(env.disponivel(t({}), p, 1)).toBe(true);
    expect(env.disponivel(t({ examesPacienteAtivadoEm: new Date() }), p, 0)).toBe(true);
    for (const s of SECOES_18.filter((x) => x.id !== 'documentos' && x.id !== 'exames-enviados')) expect(s.disponivel(t({}), p, 0), s.id).toBe(true);
  });
});
