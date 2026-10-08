import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { primeiroNome as primeiroNomeDoTexto } from '@/modules/notificacoes/mensagens';
import { escolhaWhatsapp } from '@/modules/pacientes/convite-paciente';
import { pacienteDaSessao } from './sessao';

export const MSG_PERFIL = {
  semTelefone: 'Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.',
  salvo: 'Preferência salva.',
} as const;

export class PerfilPacienteError extends Error {
  override name = 'PerfilPacienteError';
}

/** "Perfil > Notificações" (D20): o WhatsApp está autorizado (opt-in sem opt-out) e há telefone no cadastro? */
export async function situacaoDoWhatsapp(ctx: TenantContext, db: Db = getDb()): Promise<{ ativo: boolean; temTelefone: boolean }> {
  const id = pacienteDaSessao(ctx, 'situacaoDoWhatsapp');
  const [p] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ telefone: patients.telefoneE164, optin: patients.whatsappOptinEm, optout: patients.whatsappOptoutEm })
        .from(patients)
        .where(eq(patients.id, id)),
    db,
  );
  return { ativo: Boolean(p?.optin) && !p?.optout, temTelefone: Boolean(p?.telefone) };
}

/** US-011 "Revogar o WhatsApp": desmarcar = opt-out a partir de agora (o envio já respeita, INT-01); marcar = opt-in do paciente. */
export async function preferenciaWhatsapp(ctx: TenantContext, quer: boolean, o: { db?: Db; agora?: Date } = {}): Promise<void> {
  const id = pacienteDaSessao(ctx, 'preferenciaWhatsapp');
  const agora = o.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, id)).for('update');
      if (!p) throw new Error('paciente da sessão não encontrado');
      // escolhaWhatsapp sem telefone devolve {} (nada muda): a orientação vem antes
      if (quer && !p.telefoneE164) throw new PerfilPacienteError(MSG_PERFIL.semTelefone);
      // "Salvar" com o WhatsApp já autorizado não regrava a prova do consentimento (data e origem 'nutri' ficam)
      if (quer && p.whatsappOptinEm && !p.whatsappOptoutEm) return;
      const mudanca = escolhaWhatsapp(quer, p, agora);
      if (Object.keys(mudanca).length) await tx.update(patients).set({ ...mudanca, updatedAt: agora }).where(eq(patients.id, id));
    },
    o.db ?? getDb(),
  );
}

/** Plano 16 (RN-218): a saudação usa o primeiro nome (até o primeiro espaço). O recorte é o de `mensagens.ts` (um lugar só); nome em branco vira vazio. */
export const primeiroNome = (nome: string): string => (nome.trim() ? primeiroNomeDoTexto(nome) : '');
