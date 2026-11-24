import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { EQUIPE_LIGADA } from '@/modules/plataforma/equipe-textos';
import { GUIAS, guiaDaRota, guiasDoPapel, ID_BOAS_VINDAS, ID_TOUR_DO_INICIO, papeisDoGuia, precisaDoGuia } from './conteudo';

// code review do PR 2 do Plano 26: o valor real de EQUIPE_LIGADA, salvo quando um teste liga (`equipe.ligada`)
const equipe = vi.hoisted(() => ({ ligada: null as boolean | null }));
vi.mock('@/modules/plataforma/equipe-textos', async (orig) => {
  const real = await orig<typeof import('@/modules/plataforma/equipe-textos')>();
  return {
    ...real,
    get EQUIPE_LIGADA() {
      return equipe.ligada ?? real.EQUIPE_LIGADA;
    },
  };
});

const TSX = ['src/app/painel', 'src/app/conta', 'src/components']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// Rótulos que vêm de módulos (opções da agenda, filtros): citados no manual, desenhados fora do .tsx
const TSX_FORA = ['src/modules/agenda', 'src/modules/conteudo', 'src/modules/documentos', 'src/modules/ia', 'src/modules/pacientes', 'src/modules/ficha', 'src/modules/financeiro', 'src/modules/exames', 'src/modules/relatorios']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')).map((d) => path.join(d.parentPath, d.name)))
  // Plano 16: os rótulos da resposta do diário ("Comeu como no plano") vêm de uma constante do portal (sem import de servidor)
  .concat(path.resolve('src/modules/portal/diario-constantes.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Páginas sem guia, com o motivo. */
const SEM_AJUDA: Record<string, string> = {
  '/painel/dpa': 'aceite do contrato: a nutricionista ainda não usa o painel',
  '/painel/ajuda': 'é o próprio manual',
  '/conta/outro-papel': 'aviso de aparelho conectado com outro papel (P09-03): uma frase e o botão Sair, sem fluxo para ensinar',
  '/painel/relatorios/imprimir': 'Plano 26 (RN-495): página de impressão, sem menu; o guia é o dos Relatórios, de onde se chega a ela',
  '/painel/sem-permissao': 'Plano 26 (RE-D47): tela de aviso, sem tarefa — uma frase e o "Voltar ao início"',
  '/painel/contrato-pendente': 'Plano 26 (RN-501): tela de aviso, sem tarefa — a recepção espera a nutricionista aceitar o contrato',
  '/conta/acesso-desativado':
    'Plano 26 (RN-503): tela de aviso, sem tarefa — uma frase e o "Sair"; com o termo de confidencialidade pendente (code review do PR 2, RN-500), o próprio termo, a caixa e o botão',
};
const UUID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
const textosDoGuia = (g: (typeof GUIAS)[number]) => [g.titulo, g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => [s.titulo, ...s.itens]), ...g.passos.flatMap((p) => [p.titulo, p.texto])];
// D18 (Plano 10A): as páginas de /conta (Segurança) também têm guia, mostrado na própria tela (fora do layout do painel)
const PAGINAS = ['painel', 'conta'].flatMap((raiz) =>
  readdirSync(path.resolve('src/app', raiz), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name === 'page.tsx')
    .map((d) => `/${raiz}/${path.relative(path.resolve('src/app', raiz), d.parentPath).split(path.sep).join('/')}`.replace(/\/$/, '').replace(/\[[^\]]+\]/g, UUID)),
);

