import { describe, expect, it } from 'vitest';
import { COOKIE_SESSAO_TESTE, prazosDaRequisicao } from './sessao-prazos';
import { PRAZOS_DA_EQUIPE, prazosDeTeste } from './session-rules';

const com = (cookie?: string) => new Headers(cookie ? { cookie } : {});

describe('prazosDaRequisicao (P12-14: SESSAO_TESTE_MS só para quem traz o cookie do teste)', () => {
  it('sem a variável: sempre os prazos de produção, mesmo com o cookie', () => {
    expect(prazosDaRequisicao(com(`${COOKIE_SESSAO_TESTE}=1`), undefined)).toBe(PRAZOS_DA_EQUIPE);
  });
  it('com a variável: só o contexto com nd_sessao_teste=1 encurta; as outras sessões (outras specs) seguem com 30 min', () => {
    expect(prazosDaRequisicao(com(`a=b; ${COOKIE_SESSAO_TESTE}=1`), 30_000)).toEqual(prazosDeTeste(30_000));
    expect(prazosDaRequisicao(com(), 30_000)).toBe(PRAZOS_DA_EQUIPE);
    expect(prazosDaRequisicao(com(`${COOKIE_SESSAO_TESTE}=0`), 30_000)).toBe(PRAZOS_DA_EQUIPE);
  });
});
