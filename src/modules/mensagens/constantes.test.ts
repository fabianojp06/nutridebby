import { describe, expect, it } from 'vitest';
import { FORMAS_TCLE, RISCOS_CHAT } from '@/db/schema/mensagens';
import { detectarRisco } from '@/modules/ia/nutri-paciente/sinais-risco';
import {
  ERROS_DO_UPLOAD_PAINEL,
  ERROS_DO_UPLOAD_PORTAL,
  MSG_MENSAGENS,
  MSG_PORTAL_MENSAGENS,
  MSG_RECADOS,
  OPCOES_FORMA_TCLE,
  RISCO_DO_TEXTO_FIXO,
  ROTULO_FORMA_TCLE,
  SOCORRO_DO_RISCO,
  TEXTOS_AVISO,
  erroDoUpload,
  rotuloDoQuando,
} from './constantes';

const FUSO = 'America/Sao_Paulo';
/** Instante a partir da hora de Brasília (UTC-3, sem horário de verão desde 2019). */
const brt = (s: string) => new Date(`${s}-03:00`);

describe('Plano 25 — RISCO_DO_TEXTO_FIXO (RN-449)', () => {
  it('cobre os três códigos de detectarRisco, pelo textoFixo (não pelo grupo)', () => {
    const exemplos = { risco_emergencia: 'eu me mato', sintoma_agudo: 'meu peito dói', risco_transtorno: 'vomito depois de comer pra não engordar' } as const;
    for (const [codigo, texto] of Object.entries(exemplos)) expect(detectarRisco(texto)?.textoFixo).toBe(codigo);
    expect(Object.keys(RISCO_DO_TEXTO_FIXO).sort()).toEqual(Object.keys(exemplos).sort());
    expect(RISCO_DO_TEXTO_FIXO).toEqual({ risco_emergencia: 'emergencia', sintoma_agudo: 'sintoma_agudo', risco_transtorno: 'transtorno_alimentar' });
    // o grupo junta sintoma agudo e autolesão em `emergencia`; a mensagem grava o risco do texto fixo
    expect(detectarRisco('meu peito dói')?.risco).toBe('emergencia');
    expect(RISCO_DO_TEXTO_FIXO[detectarRisco('meu peito dói')!.textoFixo]).toBe('sintoma_agudo');
    for (const r of Object.values(RISCO_DO_TEXTO_FIXO)) expect(RISCOS_CHAT).toContain(r);
  });

  it('cada risco gravado tem o texto de socorro da §6.2', () => {
    expect(Object.keys(SOCORRO_DO_RISCO).sort()).toEqual([...RISCOS_CHAT].sort());
    expect(SOCORRO_DO_RISCO.sintoma_agudo).toBe(
      'Esses sinais precisam de atendimento médico agora. Ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Sua nutricionista não acompanha as mensagens em tempo real.',
    );
  });
});

