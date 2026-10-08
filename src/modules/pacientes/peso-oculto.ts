import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { recordAudit } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita } from './base';

/**
 * Plano 16 (G-D1, RN-203 a RN-206): "Não mostrar peso no app", por paciente, ligada só pela equipe. É APRESENTAÇÃO, não
 * restrição de acesso (spec §10): o prontuário, os documentos, os textos livres da nutricionista e as exportações não mudam
 * (RN-204). O portal filtra no servidor, antes de montar a resposta (CS-194). Textos em rascunho até a Debby (G-D10 ★).
 */
export const MSG_PESO_OCULTO = {
  titulo: 'Peso no app do paciente',
  rotulo: 'Não mostrar peso no app',
  ajuda:
    'O paciente não vê esta opção. O peso e o IMC deixam de aparecer no app. Continuam no prontuário, nos documentos que você assina, no que você escreve (orientações e comentários aparecem como estão) e na cópia dos dados que o paciente pedir (LGPD).',
  desde: (data: string) => `Peso oculto no app desde ${data}`,
  salvar: 'Salvar',
} as const;

/** G-D6 ★ = a: o que a opção esconde (o IMC revela o peso). Com (b), acrescentar 'perc_gordura'. */
export const SERIES_DO_PESO = ['peso', 'imc'] as const;

export function semPeso<T extends { id: string }>(series: readonly T[]): T[] {
  return series.filter((s) => !(SERIES_DO_PESO as readonly string[]).includes(s.id));
}

/**
 * Liga ou desliga a opção (aba Evolução do prontuário). Bloqueado ou anonimizado: só leitura (carregarPacienteParaEscrita).
 * Ligar de novo mantém a data da primeira vez (nenhuma linha nova na trilha). Trilha (spec §10, NGS1.07): o gatilho de
 * patients grava "alterar" sem dizer a coluna, e a coluna volta a nulo ao desligar — por isso a decisão ganha linha própria
 * (entidade `peso_no_app`, `criar` = ligou, `excluir` = desligou; molde de `tentativa_assinatura`), na mesma transação.
 */
export async function definirPesoOculto(ctx: TenantContext, patientId: string, ocultar: boolean, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (ctx.role !== 'nutri') throw new Error('"Não mostrar peso no app" só pela equipe');
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (Boolean(p.pesoOcultoNoAppEm) === ocultar) return;
      await tx.update(patients).set({ pesoOcultoNoAppEm: ocultar ? agora : null, updatedAt: agora }).where(eq(patients.id, p.id));
      await recordAudit(tx, { acao: ocultar ? 'criar' : 'excluir', entidade: 'peso_no_app', entidadeId: p.id, patientId: p.id });
    },
    deps.db ?? getDb(),
  );
}

/** Na transação do portal (RLS do paciente): a opção do próprio prontuário. */
export async function pesoOcultoNaTransacao(tx: Tx, patientId: string): Promise<boolean> {
  const [p] = await tx.select({ em: patients.pesoOcultoNoAppEm }).from(patients).where(eq(patients.id, patientId));
  return Boolean(p?.em);
}
