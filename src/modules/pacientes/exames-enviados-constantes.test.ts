import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diasEntre, ENVIO_TOTAL_MAX_BYTES, haDias, MSG_ENVIO, MSG_REVISAO, nomeDoEnvio, ROTULO_MOTIVO_RECUSA, situacaoParaPaciente } from './exames-enviados-constantes';

const s = (status: string, extra: Partial<Parameters<typeof situacaoParaPaciente>[0]> = {}) =>
  situacaoParaPaciente({ status, motivoRecusa: null, motivoRecusaTexto: null, motivoFalha: null, ...extra });

describe('textos do envio de exame (spec C v0.3 §6.2, US-160 a US-165)', () => {
  it('a situação que o paciente vê, com o texto exato da spec', () => {
    expect(s('processando')).toBe('Processando…');
    expect(s('recebido')).toBe('Aguardando sua nutricionista');
    expect(s('aceito')).toBe('Recebido no seu prontuário');
    expect(s('recusado', { motivoRecusa: 'ilegivel' })).toBe('Não aceito: Arquivo ilegível');
    expect(s('recusado', { motivoRecusa: 'outra_pessoa' })).toBe('Não aceito: Exame de outra pessoa');
    expect(s('recusado', { motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2' })).toBe('Não aceito: Faltou a página 2');
    expect(s('expirado')).toBe('Não revisado a tempo. Se ainda for útil, envie de novo.');
    expect(s('falhou', { motivoFalha: 'conversao' })).toBe('Não conseguimos processar o arquivo. Tente enviar de novo.');
    expect(s('falhou', { motivoFalha: 'interrompido' })).toBe('Não conseguimos processar o arquivo. Tente enviar de novo.');
    expect(s('falhou', { motivoFalha: 'paginas' })).toBe('O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.');
    expect(s('falhou', { motivoFalha: 'cota' })).toBe('Não foi possível enviar agora: o espaço de arquivos do consultório acabou. Avise sua nutricionista.');
  });

  it('motivos de recusa e mensagens da US-160 a US-165', () => {
    expect(Object.values(ROTULO_MOTIVO_RECUSA)).toEqual(['Arquivo ilegível', 'Não é um exame', 'Exame de outra pessoa', 'Exame repetido', 'Outro motivo']);
    expect(MSG_ENVIO.arquivos).toBe('Envie 1 PDF de até 20 MB ou até 5 fotos (JPEG, PNG ou HEIC) de até 10 MB cada, somando até 30 MB.');
    expect(MSG_ENVIO.enviado).toBe('Exame enviado. Sua nutricionista vai revisar.');
    expect(MSG_ENVIO.pendentes).toBe('Você já tem 10 exames aguardando sua nutricionista. Aguarde a revisão antes de enviar outros.');
    expect(MSG_ENVIO.porDia).toBe('Você já enviou 5 exames hoje. Tente amanhã.');
    expect(MSG_REVISAO.pushNeutro).toBe('Há uma atualização para você no app.');
    expect(MSG_REVISAO.pushNeutro.toLowerCase()).not.toContain('exame');
    expect(MSG_REVISAO.noProntuario(1)).toBe('Exames enviados pelo paciente (1)');
    expect(ENVIO_TOTAL_MAX_BYTES).toBe(30 * 1024 * 1024);
  });

  it('nome do envio sem nome, "há {n} dias" e dias entre datas (fila da US-162)', () => {
    expect(nomeDoEnvio('Hemograma', '28/09/2026')).toBe('Hemograma');
    expect(nomeDoEnvio(null, '28/09/2026')).toBe('Exame enviado em 28/09/2026');
    expect(diasEntre('2026-09-28', '2026-10-07')).toBe(9);
    expect(diasEntre('2026-10-07', '2026-10-07')).toBe(0);
    expect(haDias(0)).toBe('hoje');
    expect(haDias(1)).toBe('há 1 dia');
    expect(haDias(9)).toBe('há 9 dias');
  });

  it('sem import de servidor: o formulário do portal (cliente) usa este arquivo', () => {
    const fonte = readFileSync('src/modules/pacientes/exames-enviados-constantes.ts', 'utf8');
    expect(fonte).not.toMatch(/from '@\/(db|jobs|env|lib)|from 'node:|from 'sharp'/);
  });
});
