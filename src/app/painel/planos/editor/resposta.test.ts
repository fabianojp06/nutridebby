import { describe, expect, it } from 'vitest';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { interpretarResposta } from './resposta';

describe('resposta do PUT do salvamento automático (US-022, D7)', () => {
  it('2xx com a revisão: salvo; 422: erros dos campos', () => {
    expect(interpretarResposta(200, { revisao: 7 })).toEqual({ tipo: 'salvo', revisao: 7 });
    expect(interpretarResposta(422, { erros: { titulo: MSG_PLANO.titulo } })).toEqual({ tipo: 'campos', erros: { titulo: MSG_PLANO.titulo } });
    expect(interpretarResposta(422, null)).toEqual({ tipo: 'campos', erros: { geral: MSG_PLANO.invalido } });
  });

  it('409: para, e só o `conflito` é "alterado em outra aba"; bloqueado e versão publicada mostram o motivo do servidor', () => {
    expect(interpretarResposta(409, { erro: MSG_PLANO.conflito, codigo: 'conflito' })).toEqual({ tipo: 'parar', mensagem: MSG_PLANO.conflito });
    expect(interpretarResposta(409, { erro: MSG_BLOQUEADO, codigo: 'bloqueado' })).toEqual({ tipo: 'parar', mensagem: MSG_BLOQUEADO });
    expect(interpretarResposta(409, { erro: MSG_PLANO.naoEditavel, codigo: 'nao_editavel' })).toEqual({ tipo: 'parar', mensagem: MSG_PLANO.naoEditavel });
    expect(interpretarResposta(409, null)).toEqual({ tipo: 'parar', mensagem: MSG_PLANO.conflito });
  });

  it('401/403, 404 e 413 param com o motivo (repetir não adianta); outro 4xx também para', () => {
    expect(interpretarResposta(401, { erro: 'Sessão expirada. Entre de novo.' })).toEqual({ tipo: 'parar', mensagem: 'Sessão expirada. Entre de novo.' });
    expect(interpretarResposta(401, null)).toEqual({ tipo: 'parar', mensagem: 'Sessão expirada. Entre de novo.' });
    expect(interpretarResposta(403, { erro: 'Acesso negado' })).toEqual({ tipo: 'parar', mensagem: 'Acesso negado' });
    expect(interpretarResposta(404, { erro: 'qualquer' })).toEqual({ tipo: 'parar', mensagem: MSG_PLANO.naoEncontrado });
    expect(interpretarResposta(413, { erro: 'Plano grande demais.' })).toEqual({ tipo: 'parar', mensagem: 'Plano grande demais.' });
    expect(interpretarResposta(413, null)).toEqual({ tipo: 'parar', mensagem: 'Plano grande demais.' });
    expect(interpretarResposta(400, null)).toEqual({ tipo: 'parar', mensagem: MSG_PLANO.invalido });
  });

  it('5xx, 2xx sem revisão (corpo perdido) e 408/429: resultado incerto, tenta de novo', () => {
    for (const s of [500, 502, 503, 504, 408, 429]) expect(interpretarResposta(s, null), String(s)).toEqual({ tipo: 'incerto' });
    expect(interpretarResposta(200, null)).toEqual({ tipo: 'incerto' });
  });
});
