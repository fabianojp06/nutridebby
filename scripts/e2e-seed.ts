import { randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, consents, patients, rateLimit, tenants, twoFactor, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getEnv } from '@/env';
import { hashPassword } from '@/lib/password.server';
import { chaveDoLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { GUIAS } from '@/modules/ajuda/conteudo';
import { IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';

export const E2E_ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_NUTRI = { email: 'nutri-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_RECUPERA = { email: 'recupera-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_MULTI = { email: 'multi-e2e@nutridebby.test', password: 'Multi2026segura' };
export const E2E_MANUAL = { email: 'manual-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_ADMIN_PLATAFORMA = { email: 'admin-plataforma-e2e@nutridebby.test', password: 'Nutri2026segura' };
/**
 * Plano 10A (T16): assinar exige 2FA (RN-145). Conta só do fluxo de documentos, no mesmo consultório, com o 2FA já ativo:
 * ativá-lo na `E2E_NUTRI` compartilhada mandaria todo login dela para o desafio e quebraria as outras specs. `totp` é o
 * segredo como o Better Auth guarda (texto puro, a chave do HMAC em UTF-8; a URI do app leva o base32 dele): fixo e
 * fictício, só do E2E. As specs copiam a credencial (importar este arquivo roda o seed).
 */
export const E2E_DOCS = { email: 'docs-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };

const db = getDb();

// Consultório das nutricionistas do E2E, já com o DPA aceito (US-002) e a página pública /n/e2e-consultorio ligada (Plano 05)
const AGENDA_PUBLICA = { linkOnlinePadrao: 'https://meet.example.test/e2e', enderecoConsultorio: 'Rua E2E, 100', agendamentoPublicoAtivo: true };
// Plano 10A: documentos assinados liberados pelo admin (D20) e o perfil profissional completo (carimbo da receita)
const DOCUMENTOS = { documentosLiberados: true, crn: 'CRN-3 12345', nomeProfissional: 'Nutri E2E da Silva', contatoEmail: 'contato-e2e@nutridebby.test', contatoTelefoneE164: '+5511912345678' };
// Plano 11: a IA liberada pela admin e ativada com o aditivo no consultório do E2E (o CI roda com IA_PROVEDOR=sandbox).
// Plano 14A: o aditivo atual (IA_ADITIVO_VERSAO, 1.0 desde a A-D27) e o perfil de DOCUMENTOS, que o texto da autorização cita.
const IA = { iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO, iaCotaMensalUsd: 15 };
// Plano 12 (D18 = a): o recebimento de exames pelo app ligado no consultório do E2E (o axe passa por /p/exames com o formulário)
const EXAMES_APP = { examesPacienteAtivadoEm: new Date(), examesAvisoEm: null };
const [consultorio] = await db
  .insert(tenants)
  .values({ slug: 'e2e-consultorio', nomeExibicao: 'Consultório E2E', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), ...AGENDA_PUBLICA, ...DOCUMENTOS, ...IA, ...EXAMES_APP })
  .onConflictDoUpdate({
    target: tenants.slug,
    set: { status: 'ativa', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), corPrimaria: null, logoPath: null, armazenamentoBytes: 0, ...AGENDA_PUBLICA, ...DOCUMENTOS, ...IA, ...EXAMES_APP },
  })
  .returning({ id: tenants.id });

// Plano 05: o consultório do E2E começa com a agenda vazia a cada execução (filhas antes das mães)
const AGENDA_E2E = ['whatsapp_conexoes', 'public_booking_requests', 'notifications', 'appointments', 'availability_blocks', 'availability_rules'];
await withTenant({ tenantId: consultorio.id, role: 'worker' }, async (tx) => {
  // Tarefa 15: atendimentos iniciados pela agenda apontam para a consulta (FK NO ACTION): soltar antes de apagar
  await tx.execute(sql`update consultations set appointment_id = null where appointment_id is not null`);
  for (const t of AGENDA_E2E) await tx.execute(sql`delete from ${sql.identifier(t)}`);
  // Os pacientes ativos das execuções anteriores vão para "arquivado": a lista de pacientes da nova consulta tem teto
  // (LIMITE_LISTA, por nome) e, no banco de dev reaproveitado, o paciente criado agora ficava fora dela (portal.spec, agenda)
  await tx.execute(sql`update patients set status = 'arquivado', updated_at = now() where status = 'ativo'`);
  // Plano 12 (R-D5): o feed de diários lista primeiro os não vistos e corta em 50 (feedDeDiarios); no banco de dev
  // reaproveitado, os registros das execuções anteriores empurravam o recém-comentado ("Visto") para fora da lista
  // (portal.spec, US-043). Os antigos entram como vistos; o limite do feed não muda.
  await tx.execute(sql`update diary_entries set visto_pela_nutri_em = now() where visto_pela_nutri_em is null`);
}, db);
// RN-16: o visitante da página pública no E2E (agenda.spec, 10.9.8.50) começa cada execução com o limite por IP zerado
await liberarLimite(db, chaveDoLimite('ip', '10.9.8.50'));
// P09-04: o seed zera os limites de login do Better Auth dos IPs do E2E (chave "<ip>|<caminho>", só a faixa 10.9.x.x):
// rodar o E2E várias vezes seguidas não esbarra nas 5 tentativas por 15 min
await db.delete(rateLimit).where(like(rateLimit.key, '10.9.%'));

await db.delete(user).where(eq(user.email, E2E_ADMIN.email));
const adminId = randomUUID();
await db.insert(user).values({ id: adminId, name: 'Admin E2E', email: E2E_ADMIN.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword(E2E_ADMIN.password) });

await db.delete(user).where(eq(user.email, E2E_NUTRI.email));
const nutriId = randomUUID();
await db.insert(user).values({ id: nutriId, name: 'Nutri E2E', email: E2E_NUTRI.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id });
await db.insert(account).values({ id: randomUUID(), userId: nutriId, accountId: nutriId, providerId: 'credential', password: await hashPassword(E2E_NUTRI.password) });

await db.delete(user).where(eq(user.email, E2E_RECUPERA.email));
const recuperaId = randomUUID();
await db.insert(user).values({ id: recuperaId, name: 'Recupera E2E', email: E2E_RECUPERA.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id });
await db.insert(account).values({ id: randomUUID(), userId: recuperaId, accountId: recuperaId, providerId: 'credential', password: await hashPassword(E2E_RECUPERA.password) });

await db.delete(user).where(eq(user.email, E2E_DOCS.email));
const docsId = randomUUID();
await db.insert(user).values({ id: docsId, name: 'Docs E2E', email: E2E_DOCS.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id, twoFactorEnabled: true });
await db.insert(account).values({ id: randomUUID(), userId: docsId, accountId: docsId, providerId: 'credential', password: await hashPassword(E2E_DOCS.password) });
// como o enableTwoFactor do Better Auth 1.7.6 grava (plugins/two-factor/index.mjs): symmetricEncrypt com o `secretConfig`,
// que é a própria AUTH_SECRET (sem BETTER_AUTH_SECRETS, a rotação de segredos, em auth.ts e no .env)
const chave = getEnv().AUTH_SECRET;
await db.insert(twoFactor).values({
  id: randomUUID(),
  userId: docsId,
  verified: true,
  secret: await symmetricEncrypt({ key: chave, data: E2E_DOCS.totp }),
  backupCodes: await symmetricEncrypt({ key: chave, data: JSON.stringify([]) }),
});
// RN-156: as consultas da verificação pública do E2E (documentos.spec e acessibilidade.spec, 10.9.14.77 a .80; parecer.spec, 10.9.17.48)
// começam zeradas
for (const ip of ['10.9.14.77', '10.9.14.78', '10.9.14.79', '10.9.14.80', '10.9.17.48']) await liberarLimite(db, chaveDoLimite('verificacao-ip', ip));

// P08-10 (D27): as contas do E2E não esbarram no tour nem no aviso "Primeira vez aqui?"; a conta do manual.spec começa zerada
const TUDO_VISTO = Object.fromEntries(GUIAS.map((g) => [g.id, { v: g.versao, estado: 'concluido' as const }]));
await db.update(user).set({ guia: TUDO_VISTO, tema: 'sistema' }).where(inArray(user.email, [E2E_NUTRI.email, E2E_RECUPERA.email, E2E_DOCS.email]));
await db.delete(user).where(eq(user.email, E2E_MANUAL.email));
const manualId = randomUUID();
await db.insert(user).values({ id: manualId, name: 'Manual E2E', email: E2E_MANUAL.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id });
await db.insert(account).values({ id: randomUUID(), userId: manualId, accountId: manualId, providerId: 'credential', password: await hashPassword(E2E_MANUAL.password) });

await db.delete(user).where(eq(user.email, E2E_ADMIN_PLATAFORMA.email));
const admin2Id = randomUUID();
await db.insert(user).values({ id: admin2Id, name: 'Admin Plataforma E2E', email: E2E_ADMIN_PLATAFORMA.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: admin2Id, accountId: admin2Id, providerId: 'credential', password: await hashPassword(E2E_ADMIN_PLATAFORMA.password) });

// Plano 06 (T13, R12): conta de paciente com três vínculos — o consultório do E2E e o "2" (termo aceito) e o "3" (sem o
// aceite do termo, que o E2E nunca aceita) —, para o acessibilidade.spec cobrir /p/escolher, /p/termo e a troca de
// nutricionista. `consents` é append-only (0009): a conta não é apagada (o aceite impede), só ganha a senha de novo.
const outros = [];
for (const [slug, nomeExibicao] of [['e2e-consultorio-2', 'Consultório E2E 2'], ['e2e-consultorio-3', 'Consultório E2E 3']]) {
  const [t] = await db
    .insert(tenants)
    .values({ slug, nomeExibicao, crn: 'CRN-3 54321', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() })
    .onConflictDoUpdate({ target: tenants.slug, set: { status: 'ativa', nomeExibicao } })
    .returning({ id: tenants.id });
  outros.push(t.id);
}
const senhaMulti = await hashPassword(E2E_MULTI.password);
const [existente] = await db.select({ id: user.id }).from(user).where(eq(user.email, E2E_MULTI.email));
const multiId = existente?.id ?? randomUUID();
if (existente) {
  await db.update(account).set({ password: senhaMulti }).where(eq(account.userId, multiId));
} else {
  await db.insert(user).values({ id: multiId, name: 'Multi E2E', email: E2E_MULTI.email, emailVerified: true, appRole: 'paciente' });
  await db.insert(account).values({ id: randomUUID(), userId: multiId, accountId: multiId, providerId: 'credential', password: senhaMulti });
}
for (const tenantId of [consultorio.id, ...outros]) {
  await withTenant({ tenantId, role: 'worker' }, async (tx) => {
    await tx
      .insert(patients)
      .values({ tenantId, userId: multiId, nome: 'Multi E2E', dataNascimento: '1990-01-01', sexo: 'F', email: E2E_MULTI.email })
      .onConflictDoUpdate({ target: [patients.tenantId, patients.email], set: { userId: multiId, status: 'ativo', updatedAt: new Date() } });
  }, db);
}
for (const tenantId of [consultorio.id, outros[0]]) {
  await db.insert(consents).values({ userId: multiId, tenantId, termoVersao: TERMO_PACIENTE, ip: null }).onConflictDoNothing();
}

await closeDb();
console.log('Seed E2E pronto.');
