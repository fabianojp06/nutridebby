import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { adminActions, session, twoFactor, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import type { EmailMessage } from '@/email/types';
import { confirmarCodigo2fa, liberarCodigo2fa } from '@/lib/confirmar-2fa';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import type { AppRole } from '@/lib/session-rules';

export const MSG_2FA = {
  email: 'Informe o e-mail da conta.',
  naoEncontrada: 'Nenhuma conta com este e-mail.',
  propria: 'Não é possível reiniciar a verificação em duas etapas da sua própria conta por aqui.',
  semDoisFatores: 'Esta conta não tem a verificação em duas etapas ativa.',
  paciente: 'Contas de paciente não são reiniciadas pelo painel do administrador.',
  // os mesmos textos da assinatura do Plano 10A (MSG_RECUSA de documentos/erros.ts)
  codigo: 'Código inválido. Confira o horário do celular e tente de novo.',
  tentativas: 'Muitas tentativas. Tente de novo em 15 minutos.',
  ok: 'Verificação em duas etapas reiniciada. As sessões da conta foram encerradas e ela recebeu um e-mail. A pessoa pode ativar de novo em Conta > Segurança.',
  okAdmin: 'Verificação em duas etapas reiniciada. As sessões da conta foram encerradas e ela recebeu um e-mail. No próximo login, a configuração será obrigatória.',
} as const;

export type Codigo2fa = 'email' | 'nao_encontrada' | 'propria' | 'sem_2fa' | 'paciente' | 'codigo' | 'tentativas';
const MENSAGEM: Record<Codigo2fa, string> = {
  email: MSG_2FA.email,
  nao_encontrada: MSG_2FA.naoEncontrada,
  propria: MSG_2FA.propria,
  sem_2fa: MSG_2FA.semDoisFatores,
  paciente: MSG_2FA.paciente,
  codigo: MSG_2FA.codigo,
  tentativas: MSG_2FA.tentativas,
};

export class Reiniciar2faError extends Error {
  override name = 'Reiniciar2faError';
  constructor(readonly codigo: Codigo2fa) {
    super(MENSAGEM[codigo]);
  }
}

export type Autor = { origem: 'admin'; adminId: string } | { origem: 'cli'; adminId: null };
type Avisar = (msg: EmailMessage, tx: Tx) => Promise<unknown>;
/** tenantId nulo: o aviso de segurança sai mesmo com o consultório suspenso (o job ignora e-mail de tenant suspenso). */
const avisarPorEmail: Avisar = (msg, tx) => enqueueEmail(msg, { tx });
const emailValido = (e: string) => !!e && e.length <= 254;

/**
 * P09-02 (b) / manual técnico §6.9.1: trocar o AUTH_SECRET deixa quem tem 2FA sem entrar (o segredo do TOTP e os códigos
 * de recuperação são cifrados com ele). Numa transação: trava a conta, apaga a linha de `two_factor`, desliga
 * `two_factor_enabled`, revoga as sessões, registra em `admin_actions` e enfileira o aviso à própria conta. A tabela
 * `user` é exceção de RLS (CLAUDE.md regra 1: este arquivo está na lista).
 */
export async function reiniciarDoisFatores(
  emailInformado: string,
  autor: Autor,
  deps: { db?: Db; avisar?: Avisar } = {},
): Promise<{ userId: string; papel: AppRole; sessoesRevogadas: number }> {
  const email = emailInformado.trim();
  if (!emailValido(email)) throw new Reiniciar2faError('email');
  const db = deps.db ?? getDb();
  const avisar = deps.avisar ?? avisarPorEmail;
  const r = await db.transaction(async (tx) => {
    // `email` é citext: a busca não depende de maiúsculas
    const [alvo] = await tx
      .select({ id: user.id, email: user.email, papel: user.appRole, ativo: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.email, email))
      .for('update');
    if (!alvo) throw new Reiniciar2faError('nao_encontrada');
    if (autor.origem === 'admin' && alvo.id === autor.adminId) throw new Reiniciar2faError('propria');
    // code review do PR #22, item 1: a conta de paciente não é do admin (ele não toca dado do consultório); só o comando
    // no servidor, rodado pelo dono, reinicia o 2FA dela
    if (autor.origem === 'admin' && alvo.papel === 'paciente') throw new Reiniciar2faError('paciente');
    // item 3: configuração pela metade (linha de two_factor sem two_factor_enabled) não é 2FA ativo — o login não pede
    // código, e a própria pessoa refaz a configuração em Conta > Segurança
    if (!alvo.ativo) throw new Reiniciar2faError('sem_2fa');
    await tx.delete(twoFactor).where(eq(twoFactor.userId, alvo.id));
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, alvo.id));
    const sessoes = await tx.delete(session).where(eq(session.userId, alvo.id)).returning({ id: session.id });
    await tx.insert(adminActions).values({ adminUserId: autor.adminId, acao: 'reiniciar_2fa', alvoUserId: alvo.id, alvoPapel: alvo.papel, origem: autor.origem });
    await avisar({ tipo: 'aviso_2fa_reiniciado', para: alvo.email }, tx);
    return { userId: alvo.id, papel: alvo.papel as AppRole, sessoesRevogadas: sessoes.length };
  });
  // regra 3: só ids e o papel; nunca o e-mail
  logger.info({ adminId: autor.adminId, origem: autor.origem, alvoUserId: r.userId, papel: r.papel, sessoesRevogadas: r.sessoesRevogadas }, 'verificação em duas etapas reiniciada');
  return r;
}

