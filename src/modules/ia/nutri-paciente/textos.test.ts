import { describe, expect, it } from 'vitest';
import { BOTAO_AUTORIZO_IA_NUTRI } from '../textos-legais';
import { CATEGORIAS_CONVERSA, MAX_PERGUNTA, MSG_IA_NUTRI, NOME_IA_NUTRI, TIPOS_RESPOSTA } from './constantes';
import { COM_ENCAMINHAR, FRASE_DO_TIPO, FRASE_FINAL, TEXTO_DA_CATEGORIA, TEXTOS_FIXOS, type CodigoTextoFixo } from './textos';

const CODIGOS: CodigoTextoFixo[] = [
  'risco_emergencia', 'risco_transtorno', 'sintoma_agudo', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame',
  'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'nao_encontrei', 'falha', 'indisponivel',
];

describe('textos fixos (US-172 a US-176, DP-4): o banco guarda o código, a tela traduz', () => {
  it('um texto por código, a mesma lista fechada do CHECK de ia_nutri_mensagens.texto_fixo', () =>
    expect(Object.keys(TEXTOS_FIXOS).sort()).toEqual([...CODIGOS].sort()));

  it('os textos da spec, literais', () => {
    expect(TEXTOS_FIXOS.nao_encontrei).toBe('Não encontrei isso no seu plano. Quer enviar essa pergunta para sua nutricionista?');
    expect(TEXTOS_FIXOS.sintoma_agudo).toBe('Esses sinais precisam de atendimento médico agora. Ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Eu não consigo avaliar sintomas.');
    expect(TEXTOS_FIXOS.indisponivel).toBe(`A ${NOME_IA_NUTRI} está indisponível no momento. Você pode enviar sua dúvida para sua nutricionista.`);
  });

  it('os textos de risco levam aos canais de emergência e não oferecem encaminhar (US-173)', () => {
    for (const c of ['risco_emergencia', 'risco_transtorno'] as const) expect(TEXTOS_FIXOS[c]).toMatch(/CVV no 188.*SAMU no 192/);
    expect(TEXTOS_FIXOS.sintoma_agudo).toContain('SAMU no 192');
    for (const c of ['risco_emergencia', 'risco_transtorno', 'sintoma_agudo'] as const) expect(COM_ENCAMINHAR.has(c)).toBe(false);
    for (const c of CODIGOS.filter((x) => !['risco_emergencia', 'risco_transtorno', 'sintoma_agudo'].includes(x))) expect(COM_ENCAMINHAR.has(c)).toBe(true);
  });

  it('D33: o texto de peso ou dieta restritiva é o mesmo para todos, sem "peso", "calorias" nem "jejum"', () => {
    for (const p of ['peso', 'caloria', 'jejum']) expect(TEXTOS_FIXOS.peso_ou_dieta_restritiva.toLowerCase()).not.toContain(p);
  });

  it('cada categoria que não é plano tem o seu texto; risco do modelo → o de transtorno alimentar', () => {
    expect(Object.keys(TEXTO_DA_CATEGORIA).sort()).toEqual(CATEGORIAS_CONVERSA.filter((c) => c !== 'plano').sort());
    expect(TEXTO_DA_CATEGORIA.risco).toBe('risco_transtorno');
  });

  it('RN-172: uma frase por tipo e a frase final; nenhuma soa como sim ou não', () => {
    expect(Object.keys(FRASE_DO_TIPO).sort()).toEqual([...TIPOS_RESPOSTA].sort());
    // cada frase só apresenta o que está escrito (nunca começa com sim, não, pode ou deve)
    for (const f of Object.values(FRASE_DO_TIPO)) expect(f).toMatch(/^(No seu plano|Sua nutricionista escreveu)/);
    expect(FRASE_FINAL).toMatch(/^Isto é o que está escrito no seu plano\./);
  });
});

describe('MSG_IA_NUTRI (textos de tela)', () => {
  // 74 do plano + 2 da T11 (aviso80 no painel e a confirmação de desativar no consultório) + 3 da revisão da T11
  // (perfilIncompleto e completarPerfil, I1; riscoRevogadoNaFicha, I2) + 1 da revisão da T12 (mostrarAnteriores, I4)
  // + 1 da revisão final (ajudouSelo, US-175)
  it('as 81 chaves, nem mais nem menos (+ ajudouSelo, revisão final)', () => expect(Object.keys(MSG_IA_NUTRI)).toHaveLength(81));

  it('D37 / DP-18: o protocolo do "Sinal de risco" é texto final e não há trava de texto na ativação', () => {
    for (const linha of MSG_IA_NUTRI.protocoloRisco) {
      expect(linha.toLowerCase()).not.toContain('rascunho');
      expect(linha.toLowerCase()).not.toContain('em revisão');
    }
    expect(MSG_IA_NUTRI).not.toHaveProperty('textosEmRevisao');
    expect(MSG_IA_NUTRI.protocoloRisco[0]).toBe('Protocolo do "Sinal de risco":');
  });

  it('o nome visto pelo paciente sai da constante (D28, ★ DO-4)', () => {
    for (const t of [MSG_IA_NUTRI.avisoInicio, MSG_IA_NUTRI.autorIa, MSG_IA_NUTRI.semPlano, MSG_IA_NUTRI.convite, MSG_IA_NUTRI.desativar, MSG_IA_NUTRI.comoFuncionaTexto[0]])
      expect(t).toContain(NOME_IA_NUTRI);
    expect(MSG_IA_NUTRI.autorIa).toBe(`${NOME_IA_NUTRI} — inteligência artificial`);
  });

  it('o botão do consentimento é o mesmo texto citado no consentimento (revisão da T4, art. 33, VIII)', () =>
    expect(MSG_IA_NUTRI.autorizo).toBe(BOTAO_AUTORIZO_IA_NUTRI));

  it('DP-16: os dois botões do formulário têm rótulos diferentes', () => {
    expect(MSG_IA_NUTRI.enviarDireto).toBe('Enviar direto para minha nutricionista');
    expect(MSG_IA_NUTRI.enviarDireto).not.toBe(MSG_IA_NUTRI.encaminhar);
  });

  it('contador e limite de tamanho usam MAX_PERGUNTA; haHoras com singular e "menos de 1"', () => {
    expect(MAX_PERGUNTA).toBe(500);
    expect(MSG_IA_NUTRI.contador(12)).toBe('12 de 500 caracteres');
    expect(MSG_IA_NUTRI.longa).toContain(String(MAX_PERGUNTA));
    expect([0, 1, 5].map(MSG_IA_NUTRI.haHoras)).toEqual(['há menos de 1 hora', 'há 1 hora', 'há 5 horas']);
    expect(MSG_IA_NUTRI.usoDoMes(80)).toBe('Uso da IA Nutri neste mês: 80% do limite');
    expect(MSG_IA_NUTRI.situacaoVigente('14/10/2026')).toBe('Você autorizou em 14/10/2026.');
  });
});