describe('Plano 25 — textos da liberação e da pausa (§6.2, RN-441, RN-442)', () => {
  it('liberação: diálogo, opções sem a forma verbal, confirmação, erro e sucesso', () => {
    const L = MSG_MENSAGENS.liberacao;
    expect(L.botao).toBe('Liberar conversa');
    expect(L.titulo('Ana Souza')).toBe('Liberar a conversa com Ana Souza?');
    expect(L.texto).toBe(
      'A conversa por mensagens é atendimento a distância (telenutrição). Antes de liberar, explique ao paciente as possibilidades, os limites e as fragilidades do atendimento por mensagens e que as mensagens ficam guardadas no prontuário, colha a ciência e a concordância dele com o TCLE de telenutrição, envie a ele o comprovante e guarde uma cópia.',
    );
    expect(L.avisoENutricionista).toBe('Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante.');
    expect(L.perguntaForma).toBe('Como o paciente (ou o responsável legal) concordou?');
    expect(L.opcaoInicial).toBe('Escolha');
    expect(L.confirmacao).toBe('O paciente, ou o responsável legal, deu ciência e concordou com o TCLE de telenutrição, e enviei a ele o comprovante.');
    expect([L.liberar, L.cancelar, L.erro, L.sucesso, L.semCarimbo]).toEqual([
      'Liberar',
      'Cancelar',
      'Escolha como o paciente concordou e marque a confirmação.',
      'Conversa liberada.',
      'Para liberar a conversa, preencha seu nome e seu CRN em Configurações.',
    ]);
    // CH-D3: só as duas formas com comprovante (art. 9º, parágrafo único, da Res. CFN 760/2023)
    expect(Object.keys(OPCOES_FORMA_TCLE)).toEqual([...FORMAS_TCLE]);
    expect(OPCOES_FORMA_TCLE).toEqual({ termo_assinado: 'Termo assinado (em papel ou digital)', aceite_escrito: 'Aceite por escrito (mensagem ou e-mail)' });
    expect(ROTULO_FORMA_TCLE).toEqual({ termo_assinado: 'termo assinado', aceite_escrito: 'aceite por escrito' });
    expect(MSG_MENSAGENS.estados.liberadaEm('23/11/2026', ROTULO_FORMA_TCLE.aceite_escrito)).toBe('Liberada em 23/11/2026 (aceite por escrito)');
    expect(JSON.stringify(MSG_MENSAGENS.liberacao)).not.toMatch(/verbal/i);
  });

  it('pausa e retomada', () => {
    const P = MSG_MENSAGENS.pausa;
    expect(P.botao).toBe('Pausar conversa');
    expect(P.confirmar('Ana Souza')).toBe(
      'Pausar a conversa com Ana Souza? O paciente continua vendo as mensagens, mas não envia novas. Combine com o paciente como o acompanhamento continua.',
    );
    expect([P.pausar, P.cancelar, P.sucesso, P.retomar, P.retomada]).toEqual(['Pausar', 'Cancelar', 'Conversa pausada.', 'Retomar conversa', 'Conversa retomada.']);
    expect(MSG_MENSAGENS.estados.seloPausada).toBe('Conversa pausada');
  });

  it('estados da conversa no painel', () => {
    const E = MSG_MENSAGENS.estados;
    expect(E.naoLiberada('Ana Souza')).toBe('A conversa com Ana Souza ainda não foi liberada.');
    expect(E.arquivado).toBe('Paciente arquivado: a conversa fica só para consulta.');
    expect(E.bloqueado).toBe('Pedido de exclusão atendido: a conversa fica só para consulta.');
    expect(E.anonimizado).toBe('Paciente anonimizado: a conversa foi apagada junto com os dados do paciente.');
    expect(E.semAcesso('Ana Souza')).toBe(
      'Ana Souza ainda não tem acesso ao app. As mensagens ficam guardadas e aparecem quando o acesso for ativado; até lá, o paciente não recebe aviso.',
    );
  });
});

describe('Plano 25 — horário e configuração (§6.2, US-446, RN-451)', () => {
  it('textos da tela de configuração e do portal', () => {
    const C = MSG_MENSAGENS.configuracao;
    expect([C.fimAntesDoInicio, C.sobreposicao, C.faixasDemais]).toEqual([
      'O fim tem de ser depois do início.',
      'As faixas do mesmo dia não podem se sobrepor.',
      'No máximo 3 faixas por dia.',
    ]);
    expect(C.ajudaAviso).toBe('No máximo um e-mail a cada 2 horas, sem nome de paciente nem o texto. Fora do horário de mensagens, não avisamos.');
    expect(C.rotuloDas('Segunda', 2)).toBe('Segunda, faixa 2, das');
    expect(C.rotuloAs('Segunda', 2)).toBe('Segunda, faixa 2, às');
    expect(C.rotuloRemover(2, 'Segunda')).toBe('Remover faixa 2 de Segunda');
    expect(C.dias).toEqual(['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']);
    const P = MSG_PORTAL_MENSAGENS;
    expect(P.horario('segunda a sexta, 9h às 12h e 14h às 18h')).toBe('Horário de atendimento por mensagens: segunda a sexta, 9h às 12h e 14h às 18h.');
    expect(P.semHorario).toBe('Sua nutricionista ainda não definiu o horário de atendimento por mensagens.');
    expect(P.avisoUrgencia).toBe('Este canal não é para urgências. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo.');
  });
});