describe('conteúdo do manual (P08-10)', () => {
  it('ids únicos e no formato do progresso; versão ≥ 1; textos curtos e não vazios', () => {
    expect(new Set(GUIAS.map((g) => g.id)).size).toBe(GUIAS.length);
    for (const g of GUIAS) {
      expect(g.id, g.id).toMatch(ID_GUIA);
      expect(g.versao).toBeGreaterThanOrEqual(1);
      expect(g.passos.length, g.id).toBeGreaterThan(0);
      for (const p of g.passos) {
        expect(p.titulo.length, `${g.id}: ${p.titulo}`).toBeGreaterThan(0);
        expect(p.texto.length, `${g.id}: ${p.titulo}`).toBeLessThanOrEqual(300);
      }
    }
    expect(GUIAS[0].id).toBe(ID_BOAS_VINDAS);
  });
  it.each(GUIAS.flatMap((g) => g.passos.filter((p) => p.alvo).map((p) => [g.id, p.alvo!])))('%s: o alvo "%s" existe como data-guia numa tela', (_g, alvo) => {
    expect(TSX).toContain(`data-guia="${alvo}"`);
  });
  it.each(PAGINAS.map((p) => [p]))('%s tem guia ou está em SEM_AJUDA', (pagina) => {
    expect(guiaDaRota(pagina) !== null || pagina in SEM_AJUDA, pagina).toBe(true);
  });
  it('todo nome de botão ou opção citado entre aspas existe numa tela (o manual não manda usar o que não existe)', () => {
    const textos = GUIAS.flatMap((g) => [g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => s.itens), ...g.passos.map((p) => p.texto)]);
    const citados = [...new Set(textos.flatMap((t) => [...t.matchAll(/"([^"]+)"/g)].map((m) => m[1])))];
    expect(citados.length).toBeGreaterThan(0);
    expect(citados.filter((c) => !TSX.includes(c) && !TSX_FORA.includes(c))).toEqual([]);
  });
  it('guiaDaRota: o plano alimentar tem guia próprio dentro do prontuário; o Início é o de boas-vindas', () => {
    expect(guiaDaRota('/painel')?.id).toBe(ID_BOAS_VINDAS);
    expect(guiaDaRota(`/painel/pacientes/${UUID}/plano-alimentar/${UUID}`)?.id).toBe('plano-alimentar');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/exames`)?.id).toBe('prontuario');
    expect(guiaDaRota('/painel/agenda/horarios')?.id).toBe('horarios');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/documentos`)?.id).toBe('documentos');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/documentos/${UUID}`)?.id).toBe('documentos');
  });
  it('D20 (Plano 10A): o guia do prontuário não cita a aba Documentos nem pede o tour de novo (a aba só aparece com o consultório liberado)', () => {
    const g = GUIAS.find((x) => x.id === 'prontuario')!;
    const textos = [g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => s.itens), ...g.passos.map((p) => p.texto)];
    expect(textos.filter((t) => /documento/i.test(t))).toEqual([]);
    expect(g.versao).toBeGreaterThanOrEqual(3); // 2 no Plano 14A pela autorização de IA (item novo nas perguntas comuns), 3 no Plano 18 pelas abas Início e Perfil, 4 no Plano 22 (abaixo); nunca pela aba Documentos
  });
  it('Plano 12: o passo do menu do boas-vindas cita "Exames recebidos" e o guia subiu de versão (quem já viu o tour, vê de novo)', () => {
    const g = GUIAS.find((x) => x.id === ID_BOAS_VINDAS)!;
    expect(g.versao).toBeGreaterThanOrEqual(2); // 3 desde o Plano 15 (abaixo)
    expect(g.passos.find((p) => p.alvo === 'menu')?.texto).toContain('"Exames recebidos" aparece também');
    expect(guiaDaRota('/painel/exames-recebidos')?.id).toBe('exames-recebidos');
    expect(guiaDaRota(`/painel/exames-recebidos/${UUID}`)?.id).toBe('exames-recebidos');
  });
  it('Plano 13: o guia de documentos cita o parecer e a retificação e subiu de versão (quem já viu o tour, vê de novo)', () => {
    const g = GUIAS.find((x) => x.id === 'documentos')!;
    expect(g.versao).toBe(2);
    expect(g.passos.map((p) => p.alvo)).toEqual(expect.arrayContaining(['novo-parecer', 'editor-parecer', 'retificar-documento']));
    expect(g.ajuda.secoes.flatMap((s) => s.itens).join(' ')).toContain('"Novo parecer nutricional"');
  });
  it('Plano 14B-1: os modelos sugeridos pela IA nos guias de Modelos e de Configurações, com a versão nova (quem já viu o tour, vê de novo)', () => {
    const modelos = GUIAS.find((x) => x.id === 'modelos')!;
    expect(modelos.versao).toBe(2);
    const textosModelos = [...modelos.ajuda.secoes.flatMap((s) => s.itens), ...modelos.passos.map((p) => p.texto)];
    expect(textosModelos).toContain('Modelos sugeridos pela IA chegam com a marca "Sugestão da IA — revise" e só podem ser usados com pacientes depois de "Aprovar modelo".');
    // revisão da T5F: o paciente nunca vê um modelo; aprovar só o libera para uso com pacientes
    expect(textosModelos.join(' ')).not.toMatch(/aparece\w* para os pacientes/);
    const config = GUIAS.find((x) => x.id === 'configuracoes')!;
    expect(config.versao).toBeGreaterThanOrEqual(6); // 7 desde a 14B-2 (o aditivo 1.1, abaixo)
    expect(config.ajuda.secoes.find((s) => s.titulo === 'Inteligência artificial (IA)')?.itens).toContain(
      'Modelos sugeridos pela IA: escolha a área e a IA prepara 2 modelos de plano e 1 de anamnese com os alimentos da sua tabela, sem nenhum dado de paciente.',
    );
    // o alvo da seção (data-guia="modelos-ia", em ModelosIa) entra na lista conferida pelo teste dos alvos acima
    expect(config.passos.map((p) => p.alvo)).toContain('modelos-ia');
  });
  it('Plano 14B-2: o resumo no prontuário e o rascunho no plano alimentar sem subir a versão (dependem da IA liberada); o aditivo 1.1 em Configurações, com a versão nova', () => {
    const itens = (id: string) => GUIAS.find((x) => x.id === id)!.ajuda.secoes.flatMap((s) => s.itens);
    expect(itens('prontuario')).toContain(
      '"Resumo do histórico (IA)": um resumo do prontuário antes da consulta, com cada frase ligada ao registro de onde veio. Só com a autorização do paciente; as notas privadas só vão se você marcar "Incluir notas privadas".',
    );
    expect(GUIAS.find((x) => x.id === 'prontuario')!.versao).toBeGreaterThanOrEqual(3); // Plano 18: abas Início e Perfil; 4 desde o Plano 22 (abaixo)
    expect(itens('plano-alimentar')).toContain(
      '"Gerar rascunho com IA": informe a meta, os macronutrientes e as refeições; a IA escolhe alimentos da TACO e da sua tabela, e todas as contas são do sistema. O plano publicado leva o selo "Elaborado com apoio de IA e revisado pela nutricionista".',
    );
    expect(GUIAS.find((x) => x.id === 'plano-alimentar')!.versao).toBe(2); // 2 desde o Plano 17 (a seção Lembretes no app, abaixo)
    // as telas novas ficam no guia do prontuário e no do plano alimentar
    expect(guiaDaRota(`/painel/pacientes/${UUID}/resumo-ia`)?.id).toBe('prontuario');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/plano-alimentar/rascunho-ia`)?.id).toBe('plano-alimentar');
    const config = GUIAS.find((x) => x.id === 'configuracoes')!;
    expect(config.versao).toBeGreaterThanOrEqual(7); // 8 desde o Plano 15 (o aditivo 1.2, abaixo)
    const ia = itens('configuracoes').join(' ');
    expect(ia).toContain('"Aceitar a versão atual"');
    expect(ia).not.toMatch(/A leitura de laudos com IA só aparece/); // o texto da 1.0 saiu
  });
  it('Plano 15: o aditivo 1.2 e a IA Nutri em Configurações (versão 8, com o passo da subseção); a 1.2 não invalida autorização nenhuma', () => {
    const config = GUIAS.find((x) => x.id === 'configuracoes')!;
    expect(config.versao).toBeGreaterThanOrEqual(8); // 9 desde o Plano 22 (o cartão "Exames", abaixo)
    const ia = config.ajuda.secoes.find((s) => s.titulo === 'Inteligência artificial (IA)')!.itens;
    expect(ia).toContain(
      'O aditivo está na versão 1.2, que inclui o resumo do histórico, o rascunho de plano alimentar e a IA Nutri para pacientes. Quem aceitou a versão 1.1 continua usando a leitura de laudos, o resumo, o rascunho e os modelos; só a IA Nutri pede o aceite da 1.2 ("Aceitar a versão atual").',
    );
    expect(ia).toContain('IA Nutri para pacientes: ative em Configurações, libere paciente por paciente na ficha e acompanhe a fila "Dúvidas dos pacientes".');
    expect(ia.join(' ')).not.toContain('A autorização que o paciente deu na versão anterior também não vale mais');
    expect(ia.join(' ')).not.toContain('versão 1.1, que inclui');
    expect(config.passos.map((p) => p.alvo)).toContain('ia-nutri-secao');
  });
  it('Plano 15 (★ DO-6): o passo do menu do boas-vindas cita "Dúvidas dos pacientes" e a versão sobe para 3 neste PR', () => {
    const g = GUIAS.find((x) => x.id === ID_BOAS_VINDAS)!;
    expect(g.versao).toBeGreaterThanOrEqual(3); // 4 desde o Plano 20 (abaixo)
    expect(g.passos.find((p) => p.alvo === 'menu')?.texto).toContain('"Dúvidas dos pacientes" aparece também, com o número das abertas.');
  });
  it('Plano 15: a fila "Dúvidas dos pacientes" e a aba "IA Nutri" da ficha têm guia próprio (a aba antes do guia do prontuário)', () => {
    expect(guiaDaRota('/painel/duvidas')?.id).toBe('duvidas');
    expect(guiaDaRota(`/painel/duvidas/${UUID}`)?.id).toBe('duvidas');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/ia-nutri`)?.id).toBe('ia-nutri');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/ia-nutri-x`)?.id).toBe('prontuario');
    expect(GUIAS.find((x) => x.id === 'duvidas')!.passos.map((p) => p.alvo)).toEqual(['fila-duvidas']);
  });
  it('Plano 17: a seção "Lembretes no app" no guia do plano alimentar (versão 2, passo depois de Publicar e o limite nas perguntas comuns)', () => {
    const g = GUIAS.find((x) => x.id === 'plano-alimentar')!;
    expect(g.versao).toBe(2);
    expect(g.passos.map((p) => p.alvo)).toEqual(['editor-plano', 'publicar-plano', 'lembretes-app']);
    expect(g.passos.find((p) => p.alvo === 'lembretes-app')).toEqual({
      alvo: 'lembretes-app',
      titulo: 'Lembretes no app',
      texto: 'Configure água, avisos das refeições do plano, suplemento e lembrete livre. O paciente pode desligar qualquer um; o nome do suplemento e o texto livre aparecem só dentro do app.',
    });
    const perguntas = g.ajuda.secoes.find((s) => s.titulo === 'Perguntas comuns')!.itens.join(' ');
    expect(perguntas).toContain('24 lembretes por dia');
    expect(perguntas).toContain('entre 6h e 22h');
  });
  it('Plano 20: o passo do menu do boas-vindas cita "Financeiro" e a versão sobe para 4 (quem já viu o tour, vê de novo)', () => {
    const g = GUIAS.find((x) => x.id === ID_BOAS_VINDAS)!;
    expect(g.versao).toBeGreaterThanOrEqual(4); // 5 desde o Plano 26 (abaixo)
    expect(g.passos.find((p) => p.alvo === 'menu')?.texto).toContain('Financeiro');
  });
  it('Plano 20 (T7): o guia da Agenda cita a cobrança criada ao marcar "Realizada" e a versão sobe para 2', () => {
    const g = GUIAS.find((x) => x.id === 'agenda')!;
    expect(g.versao).toBe(2);
    const passos = g.ajuda.secoes.find((s) => s.titulo === 'Passo a passo')!.itens.join(' ');
    expect(passos).toContain('Realizada');
    expect(passos).toContain('cobrança');
    expect(passos).toContain('Financeiro');
  });
  it('Plano 20: o Financeiro tem guia próprio (versão 1, último da lista), com os alvos do Resumo, das Configurações, dos Lançamentos, dos Pagamentos pendentes e dos Relatórios', () => {
    const g = GUIAS.find((x) => x.id === 'financeiro')!;
    expect(g.versao).toBe(1);
    expect(GUIAS.at(-1)?.id).toBe('financeiro');
    for (const rota of ['/painel/financeiro', '/painel/financeiro/configuracoes', '/painel/financeiro/lancamentos/novo', `/painel/financeiro/lancamentos/${UUID}`, `/painel/financeiro/pendencias/${UUID}`, '/painel/financeiro/pendencias', '/painel/financeiro/relatorios'])
      expect(guiaDaRota(rota)?.id, rota).toBe('financeiro');
    expect(guiaDaRota('/painel/financeirox')).toBeNull();
    expect(g.passos.map((p) => p.alvo)).toEqual([
      'financeiro-secoes',
      'financeiro-cartoes',
      'financeiro-saldo',
      'financeiro-valor-consulta',
      'financeiro-categorias',
      'financeiro-filtros',
      'financeiro-novo',
      'financeiro-receber',
      'financeiro-cancelar',
      'financeiro-pendentes',
      'financeiro-relatorios',
      'financeiro-csv',
    ]);
    for (const rota of ['/painel/financeiro/lancamentos', `/painel/financeiro/lancamentos/${UUID}`]) expect(guiaDaRota(rota)?.id, rota).toBe('financeiro');
  });

  it('Plano 18 (§8.2): o guia do prontuário na versão 3, com o cabeçalho e as abas Início e Perfil; o resumo e o passo a passo citam os dois', () => {
    const g = GUIAS.find((x) => x.id === 'prontuario')!;
    expect(g.versao).toBeGreaterThanOrEqual(3); // 4 desde o Plano 22 (a aba Exames, abaixo)
    expect(g.passos.find((p) => p.alvo === 'cabecalho-paciente')?.texto).toBe(
      'Nome, idade, situação e as medidas da última avaliação, com a data. O selo mostra se o paciente está arquivado ou bloqueado.',
    );
    expect(g.passos.find((p) => p.alvo === 'abas-prontuario')?.texto).toBe(
      'Início reúne o que já foi feito; Perfil guarda o cadastro. Cada parte do acompanhamento tem a sua aba.',
    );
    expect(g.ajuda.resumo).toMatch(/Início.*Perfil/);
    const passoAPasso = g.ajuda.secoes.find((s) => s.titulo === 'Passo a passo')!.itens;
    expect(passoAPasso[0]).toMatch(/Início.*Perfil.*anamnese/);
  });
  it('Plano 18 (§8.1): o guia de Pacientes na versão 2 — busca com as abas, o passo novo "Ações" e as ajudas que ficariam falsas', () => {
    const g = GUIAS.find((x) => x.id === 'pacientes')!;
    expect(g.versao).toBe(2);
    expect(g.passos.map((p) => p.alvo)).toEqual(['novo-paciente', 'busca-pacientes', 'acoes-paciente', 'cadastro-paciente']);
    expect(g.passos.find((p) => p.alvo === 'busca-pacientes')?.texto).toBe(
      'Ache um paciente pelo nome ou pelo e-mail. As abas separam ativos e arquivados; os bloqueados ficam em Ver bloqueados.',
    );
    expect(g.passos.find((p) => p.alvo === 'acoes-paciente')?.texto).toBe('Em Ações você abre a ficha, edita o cadastro, arquiva ou reativa o paciente sem sair da lista.');
    const itens = g.ajuda.secoes.flatMap((s) => s.itens);
    const texto = itens.join(' ');
    expect(texto).not.toContain('filtro de situação');
    expect(texto).toContain('ficam na aba Inativos');
    expect(itens).toContainEqual(expect.stringContaining('use "Reenviar convite" em "Acesso ao app", na aba Perfil da ficha.'));
    expect(texto).not.toContain('no prontuário');
    expect(g.passos.map((p) => p.texto).join(' ')).not.toContain('Reenviar convite');
  });
  it('Plano 18 (§8.3): o guia "Início do paciente" casa só o Início da ficha, vem antes do prontuário e traz os passos da spec', () => {
    const g = GUIAS.find((x) => x.id === 'inicio-paciente')!;
    expect(g.titulo).toBe('Início do paciente');
    expect(g.versao).toBe(2); // 2 no PR 2 do Plano 18: o cartão No app e o selo
    expect(guiaDaRota(`/painel/pacientes/${UUID}`)?.id).toBe('inicio-paciente');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/perfil`)?.id).toBe('perfil-paciente'); // guia próprio desde a Tarefa 7a
    expect(guiaDaRota(`/painel/pacientes/${UUID}/app`)?.id).toBe('prontuario');
    expect(GUIAS.findIndex((x) => x.id === 'inicio-paciente')).toBeLessThan(GUIAS.findIndex((x) => x.id === 'prontuario'));
    expect(g.passos.map((p) => p.alvo)).toEqual(['cabecalho-paciente', 'abas-prontuario', 'adicionar-prontuario', 'secoes-inicio', 'no-app-cartao']);
    const prontuario = GUIAS.find((x) => x.id === 'prontuario')!;
    for (const alvo of ['cabecalho-paciente', 'abas-prontuario']) expect(g.passos.find((p) => p.alvo === alvo)?.texto).toBe(prontuario.passos.find((p) => p.alvo === alvo)?.texto);
    expect(g.passos.find((p) => p.alvo === 'adicionar-prontuario')?.texto).toBe('Um botão só para registrar anamnese, medidas, exames, atendimentos e prescrições.');
    // Tarefa 9 (PR 2, versao 2): a frase do selo volta ao passo das seções, e o passo do cartão entra (spec §8.3)
    expect(g.passos.find((p) => p.alvo === 'secoes-inicio')?.texto).toBe('Cada seção mostra quantos registros há e os três mais recentes. O selo No app marca o que o paciente vê no app.');
    expect(g.passos.find((p) => p.alvo === 'no-app-cartao')?.texto).toBe('O que o paciente enxerga no app, contado com as mesmas regras do app.');
    // a explicação da página "No app do paciente" fica nas ajudas deste guia (a página cai no guia `prontuario`)
    expect(g.ajuda.secoes.flatMap((s) => s.itens)).toContainEqual(expect.stringContaining('"No app do paciente"'));
    // os documentos só aparecem com a liberação no consultório (a linha some sem ela, §8.5); só a gaveta: sem subir versão
    expect(g.ajuda.secoes.flatMap((s) => s.itens)).toContainEqual(expect.stringContaining('os documentos (só quando liberados no consultório)'));
  });
  it('Plano 18 (§8.4): o guia "Perfil do paciente" casa só o Perfil, vem antes do prontuário e traz o passo do cadastro em seções; o de Pacientes tem o mesmo passo (Novo paciente)', () => {
    const g = GUIAS.find((x) => x.id === 'perfil-paciente')!;
    expect(g.titulo).toBe('Perfil do paciente');
    expect(g.versao).toBe(1);
    expect(guiaDaRota(`/painel/pacientes/${UUID}/perfil`)?.id).toBe('perfil-paciente');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/perfil/x`)?.id).toBe('prontuario');
    expect(guiaDaRota(`/painel/pacientes/${UUID}`)?.id).toBe('inicio-paciente');
    expect(GUIAS.findIndex((x) => x.id === 'perfil-paciente')).toBeLessThan(GUIAS.findIndex((x) => x.id === 'prontuario'));
    const passo = { alvo: 'cadastro-paciente', titulo: 'Cadastro do paciente', texto: 'O cadastro fica em seções. Só nome, nascimento, sexo e e-mail são obrigatórios; o resto completa o registro da primeira consulta.' };
    expect(g.passos).toContainEqual(passo);
    const pacientes = GUIAS.find((x) => x.id === 'pacientes')!;
    expect(guiaDaRota('/painel/pacientes/novo')?.id).toBe('pacientes');
    expect(pacientes.passos).toContainEqual(passo);
  });
  it('nenhum título de guia repetido (o manual completo lista um h2 por guia; "Início" é o de boas-vindas)', () => {
    expect(new Set(GUIAS.map((g) => g.titulo)).size).toBe(GUIAS.length);
  });
  it('D18 (Plano 10A): /conta/seguranca tem guia (o 2FA é exigido para assinar documentos)', () => {
    expect(guiaDaRota('/conta/seguranca')?.id).toBe('seguranca');
  });
  it('Plano 26 (PR 1): o passo do menu do boas-vindas cita "Relatórios" e a versão sobe para 5 (quem já viu o tour, vê de novo)', () => {
    const g = GUIAS.find((x) => x.id === ID_BOAS_VINDAS)!;
    expect(g.versao).toBe(5);
    expect(g.passos.find((p) => p.alvo === 'menu')?.texto).toContain('Financeiro, Relatórios e Configurações');
  });
  it('Plano 26 (PR 1): os Relatórios têm guia próprio (versão 1) nas seis seções, com os passos da spec §6.2; a impressão fica em SEM_AJUDA', () => {
    const g = GUIAS.find((x) => x.id === 'relatorios')!;
    expect(g.versao).toBe(1);
    expect(g.titulo).toBe('Relatórios');
    for (const rota of ['/painel/relatorios', '/painel/relatorios/atendimentos', '/painel/relatorios/planos', '/painel/relatorios/agenda', '/painel/relatorios/financeiro', '/painel/relatorios/ranking'])
      expect(guiaDaRota(rota)?.id, rota).toBe('relatorios');
    for (const rota of ['/painel/relatorios/imprimir', '/painel/relatorios/outra', '/painel/relatoriosx']) expect(guiaDaRota(rota), rota).toBeNull();
    expect(g.passos).toEqual([
      { alvo: 'abas-relatorios', titulo: 'Seções dos relatórios', texto: 'Cada aba mostra um assunto. Os números são do consultório inteiro, sem abrir nenhum prontuário.' },
      // v1 sem o local (a frase do local entra na v2, com o Plano 23 — T11a)
      { alvo: 'filtro-periodo', titulo: 'Período', texto: 'Escolha até 12 meses.' },
      { alvo: 'exportar', titulo: 'Baixar ou imprimir', texto: 'Baixe em CSV para planilha ou imprima e salve em PDF.' },
    ]);
    expect([g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => s.itens)].join(' ')).not.toMatch(/local/i);
  });
  it('precisaDoGuia: versão nova volta a pedir; concluído/dispensado na versão atual, não', () => {
    const g = GUIAS[0];
    expect(precisaDoGuia({}, g, ['concluido', 'dispensado'])).toBe(true);
    expect(precisaDoGuia({ [g.id]: { v: g.versao, estado: 'dispensado' } }, g, ['concluido', 'dispensado'])).toBe(false);
    expect(precisaDoGuia({ [g.id]: { v: g.versao - 1, estado: 'concluido' } }, g, ['concluido', 'dispensado'])).toBe(true);
  });
  it('Plano 22 (T3): o guia "exames-do-consultorio" cobre as telas de /painel/exames; "configuracoes" sobe (+1) e o passo dos cartões cita "Exames"', () => {
    const g = GUIAS.find((x) => x.id === 'exames-do-consultorio')!;
    expect(g.versao).toBe(1);
    for (const r of ['/painel/exames/catalogo', '/painel/exames/catalogo/novo', `/painel/exames/catalogo/${UUID}`, '/painel/exames/modelos', '/painel/exames/modelos/novo', `/painel/exames/modelos/${UUID}`]) {
      expect(guiaDaRota(r)?.id, r).toBe('exames-do-consultorio');
    }
    expect(guiaDaRota('/painel/exames-recebidos')?.id).toBe('exames-recebidos');
    expect(g.passos.map((p) => p.alvo)).toEqual(['secoes-exames', 'nomes-para-comecar', 'novo-exame-catalogo', 'faixas-consultorio', 'modelos-nota']);
    const config = GUIAS.find((x) => x.id === 'configuracoes')!;
    expect(config.versao).toBe(9); // Plano 22: o cartão "Exames" (+1 sobre a main)
    expect(config.passos.find((p) => p.alvo === 'cartoes-configuracoes')?.texto).toContain('"Exames"');
  });

  it('Plano 22 (T4, EP-D52): o guia do prontuário cita "Adicionar do catálogo" e "Editar" na aba Exames e sobe para a versão 4; editar e versões ficam no guia do prontuário', () => {
    const g = GUIAS.find((x) => x.id === 'prontuario')!;
    expect(g.versao).toBe(4);
    const passo = g.ajuda.secoes.find((s) => s.titulo === 'Passo a passo')!.itens.join(' ');
    expect(passo).toContain('"Adicionar do catálogo"');
    expect(passo).toContain('"Editar"');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/exames/${UUID}/editar`)?.id).toBe('prontuario');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/exames/${UUID}/versoes`)?.id).toBe('prontuario');
  });

  it('Plano 26 (RE-D20, revisão da P26-08): a recepção tem a Segurança dela (`recepcao-seguranca`, 2FA obrigatório); a da nutricionista fica como estava (v1, só dela)', () => {
    const g = GUIAS.find((x) => x.id === 'recepcao-seguranca')!;
    expect(g).toMatchObject({ versao: 1, papeis: ['recepcao'] });
    expect(g.ajuda.resumo).toContain('o painel só abre depois de ativá-la');
    expect(guiaDaRota('/conta/seguranca', 'recepcao')?.id).toBe('recepcao-seguranca');
    expect(guiaDaRota('/conta/seguranca', 'nutri')?.id).toBe('seguranca');
    const nutri = GUIAS.find((x) => x.id === 'seguranca')!;
    expect(nutri.versao).toBe(1);
    expect(papeisDoGuia(nutri)).toEqual(['nutri']);
    expect(textosDoGuia(nutri).join(' ')).not.toMatch(/recepção/i);
    expect(textosDoGuia(g).join(' ')).not.toMatch(/assin/i); // assinar documentos é da nutricionista
  });
  it('Plano 26 (T6): as telas de aviso da recepção ficam sem guia (SEM_AJUDA)', () => {
    for (const rota of ['/painel/sem-permissao', '/painel/contrato-pendente', '/conta/acesso-desativado']) {
      expect(guiaDaRota(rota), rota).toBeNull();
      expect(rota in SEM_AJUDA, rota).toBe(true);
    }
  });
});

