import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS, guiaDaRota, ID_BOAS_VINDAS, precisaDoGuia } from './conteudo';

const TSX = ['src/app/painel', 'src/app/conta', 'src/components']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// Rótulos que vêm de módulos (opções da agenda, filtros): citados no manual, desenhados fora do .tsx
const TSX_FORA = ['src/modules/agenda', 'src/modules/conteudo', 'src/modules/documentos', 'src/modules/ia', 'src/modules/pacientes', 'src/modules/ficha']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')).map((d) => path.join(d.parentPath, d.name)))
  // Plano 16: os rótulos da resposta do diário ("Comeu como no plano") vêm de uma constante do portal (sem import de servidor)
  .concat(path.resolve('src/modules/portal/diario-constantes.ts'))
  // Plano 19: os selos ("Meu alimento", "USDA (EUA)") saem de seloDaFonte (fontes.ts), não de um literal no .tsx
  .concat(path.resolve('src/modules/alimentos/fontes.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Páginas sem guia, com o motivo. */
const SEM_AJUDA: Record<string, string> = {
  '/painel/dpa': 'aceite do contrato: a nutricionista ainda não usa o painel',
  '/painel/ajuda': 'é o próprio manual',
  '/conta/outro-papel': 'aviso de aparelho conectado com outro papel (P09-03): uma frase e o botão Sair, sem fluxo para ensinar',
};
const UUID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
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
    expect(g.versao).toBe(3); // 2 no Plano 14A pela autorização de IA (item novo nas perguntas comuns), 3 no Plano 18 pelas abas Início e Perfil; nunca pela aba Documentos
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
    expect(GUIAS.find((x) => x.id === 'prontuario')!.versao).toBe(3); // Plano 18: abas Início e Perfil
    expect(itens('plano-alimentar')).toContain(
      '"Gerar rascunho com IA": informe a meta, os macronutrientes e as refeições; a IA escolhe alimentos da TACO e da sua tabela, e todas as contas são do sistema. O plano publicado leva o selo "Elaborado com apoio de IA e revisado pela nutricionista".',
    );
    expect(GUIAS.find((x) => x.id === 'plano-alimentar')!.versao).toBe(3); // 2 = Plano 17 (a seção Lembretes no app, abaixo); 3 = Plano 19 (passos do modo e dos dias, abaixo)
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
    expect(config.versao).toBe(8);
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
    expect(g.versao).toBe(3);
    expect(g.passos.find((p) => p.alvo === 'menu')?.texto).toContain('"Dúvidas dos pacientes" aparece também, com o número das abertas.');
  });
  it('Plano 15: a fila "Dúvidas dos pacientes" e a aba "IA Nutri" da ficha têm guia próprio (a aba antes do guia do prontuário)', () => {
    expect(guiaDaRota('/painel/duvidas')?.id).toBe('duvidas');
    expect(guiaDaRota(`/painel/duvidas/${UUID}`)?.id).toBe('duvidas');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/ia-nutri`)?.id).toBe('ia-nutri');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/ia-nutri-x`)?.id).toBe('prontuario');
    expect(GUIAS.find((x) => x.id === 'duvidas')!.passos.map((p) => p.alvo)).toEqual(['fila-duvidas']);
  });
  it('Plano 17: a seção "Lembretes no app" no guia do plano alimentar (versão 2, 3 com o Plano 19; passo depois de Publicar e o limite nas perguntas comuns)', () => {
    const g = GUIAS.find((x) => x.id === 'plano-alimentar')!;
    expect(g.versao).toBe(3);
    expect(g.passos.map((p) => p.alvo)).toEqual(['editor-plano', 'modo-plano', 'dias-refeicao', 'publicar-plano', 'lembretes-app']);
    expect(g.passos.find((p) => p.alvo === 'lembretes-app')).toEqual({
      alvo: 'lembretes-app',
      titulo: 'Lembretes no app',
      texto: 'Configure água, avisos das refeições do plano, suplemento e lembrete livre. O paciente pode desligar qualquer um; o nome do suplemento e o texto livre aparecem só dentro do app.',
    });
    const perguntas = g.ajuda.secoes.find((s) => s.titulo === 'Perguntas comuns')!.itens.join(' ');
    expect(perguntas).toContain('24 lembretes por dia');
    expect(perguntas).toContain('entre 6h e 22h');
  });

  it('Plano 18 (§8.2): o guia do prontuário na versão 3, com o cabeçalho e as abas Início e Perfil; o resumo e o passo a passo citam os dois', () => {
    const g = GUIAS.find((x) => x.id === 'prontuario')!;
    expect(g.versao).toBe(3);
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
  it('Plano 18: o guia de Pacientes manda ao "Reenviar convite" da aba Perfil, só na gaveta (o tour não muda, versão 1)', () => {
    const g = GUIAS.find((x) => x.id === 'pacientes')!;
    expect(g.versao).toBe(1);
    const itens = g.ajuda.secoes.flatMap((s) => s.itens);
    expect(itens).toContainEqual(expect.stringContaining('use "Reenviar convite" em "Acesso ao app", na aba Perfil do prontuário.'));
    expect(g.passos.map((p) => p.texto).join(' ')).not.toContain('Reenviar convite');
  });
  it('Plano 18 (§8.3): o guia "Início do paciente" casa só o Início da ficha, vem antes do prontuário e traz os passos da spec', () => {
    const g = GUIAS.find((x) => x.id === 'inicio-paciente')!;
    expect(g.titulo).toBe('Início do paciente');
    expect(g.versao).toBe(1);
    expect(guiaDaRota(`/painel/pacientes/${UUID}`)?.id).toBe('inicio-paciente');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/perfil`)?.id).toBe('prontuario');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/app`)?.id).toBe('prontuario');
    expect(GUIAS.findIndex((x) => x.id === 'inicio-paciente')).toBeLessThan(GUIAS.findIndex((x) => x.id === 'prontuario'));
    expect(g.passos.map((p) => p.alvo)).toEqual(['cabecalho-paciente', 'abas-prontuario', 'adicionar-prontuario', 'secoes-inicio']);
    const prontuario = GUIAS.find((x) => x.id === 'prontuario')!;
    for (const alvo of ['cabecalho-paciente', 'abas-prontuario']) expect(g.passos.find((p) => p.alvo === alvo)?.texto).toBe(prontuario.passos.find((p) => p.alvo === alvo)?.texto);
    expect(g.passos.find((p) => p.alvo === 'adicionar-prontuario')?.texto).toBe('Um botão só para registrar anamnese, medidas, exames, atendimentos e prescrições.');
    expect(g.passos.find((p) => p.alvo === 'secoes-inicio')?.texto).toBe('Cada seção mostra quantos registros há e os três mais recentes.');
    // O selo "No app" só existe a partir da Tarefa 9 (PR 2): na versao 1 nenhum texto do guia fala dele.
    expect(JSON.stringify({ ajuda: g.ajuda, passos: g.passos })).not.toMatch(/No app/);
  });
  it('nenhum título de guia repetido (o manual completo lista um h2 por guia; "Início" é o de boas-vindas)', () => {
    expect(new Set(GUIAS.map((g) => g.titulo)).size).toBe(GUIAS.length);
  });
  it('Plano 19 (Tarefa 3): guia "Alimentos" na versão 2, resumo com as tabelas públicas (sem "A tabela TACO")', () => {
    const g = GUIAS.find((x) => x.id === 'alimentos')!;
    expect(g.versao).toBe(2);
    expect(g.ajuda.resumo).toBe('As tabelas públicas de composição (TACO) e os alimentos que você cadastrar ("Meu alimento"), com as medidas caseiras.');
    expect(g.ajuda.resumo).not.toContain('A tabela TACO');
  });
  it('D18 (Plano 10A): /conta/seguranca tem guia (o 2FA é exigido para assinar documentos)', () => {
    expect(guiaDaRota('/conta/seguranca')?.id).toBe('seguranca');
  });
  it('precisaDoGuia: versão nova volta a pedir; concluído/dispensado na versão atual, não', () => {
    const g = GUIAS[0];
    expect(precisaDoGuia({}, g, ['concluido', 'dispensado'])).toBe(true);
    expect(precisaDoGuia({ [g.id]: { v: g.versao, estado: 'dispensado' } }, g, ['concluido', 'dispensado'])).toBe(false);
    expect(precisaDoGuia({ [g.id]: { v: g.versao - 1, estado: 'concluido' } }, g, ['concluido', 'dispensado'])).toBe(true);
  });

  it('Plano 19: os passos do modo e dos dias entre o editor e "Publicar", com a versão nova', () => {
    const g = GUIAS.find((x) => x.id === 'plano-alimentar')!;
    const alvos = g.passos.map((p) => p.alvo);
    const editor = alvos.indexOf('editor-plano');
    expect(alvos.slice(editor, editor + 4)).toEqual(['editor-plano', 'modo-plano', 'dias-refeicao', 'publicar-plano']);
    expect(g.versao).toBe(3); // 2 = Plano 17 (Lembretes no app); 3 = Plano 19
  });

  it('Plano 19 (Tarefa 5): guia novo "biblioteca-do-plano" (versão 1) nas telas da biblioteca; o passo dos perfis diz que a plataforma não traz valores prontos', () => {
    for (const rota of ['/painel/planos/referencias', `/painel/planos/referencias/${UUID}`, '/painel/planos/referencias/novo', '/painel/planos/listas', `/painel/planos/listas/${UUID}`, '/painel/planos/refeicoes', `/painel/planos/refeicoes/${UUID}`])
      expect(guiaDaRota(rota)?.id, rota).toBe('biblioteca-do-plano');
    expect(guiaDaRota('/painel/planos/modelos')?.id).toBe('modelos');
    expect(guiaDaRota('/painel/planos/referenciasx')).toBeNull();
    const g = GUIAS.find((x) => x.id === 'biblioteca-do-plano')!;
    expect(g.versao).toBe(1);
    expect(g.passos.every((p) => p.alvo === undefined)).toBe(true);
    expect(g.passos.find((p) => p.titulo === 'Perfis de referência')?.texto).toContain('A plataforma não traz valores prontos');
  });
});