describe('Plano 25 — singulares e códigos fechados (§6.2)', () => {
  it('singular e plural', () => {
    expect(MSG_MENSAGENS.caixa.naoLidas(1)).toBe('1 não lida');
    expect(MSG_MENSAGENS.caixa.naoLidas(3)).toBe('3 não lidas');
    expect(MSG_MENSAGENS.menu.aria(1)).toBe('Mensagens, 1 não lida');
    expect(MSG_MENSAGENS.menu.aria(4)).toBe('Mensagens, 4 não lidas');
    expect(MSG_MENSAGENS.menu.comContador(4)).toBe('Mensagens (4)');
    expect(MSG_PORTAL_MENSAGENS.entrada.aria(1)).toBe('Mensagens, 1 não lida');
    expect(MSG_RECADOS.novo.vaiPara(1)).toBe('Vai para 1 paciente no app.');
    expect(MSG_RECADOS.novo.vaiPara(12)).toBe('Vai para 12 pacientes no app.');
    expect(MSG_RECADOS.novo.semAcesso(1)).toBe('1 paciente sem acesso ao app não recebe.');
    expect(MSG_RECADOS.novo.semAcesso(2)).toBe('2 pacientes sem acesso ao app não recebem.');
    expect(MSG_RECADOS.novo.enviadoPara(1)).toBe('Recado enviado para 1 paciente.');
    expect(MSG_RECADOS.novo.enviadoPara(30)).toBe('Recado enviado para 30 pacientes.');
    expect(MSG_RECADOS.novo.contador(1000)).toBe('1.000/1.000');
    expect(MSG_RECADOS.novo.contador(12)).toBe('12/1.000');
    expect(MSG_RECADOS.lidoPorDe(3, 10)).toBe('Lido por 3 de 10');
  });

  it('?erro= do upload sem JS: só os códigos fechados mostram texto (v0.3)', () => {
    expect(Object.keys(ERROS_DO_UPLOAD_PAINEL).sort()).toEqual(['carimbo', 'conversa', 'cota', 'falha', 'formato', 'limite', 'tamanho']);
    expect(Object.keys(ERROS_DO_UPLOAD_PORTAL).sort()).toEqual(['conversa', 'cota', 'falha', 'formato', 'limite', 'muitas', 'tamanho']);
    expect(erroDoUpload('painel', 'cota')).toBe('Espaço de armazenamento esgotado. Fale com o suporte.');
    expect(erroDoUpload('portal', 'cota')).toBe('Não foi possível enviar a foto agora. Fale com o consultório.');
    expect(erroDoUpload('portal', 'conversa')).toBe('A conversa por mensagens está pausada. Use os canais de sempre.');
    expect(erroDoUpload('painel', 'muitas')).toBeNull();
    expect(erroDoUpload('portal', 'carimbo')).toBeNull();
    expect(erroDoUpload('painel', 'toString')).toBeNull();
    expect(erroDoUpload('painel', ['falha'])).toBeNull();
    expect(erroDoUpload('painel', undefined)).toBeNull();
  });
});