describe('Plano 26 (T7): o guia da Equipe', () => {
  it('a Equipe tem guia próprio (`equipe`, v1), antes do de Configurações, com os dois passos da spec', () => {
    expect(guiaDaRota('/painel/configuracoes/equipe')?.id).toBe('equipe');
    expect(guiaDaRota('/painel/configuracoes')?.id).toBe('configuracoes');
    expect(guiaDaRota('/painel/configuracoes/perfil')?.id).toBe('configuracoes');
    const ids = GUIAS.map((g) => g.id);
    expect(ids.indexOf('equipe')).toBeLessThan(ids.indexOf('configuracoes'));
    const g = GUIAS.find((x) => x.id === 'equipe')!;
    expect(g.versao).toBe(1);
    expect(g.passos.map((p) => [p.alvo, p.texto])).toEqual([
      ['convidar', 'Convide a pessoa da recepção. Ela cuida da agenda e do cadastro e não vê dados de saúde.'],
      ['permissao-financeiro', 'Marque se ela também cuida do Financeiro.'],
    ]);
  });
});

describe('code review do PR 2 do Plano 26 (RE-D52): o guia da Equipe fora do manual enquanto a tela estiver desligada', () => {
  it('com EQUIPE_LIGADA = false (o valor do PR 2): fora de guiasDoPapel (o índice e as seções de /painel/ajuda), mas ainda em GUIAS', () => {
    expect(EQUIPE_LIGADA).toBe(false);
    expect(guiasDoPapel('nutri').map((g) => g.id)).not.toContain('equipe');
    expect(guiasDoPapel('recepcao').map((g) => g.id)).not.toContain('equipe');
    expect(GUIAS.map((g) => g.id)).toContain('equipe');
    // só a Equipe sai: o resto do manual da nutricionista continua inteiro, na ordem de GUIAS
    expect(guiasDoPapel('nutri').map((g) => g.id)).toEqual(GUIAS.filter((g) => papeisDoGuia(g).includes('nutri') && g.id !== 'equipe').map((g) => g.id));
  });
  it('com a Equipe ligada, o guia volta ao manual da nutricionista, antes do de Configurações', () => {
    equipe.ligada = true;
    try {
      const ids = guiasDoPapel('nutri').map((g) => g.id);
      expect(ids).toContain('equipe');
      expect(ids.indexOf('equipe')).toBeLessThan(ids.indexOf('configuracoes'));
      expect(guiasDoPapel('recepcao').map((g) => g.id)).not.toContain('equipe');
    } finally {
      equipe.ligada = null;
    }
  });
});

