import { sessaoDePacienteComConta, type TenantContext } from '@/db/tenant';

/**
 * RN-440 (Global Constraints do Plano 25): as funções do painel conferem a sessão `nutri` **antes** de abrir a transação —
 * numa sessão de paciente, a RLS deixaria ler parte das tabelas do chat (a própria conversa, o horário), e o worker não
 * libera, não pausa nem configura.
 */
export function exigirNutri(ctx: TenantContext): void {
  if (ctx.role !== 'nutri') throw new Error('mensagens: só a sessão nutri');
}

/** RN-440: as funções do portal exigem a sessão de paciente com conta (login no app), antes de abrir a transação. */
export function exigirPacienteComConta(ctx: TenantContext): void {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('mensagens: só a sessão de paciente com conta');
}
