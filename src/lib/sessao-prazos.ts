import { getEnv } from '@/env';
import { lerCookie } from './ler-cookie';
import { PRAZOS_DA_EQUIPE, prazosDeTeste, type PrazosDaEquipe } from './session-rules';

/** P12-14: o E2E do aviso de inatividade grava este cookie no próprio contexto do navegador para usar os prazos curtos. */
export const COOKIE_SESSAO_TESTE = 'nd_sessao_teste';

/**
 * Os prazos da sessão da equipe para esta requisição: os de produção, salvo com SESSAO_TESTE_MS (só teste; o app não
 * sobe com ela em produção, src/env.ts) **e** o cookie `nd_sessao_teste=1` — assim só o teste do aviso encurta a
 * própria sessão, e as outras specs do E2E (o mesmo servidor) seguem com os 30 min.
 */
export function prazosDaRequisicao(cabecalhos: Headers, sessaoTesteMs: number | undefined = getEnv().SESSAO_TESTE_MS): PrazosDaEquipe {
  if (!sessaoTesteMs || lerCookie(cabecalhos.get('cookie'), COOKIE_SESSAO_TESTE) !== '1') return PRAZOS_DA_EQUIPE;
  return prazosDeTeste(sessaoTesteMs);
}