describe('Plano 26 (T8, RE-D42): manual guiado por papel', () => {
  const PROIBIDAS_NA_RECEPCAO = [/Configura[çc][õo]es/i, /Realizada/i, /Iniciar atendimento/i, /Ver bloqueados/i, /etiqueta/i, /\barquivar\b/i];
  const textosDe = (g: (typeof GUIAS)[number]) => [g.titulo, g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => [s.titulo, ...s.itens]), ...g.passos.flatMap((p) => [p.titulo, p.texto])];
  const daRecepcao = GUIAS.filter((g) => papeisDoGuia(g).includes('recepcao'));

  it('sem `papeis`, o guia é só da nutricionista; o boas-vindas é só dela e o Início da recepção tem o tour próprio', () => {
    const boasVindas = GUIAS.find((g) => g.id === ID_BOAS_VINDAS)!;
    expect(papeisDoGuia(boasVindas)).toEqual(['nutri']);
    expect(guiaDaRota('/painel', 'nutri')?.id).toBe(ID_BOAS_VINDAS);
    expect(guiaDaRota('/painel')?.id).toBe(ID_BOAS_VINDAS); // padrão: a nutricionista
    expect(guiaDaRota('/painel', 'recepcao')?.id).toBe('recepcao-inicio');
    expect(ID_TOUR_DO_INICIO).toEqual({ nutri: ID_BOAS_VINDAS, recepcao: 'recepcao-inicio' });
    for (const g of GUIAS.filter((x) => !x.papeis)) expect(papeisDoGuia(g), g.id).toEqual(['nutri']);
  });
  it('o guia `recepcao-inicio` (v1, só da recepção, em /painel) aponta para alvos do Início dela e do cabeçalho', () => {
    const g = GUIAS.find((x) => x.id === 'recepcao-inicio')!;
    expect(g).toMatchObject({ versao: 1, papeis: ['recepcao'] });
    expect(g.padrao.test('/painel')).toBe(true);
    expect(g.padrao.test('/painel/agenda')).toBe(false);
    const alvos = g.passos.flatMap((p) => (p.alvo ? [p.alvo] : []));
    expect(alvos).toEqual(expect.arrayContaining(['menu', 'agenda-hoje', 'presenca']));
    expect(alvos.filter((a) => !['menu', 'agenda-hoje', 'presenca', 'tema', 'ajuda', 'conta'].includes(a))).toEqual([]);
    expect(GUIAS.at(-1)?.id).toBe('financeiro'); // o Financeiro continua o último
  });
  it('a recepção não vê nenhum guia clínico nem da nutricionista: só os `recepcao-*`', () => {
    const ids = guiasDoPapel('recepcao').map((g) => g.id);
    expect(ids).toEqual(['recepcao-inicio', 'recepcao-seguranca']); // revisão final do PR 2: o índice do manual dela, exato
    expect(ids.filter((id) => !id.startsWith('recepcao-'))).toEqual([]);
    for (const rota of ['/painel/pacientes', `/painel/pacientes/${UUID}`, `/painel/pacientes/${UUID}/plano-alimentar`, '/painel/agenda', '/painel/diarios', '/painel/configuracoes', '/painel/financeiro', '/painel/relatorios'])
      expect(guiaDaRota(rota, 'recepcao'), rota).toBeNull();
    expect(guiaDaRota('/conta/seguranca', 'recepcao')?.id).toBe('recepcao-seguranca');
    expect(guiasDoPapel('nutri').map((g) => g.id)).not.toContain('recepcao-inicio');
  });
  it.each(daRecepcao.map((g) => [g.id]))('o guia %s, que a recepção vê, não cita Configurações, Realizada, Iniciar atendimento, Ver bloqueados, Etiqueta nem Arquivar', (id) => {
    const textos = textosDe(GUIAS.find((g) => g.id === id)!);
    for (const p of PROIBIDAS_NA_RECEPCAO) expect(textos.filter((t) => p.test(t)), `${id}: ${p}`).toEqual([]);
  });
  it('todo chamador de guiaDaRota fora dos testes passa o papel da sessão (o padrão `nutri` é só para os testes antigos)', () => {
    const fontes = ['src', 'scripts']
      .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name)).map((d) => path.join(d.parentPath, d.name)))
      .filter((f) => !f.endsWith(path.join('modules', 'ajuda', 'conteudo.ts')));
    const chamadas = fontes.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bguiaDaRota\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => ({ f: path.relative(process.cwd(), f), args: m[1] })));
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.filter((c) => !c.args.includes(',')).map((c) => `${c.f}: guiaDaRota(${c.args})`)).toEqual([]);
  });
});
