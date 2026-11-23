import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DO_PLANO_18, SECOES_DO_PLANO_18 as SECOES_18 } from '../../../test/ficha';
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
const ACOES: readonly ChaveDeAcao[] = ['criar-receita', 'criar-parecer', 'criar-solicitacao'];
const GRUPOS: readonly GrupoDoAdicionar[] = ['avaliacoes', 'prescricoes', 'outros'];
const UUID = '0b6c3c9e-8a3f-4a1d-9a54-6f7c2a1e9d11';
/**
 * Lista fechada do que um arquivo de `secoes/` pode importar. Plano que precisar de import novo acrescenta aqui, de
 * propósito e com a revisão vendo: nunca um helper que audite por padrão (o arquivo da seção não grava trilha; quem grava
 * a leitura de uma seção com `leitura` é `inicio.ts`).
 */
const IMPORTS_PERMITIDOS = [
  'drizzle-orm',
  '@/db/schema',
  '@/modules/pacientes/datas',
  '@/modules/documentos/constantes',
  // exames-enviados.ts (seção): o filtro do titular (doTitular/titularVisivel), o mesmo da fila "Exames recebidos". O
  // módulo só chama auditRead dentro de abrirEnvio; importar o filtro não audita nada (code review do PR 1 do Plano 18)
  '@/modules/pacientes/exames-enviados',
  '@/modules/pacientes/exames-enviados-constantes',
  '../textos',
  '../tipos',
  './comum',
  // Tarefa 9 (comum.ts, `noAppPor`): os tipos da tabela e da coluna (só `import type`) e o `idValido` dos ids pedidos — o
  // módulo base não grava trilha (só a checagem do id e os erros do paciente)
  'drizzle-orm/pg-core',
  // só o `idValido` (NOMES_PERMITIDOS, abaixo)
  '@/modules/pacientes/base',
];
/**
 * Módulos da lista em que só alguns nomes podem vir (o resto do módulo fica fora): de `pacientes/base`, só o `idValido`
 * (não `carregarPacienteParaEscrita` nem outro helper que leia o banco).
 */
const NOMES_PERMITIDOS: Record<string, readonly string[]> = { '@/modules/pacientes/base': ['idValido'] };
/** Os nomes de `import { a, b as c } from '<de>'` (sem `type`, sem `* as`, sem default). */
const nomesImportadosDe = (src: string, de: string) =>
  [...src.matchAll(new RegExp(`^\\s*import\\s+([^;]*?)\\s+from\\s+['"]${de.replace(/[/.@]/g, '\\$&')}['"]`, 'gm'))].map((m) => {
    const clausula = m[1].trim();
    const chaves = /^\{([^}]*)\}$/.exec(clausula);
    if (!chaves) return [`<${clausula}>`]; // default, namespace ou misto: não está na lista de nomes
    return chaves[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.split(/\s+as\s+/)[0].trim());
  }).flat();
/** `index.ts` também importa cada arquivo de seção (`./<id>`). */
const IMPORTS_DO_INDEX = FONTES.map((x) => `./${x.f.replace(/\.ts$/, '')}`).filter((de) => de !== './index');
/** Os módulos de `import … from '…'`, `export … from '…'` e `import '…'` (sem nome). */
const importsDe = (src: string) =>
  [...src.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2]);

describe('registro de seções (RN-277, RN-278)', () => {
  it('ordem da RN-278 (as do Plano 18 primeiro; as de outros planos no fim) e títulos da spec §8.3', () => {
    expect(SECOES_DA_FICHA.slice(0, DO_PLANO_18.length).map((s) => s.id)).toEqual([...DO_PLANO_18]);
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

  it('a lista de nomes por módulo pega o que vier além do permitido (controle da guarda)', () => {
    expect(nomesImportadosDe("import { idValido } from '@/modules/pacientes/base';", '@/modules/pacientes/base')).toEqual(['idValido']);
    expect(nomesImportadosDe("import { idValido, carregarPacienteParaEscrita as c } from '@/modules/pacientes/base';", '@/modules/pacientes/base')).toEqual(['idValido', 'carregarPacienteParaEscrita']);
    expect(nomesImportadosDe("import * as base from '@/modules/pacientes/base';", '@/modules/pacientes/base')).toEqual(['<* as base>']);
    expect(nomesImportadosDe("import { idValido } from '@/modules/pacientes/datas';", '@/modules/pacientes/base')).toEqual([]);
  });

  it('ids únicos', () => {
    const ids = SECOES_DA_FICHA.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('um arquivo por seção (mais index.ts e comum.ts), nenhum chama auditRead nem usa o contexto de paciente sem login, e os imports ficam na lista fechada', () => {
    const arquivos = FONTES.map((x) => x.f).filter((f) => f !== 'index.ts' && f !== 'comum.ts');
    expect(arquivos.map((f) => f.replace(/\.ts$/, '')).sort()).toEqual(SECOES_DA_FICHA.map((s) => s.id).sort());
    for (const { f, src } of FONTES) {
      expect(src, f).not.toMatch(/auditRead|recordAudit/);
      expect(src, f).not.toMatch(PALAVRA_DO_CONTEXTO_SEM_LOGIN);
      expect(src, f).not.toMatch(/liberarReceitasDoPlano/);
      expect(src, f).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
      const imports = importsDe(src);
      expect(imports.length, f).toBeGreaterThan(0);
      const permitidos = f === 'index.ts' ? [...IMPORTS_PERMITIDOS, ...IMPORTS_DO_INDEX] : IMPORTS_PERMITIDOS;
      for (const de of imports) expect(permitidos, `${f}: ${de}`).toContain(de);
      for (const [de, nomes] of Object.entries(NOMES_PERMITIDOS)) for (const n of nomesImportadosDe(src, de)) expect(nomes, `${f}: ${n} de ${de}`).toContain(n);
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
      // Plano 22 (T8, US-377): a solicitação no fim de `adicionar`, no grupo Avaliações
      { grupo: 'avaliacoes', rotulo: 'Solicitação de exames', destino: { acao: 'criar-solicitacao' } },
    ]);
    expect(MSG_FICHA.itens.solicitacao).toBe('Solicitação de exames');
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