describe('Plano 25 — rotuloDoQuando (§6.2, caixa)', () => {
  const agora = brt('2026-11-23T10:00:00');
  it('agora, minutos, horas do mesmo dia, ontem, dd/mm e dd/mm/aaaa no fuso do consultório', () => {
    expect(rotuloDoQuando(brt('2026-11-23T09:59:30'), agora, FUSO)).toBe('agora');
    expect(rotuloDoQuando(brt('2026-11-23T10:00:05'), agora, FUSO)).toBe('agora'); // relógio adiantado não vira "há -1 min"
    expect(rotuloDoQuando(brt('2026-11-23T09:59:00'), agora, FUSO)).toBe('há 1 min');
    expect(rotuloDoQuando(brt('2026-11-23T09:01:00'), agora, FUSO)).toBe('há 59 min');
    expect(rotuloDoQuando(brt('2026-11-23T09:00:00'), agora, FUSO)).toBe('há 1 h');
    expect(rotuloDoQuando(brt('2026-11-23T00:10:00'), agora, FUSO)).toBe('há 9 h');
    expect(rotuloDoQuando(brt('2026-11-22T23:50:00'), agora, FUSO)).toBe('ontem');
    expect(rotuloDoQuando(brt('2026-11-22T00:00:00'), agora, FUSO)).toBe('ontem');
    expect(rotuloDoQuando(brt('2026-11-21T23:59:00'), agora, FUSO)).toBe('21/11');
    expect(rotuloDoQuando(brt('2025-12-31T12:00:00'), agora, FUSO)).toBe('31/12/2025');
  });

  it('a virada do dia é a do fuso, não a do servidor em UTC', () => {
    // 00:30 de 24/11 em Brasília = 03:30 UTC; a mensagem das 23:00 de 23/11 (02:00 UTC de 24/11) é "ontem" no fuso
    const meiaNoite = brt('2026-11-24T00:30:00');
    expect(rotuloDoQuando(brt('2026-11-23T23:00:00'), meiaNoite, FUSO)).toBe('ontem');
    expect(rotuloDoQuando(brt('2026-11-24T00:05:00'), meiaNoite, FUSO)).toBe('há 25 min');
    // 21:30 de 23/11 em Brasília = 00:30 UTC de 24/11: a das 20:00 continua no mesmo dia (há 1 h)
    expect(rotuloDoQuando(brt('2026-11-23T20:00:00'), brt('2026-11-23T21:30:00'), FUSO)).toBe('há 1 h');
  });
});

describe('Plano 25 v0.4 — identificação profissional sem "CRN CRN" (RN-471, revisão CFN)', () => {
  const CRN = 'CRN-4 12345'; // tenants.crn já vem com o prefixo (CRN_REGEX)
  it('os modelos que levam o CRN não repetem o prefixo', () => {
    const textos = [
      MSG_MENSAGENS.conversa.carimbo('Debora Rodrigues', CRN),
      MSG_PORTAL_MENSAGENS.carimbo('Debora Rodrigues', CRN),
      MSG_PORTAL_MENSAGENS.conversaCom('Debora Rodrigues', CRN),
      MSG_PORTAL_MENSAGENS.carimboRecado('Debora Rodrigues', CRN),
    ];
    expect(textos).toEqual([
      'Debora Rodrigues · Nutricionista · CRN-4 12345',
      'Debora Rodrigues · Nutricionista · CRN-4 12345',
      'Conversa com Debora Rodrigues, nutricionista, CRN-4 12345',
      'Recado do consultório · Debora Rodrigues · CRN-4 12345',
    ]);
    for (const t of textos) expect(t).not.toMatch(/CRN\s+CRN/);
  });

  it('nenhuma função de texto do módulo, com o CRN como argumento, produz "CRN CRN"', () => {
    const visitar = (o: unknown): string[] =>
      typeof o === 'function'
        ? [String((o as (...a: string[]) => unknown)(...Array.from({ length: (o as () => unknown).length }, () => CRN)))]
        : o && typeof o === 'object'
          ? Object.values(o).flatMap(visitar)
          : [];
    const saidas = [MSG_MENSAGENS, MSG_RECADOS, MSG_PORTAL_MENSAGENS, TEXTOS_AVISO].flatMap(visitar);
    expect(saidas.length).toBeGreaterThan(20);
    expect(saidas.filter((t) => /CRN\s+CRN/.test(t))).toEqual([]);
  });
});

describe('Plano 25 v0.4 — CH-D73: nenhum texto promete prazo de leitura', () => {
  it('fora do horário e a ajuda do portal', () => {
    expect(MSG_PORTAL_MENSAGENS.foraDoHorario).toBe(
      'Agora é fora do horário de atendimento por mensagens. Sua mensagem fica guardada e será lida quando sua nutricionista voltar ao atendimento por mensagens.',
    );
    expect(MSG_PORTAL_MENSAGENS.ajuda.resposta).toBe(
      'Não. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Sua nutricionista lê as mensagens no horário de atendimento por mensagens, não em tempo real, e a conversa fica guardada no seu prontuário.',
    );
    const todos = JSON.stringify([MSG_MENSAGENS, MSG_RECADOS, MSG_PORTAL_MENSAGENS]);
    expect(todos).not.toMatch(/próximo horário|é lida no|lida em até|responde em/i);
  });
});