export type DepsPeloAdmin = {
  db?: Db;
  avisar?: Avisar;
  confirmar2fa?: (e: { userId: string; codigo: unknown; headers: Headers }) => Promise<'ok' | 'invalido' | 'bloqueado'>;
  liberar2fa?: (e: { userId: string; codigo: unknown }) => Promise<void>;
};

/**
 * Code review do PR #22, item 1: pelo painel, desligar o 2FA de outra conta (inclusive de outro admin) exige o código
 * atual do 2FA da PRÓPRIA admin — um cookie de admin roubado não basta. Mesmo caminho da assinatura do Plano 10A
 * (confirmarCodigo2fa: 5 tentativas em 15 min, o mesmo código não vale duas vezes em 90 s, verificação do Better Auth
 * com a sessão dela). O código é conferido antes de procurar o e-mail; a recusa fica em `admin_actions`
 * (`codigo_2fa_recusado`, sem conta-alvo) e no log, só com o id da admin (regra 3: nem e-mail nem código). Se o reinício
 * não acontece depois do código certo (conta inexistente, paciente, sem 2FA), o código volta a valer (liberarCodigo2fa).
 */
export async function reiniciarPeloAdmin(
  emailInformado: string,
  pedido: { adminId: string; codigo: unknown; headers: Headers },
  deps: DepsPeloAdmin = {},
): Promise<{ userId: string; papel: AppRole; sessoesRevogadas: number }> {
  if (!emailValido(emailInformado.trim())) throw new Reiniciar2faError('email'); // não gasta tentativa do código
  const db = deps.db ?? getDb();
  const confirmar = deps.confirmar2fa ?? ((e) => confirmarCodigo2fa(e, { db }));
  const r = await confirmar({ userId: pedido.adminId, codigo: pedido.codigo, headers: pedido.headers });
  if (r === 'bloqueado') throw new Reiniciar2faError('tentativas');
  if (r === 'invalido') {
    await db.insert(adminActions).values({ adminUserId: pedido.adminId, acao: 'codigo_2fa_recusado', alvoUserId: null, alvoPapel: null, origem: 'admin' });
    logger.warn({ adminId: pedido.adminId }, 'código do 2FA recusado ao reiniciar a verificação em duas etapas de outra conta');
    throw new Reiniciar2faError('codigo');
  }
  try {
    return await reiniciarDoisFatores(emailInformado, { origem: 'admin', adminId: pedido.adminId }, { db, avisar: deps.avisar });
  } catch (e) {
    const liberar = deps.liberar2fa ?? ((x) => liberarCodigo2fa(x, { db }));
    await liberar({ userId: pedido.adminId, codigo: pedido.codigo }).catch(() => undefined);
    throw e;
  }
}

/**
 * Code review do PR #22, item 9: o que o comando no servidor imprime numa falha. Recusa conhecida: a mensagem. Erro
 * inesperado: só o nome e o SQLSTATE (um 42501 depois de migration com o role errado, regra 7) — a mensagem do banco pode
 * citar o e-mail e a consulta (regra 3).
 */
export function mensagemDaFalha(e: unknown): string {
  if (e instanceof Reiniciar2faError) return e.message;
  const sqlstate = sqlstateDoErro(e);
  return `Erro inesperado ao reiniciar a verificação em duas etapas (${nomeDoErro(e)}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`;
}
