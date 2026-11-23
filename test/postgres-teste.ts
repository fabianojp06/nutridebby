import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Wait } from 'testcontainers';

// Runner próprio (docs/operacao/runner-proprio.md): o Docker do CI é rootless, e a porta publicada de um contêiner só
// existe do lado do host, onde o job não chega (de propósito). Com NUTRI_CI_REDE_DIRETA=1 o job, ligado à rede bridge,
// fala direto com o IP do contêiner na porta interna; a espera vira só o healthcheck (o padrão também testa a porta
// publicada). Fora do runner próprio, nada muda.
const REDE_DIRETA = process.env.NUTRI_CI_REDE_DIRETA === '1';

export function novoPostgres(): PostgreSqlContainer {
  const container = new PostgreSqlContainer('postgres:16-alpine');
  return REDE_DIRETA ? container.withWaitStrategy(Wait.forHealthCheck()) : container;
}

export function uriDoPostgres(container: StartedPostgreSqlContainer): string {
  const uri = container.getConnectionUri();
  if (!REDE_DIRETA) return uri;
  const direta = new URL(uri);
  direta.hostname = container.getIpAddress('bridge');
  direta.port = '5432';
  return direta.toString();
}

/** A mesma URL (usuário, senha, host e porta) apontando para outro banco do cluster — `postgres` para CREATE/DROP DATABASE. */
export function urlDoBanco(ownerUrl: string, nome: string): string {
  const u = new URL(ownerUrl);
  u.pathname = `/${nome}`;
  return u.toString();
}
