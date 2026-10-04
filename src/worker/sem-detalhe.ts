import type { PgBoss } from 'pg-boss';
import { motivoDoErro } from '@/modules/plataforma/armazenamento';

const NOME_SEGURO = /^[A-Za-z][A-Za-z0-9]{0,59}$/;

/**
 * RNF-11 / CLAUDE.md regra 3 (achado 5 do /code-review): o erro relançado por um job vai para o `output` do job no
 * pg-boss (serialize-error: mensagem, stack e propriedades como `path` — `/data/<tenantId>/…`, e-mail do destinatário
 * num erro de SMTP, valores de uma query). Aqui ele vira um erro novo só com a fila e o código (`ENOENT`, SQLSTATE…), ou
 * o nome da classe quando não há código — o mesmo critério do log (motivoDoErro). O pg-boss continua vendo a falha (nova
 * tentativa / "failed"); o detalhe útil já foi para o log de cada job, sem dado sensível.
 */
export function erroSemDetalhe(fila: string, err: unknown): Error {
  const motivo = motivoDoErro(err);
  const nome = err instanceof Error && NOME_SEGURO.test(err.name) ? err.name : 'erro';
  const limpo = new Error(`falha no job ${fila} (${motivo !== 'erro' ? motivo : nome})`);
  limpo.stack = limpo.message; // a pilha do erro novo só apontaria para este arquivo
  return limpo;
}

/** O handler do job, com qualquer erro relançado já limpo (erroSemDetalhe). */
export function semDetalhe<A extends unknown[], R>(fila: string, fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  return async (...a) => {
    try {
      return await fn(...a);
    } catch (err) {
      throw erroSemDetalhe(fila, err);
    }
  };
}

/**
 * O `boss.work` do worker com o handler embrulhado em semDetalhe: um ponto só para todas as filas (o worker não chama
 * `boss.work` direto — guarda em sem-detalhe.test.ts). Mesmas sobrecargas do pg-boss.
 */
export function workSemDetalhe(boss: PgBoss): PgBoss['work'] {
  const work = boss.work.bind(boss) as (nome: string, ...resto: unknown[]) => Promise<string>;
  return ((nome: string, ...resto: unknown[]) => {
    const handler = resto.pop() as (...a: unknown[]) => Promise<unknown>;
    return work(nome, ...resto, semDetalhe(nome, handler));
  }) as PgBoss['work'];
}
