import { randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { and, eq, inArray, isNotNull, isNull, like, notInArray, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import {
  account,
  anthropometry,
  consents,
  examesCatalogo,
  equipeMembros,
  finCategorias,
  finConfiguracoes,
  iaNutriConsentimentos,
  iaNutriMensagens,
  iaNutriParticipacoes,
  lembretesRotina,
  locaisAtendimento,
  mealPlans,
  patientCadastro,
  patients,
  rateLimit,
  tenants,
  twoFactor,
  user,
  exams,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { stopBoss } from '@/jobs/boss';
import { hashPassword } from '@/lib/password.server';
// Plano 26 (T7): o convite da recepção do primeiro acesso, criado pelo módulo da Equipe
import { convidarRecepcao } from '@/modules/plataforma/equipe';
import { SIGILO_EQUIPE_TERMO } from '@/modules/plataforma/textos-versionados';
import { chaveDoLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { idTaco } from '@/modules/alimentos/taco';
import { GUIAS } from '@/modules/ajuda/conteudo';
import { CATEGORIAS_INICIAIS } from '@/modules/financeiro/constantes';
import { configIA } from '@/modules/ia/modo';
import { LIMITE_DIA, RETENCAO_DIAS } from '@/modules/ia/nutri-paciente/constantes';
import { consentimentoVigente, ultimoEvento } from '@/modules/ia/nutri-paciente/estado';
import { IA_ADITIVO_VERSAO, IA_NUTRI_TERMO_VERSAO } from '@/modules/ia/textos-legais';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { cpfValido } from '@/modules/pacientes/cpf';
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
/**
 * Plano 15 (T13): as duas pacientes da IA Nutri do paciente (ia-nutri-paciente.spec e o preparo do axe do painel,
 * e2e/painel.ts `IA_NUTRI_2`). O nome da segunda não contém o da primeira (a linha da fila é achada pelo nome). As specs
 * copiam a credencial (importar este arquivo roda o seed).
 */
export const E2E_IA_NUTRI_1 = { email: 'ia-nutri-1-e2e@nutridebby.test', password: 'Nutri2026segura', nome: 'Paciente IA Nutri Um' };
export const E2E_IA_NUTRI_2 = { email: 'ia-nutri-2-e2e@nutridebby.test', password: 'Nutri2026segura', nome: 'Paciente IA Nutri Dois' };
/**
 * Plano 20 (spec §9.5, revisão do plano §18): o primeiro acesso do Financeiro repetível no banco de dev reaproveitado. A linha
 * de fin_configuracoes não se apaga (DELETE/TRUNCATE revogados), então cada execução cria dois consultórios NOVOS, sem
 * Financeiro, e aponta para eles estas contas: `E2E_FIN_NOVO` (o financeiro.spec configura) e `E2E_FIN_AXE` (o axe do estado
 * "não configurado", que nunca configura). Os consultórios das execuções anteriores ficam no banco (sem conta).
 */
export const E2E_FIN_NOVO = { email: 'fin-novo-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_FIN_AXE = { email: 'fin-axe-e2e@nutridebby.test', password: 'Nutri2026segura' };
/**
 * Plano 18 (T12a): as duas pacientes do cadastro complementar (cadastro.spec e o axe do Início, do Perfil e do "No app" no
 * acessibilidade-painel.spec). A COMPLETA tem conta (o "No app" só conta com o acesso ativo), o cadastro inteiro com nome
 * social, o CPF fixo (o "CPF repetido" do cadastro.spec; válido pelo dígito verificador, fictício) e uma avaliação (o selo
 * "No app" do Início). A INCOMPLETA, sem conta, tem o cadastro sem estado civil e sem endereço (a nota "Cadastro incompleto:
 * faltam estado civil e endereço."). Os nomes não contêm o de outra paciente do seed. As specs copiam os dados (importar
 * este arquivo roda o seed).
 */
export const E2E_CADASTRO_COMPLETO = {
  email: 'cadastro-completo-e2e@nutridebby.test',
  password: 'Nutri2026segura',
  nome: 'João Cadastro Semente',
  nomeSocial: 'Joana Cadastro Semente',
  cpf: '18018018006',
};
export const E2E_CADASTRO_INCOMPLETO = { email: 'cadastro-incompleto-e2e@nutridebby.test', nome: 'Iris Cadastro Incompleto' };

const db = getDb();

// Consultório das nutricionistas do E2E, já com o DPA aceito (US-002) e a página pública /n/e2e-consultorio ligada (Plano 05)
const AGENDA_PUBLICA = { linkOnlinePadrao: 'https://meet.example.test/e2e', enderecoConsultorio: 'Rua E2E, 100', agendamentoPublicoAtivo: true };
// Plano 10A: documentos assinados liberados pelo admin (D20) e o perfil profissional completo (carimbo da receita)
const DOCUMENTOS = { documentosLiberados: true, crn: 'CRN-3 12345', nomeProfissional: 'Nutri E2E da Silva', contatoEmail: 'contato-e2e@nutridebby.test', contatoTelefoneE164: '+5511912345678' };
// Plano 11: a IA liberada pela admin e ativada com o aditivo no consultório do E2E (o CI roda com IA_PROVEDOR=sandbox).
// Plano 14A: o aditivo atual (IA_ADITIVO_VERSAO, 1.2 desde o Plano 15) e o perfil de DOCUMENTOS, que o texto da autorização cita.
// Plano 15 (T13): a IA Nutri do paciente ativada pela nutricionista (★ DO-1 = não: a linha de ia_nutri_pausa nasce não
// pausada e o seed não a toca). O consentimento cita a responsável (DOCUMENTOS: nome, CRN e contato).
const IA = { iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO, iaCotaMensalUsd: 15, iaNutriAtivadaEm: new Date() };
// Plano 12 (D18 = a): o recebimento de exames pelo app ligado no consultório do E2E (o axe passa por /p/exames com o formulário)
const EXAMES_APP = { examesPacienteAtivadoEm: new Date(), examesAvisoEm: null };
// Plano 23 (RN-420): a confirmação dos pedidos começa desligada a cada execução (a spec das solicitações liga e desliga)
const PEDIDOS = { agendaConfirmarPedidos: false };
const [consultorio] = await db
  .insert(tenants)
  .values({ slug: 'e2e-consultorio', nomeExibicao: 'Consultório E2E', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), ...AGENDA_PUBLICA, ...DOCUMENTOS, ...IA, ...EXAMES_APP, ...PEDIDOS })
  .onConflictDoUpdate({
    target: tenants.slug,
    set: { status: 'ativa', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), corPrimaria: null, logoPath: null, armazenamentoBytes: 0, ...AGENDA_PUBLICA, ...DOCUMENTOS, ...IA, ...EXAMES_APP, ...PEDIDOS },
  })
  .returning({ id: tenants.id });

// Plano 05: o consultório do E2E começa com a agenda vazia a cada execução (filhas antes das mães)
const AGENDA_E2E = ['whatsapp_conexoes', 'public_booking_requests', 'notifications', 'appointments', 'availability_blocks', 'availability_rules'];
await withTenant({ tenantId: consultorio.id, role: 'worker' }, async (tx) => {
  // Tarefa 15: atendimentos iniciados pela agenda apontam para a consulta (FK NO ACTION): soltar antes de apagar
  await tx.execute(sql`update consultations set appointment_id = null where appointment_id is not null`);
  // Plano 20 (spec §9.5): a cobrança aponta para a consulta (FK NO ACTION), fin_lancamentos não se apaga (DELETE revogado) e o
  // appointment_id é fixo. A consulta com lançamento fica, cancelada pelo sistema (o EXCLUDE ignora as canceladas e libera o
  // horário) e sem `remarcada_de` (a consulta de origem é apagada abaixo); as outras saem. Os lançamentos antigos ficam: o E2E
  // do Financeiro confere só os valores do paciente que ele cria.
  const comLancamento = sql`exists (select 1 from fin_lancamentos f where f.tenant_id = appointments.tenant_id and f.appointment_id = appointments.id)`;
  for (const t of AGENDA_E2E) {
    if (t !== 'appointments') {
      await tx.execute(sql`delete from ${sql.identifier(t)}`);
      continue;
    }
    await tx.execute(sql`update appointments set remarcada_de = null where remarcada_de is not null and ${comLancamento}`);
    await tx.execute(
      sql`update appointments set status = 'cancelada', cancelado_por = 'sistema', cancelada_em = now(), updated_at = now() where status <> 'cancelada' and ${comLancamento}`,
    );
    await tx.execute(sql`delete from appointments where not ${comLancamento}`);
  }
  // Os pacientes ativos das execuções anteriores vão para "arquivado": a lista de pacientes da nova consulta tem teto
  // (LIMITE_LISTA, por nome) e, no banco de dev reaproveitado, o paciente criado agora ficava fora dela (portal.spec, agenda)
  await tx.execute(sql`update patients set status = 'arquivado', updated_at = now() where status = 'ativo'`);
  // Plano 12 (R-D5): o feed de diários lista primeiro os não vistos e corta em 50 (feedDeDiarios); no banco de dev
  // reaproveitado, os registros das execuções anteriores empurravam o recém-comentado ("Visto") para fora da lista
  // (portal.spec, US-043). Os antigos entram como vistos; o limite do feed não muda.
  await tx.execute(sql`update diary_entries set visto_pela_nutri_em = now() where visto_pela_nutri_em is null`);
}, db);
// Plano 23 (AG-D59): os três locais do consultório do E2E, achados pelo nome e reaproveitados — nunca apagados: as consultas com
// lançamento (Plano 20) ficam no banco e prendem o local pela FK NO ACTION. A cada execução voltam ao estado de partida (ativos,
// o "Consultório E2E" como principal, todos aceitando agendamento pelo paciente) e os locais que as specs criaram são
// arquivados. A agenda começa vazia (acima), sem consulta da semente: as specs do Plano 23 marcam nos próprios horários.
const LOCAIS_E2E = [
  { nome: 'Consultório E2E', tipo: 'presencial', endereco: AGENDA_PUBLICA.enderecoConsultorio, cidade: 'São Paulo', mostrarEndereco: true, linkSala: null, principal: true },
  { nome: 'Clínica Centro E2E', tipo: 'presencial', endereco: 'Avenida Central E2E, 500', cidade: 'Campinas', mostrarEndereco: true, linkSala: null, principal: false },
  { nome: 'Videoconferência E2E', tipo: 'online', endereco: null, cidade: null, mostrarEndereco: false, linkSala: AGENDA_PUBLICA.linkOnlinePadrao, principal: false },
];
await withTenant({ tenantId: consultorio.id, role: 'worker' }, async (tx) => {
  const agora = new Date();
  const nomes = LOCAIS_E2E.map((l) => l.nome);
  await tx
    .update(locaisAtendimento)
    .set({ principal: false, agendamentoOnline: false, arquivadoEm: agora, updatedAt: agora })
    .where(and(isNull(locaisAtendimento.arquivadoEm), notInArray(locaisAtendimento.nome, nomes)));
  await tx.update(locaisAtendimento).set({ principal: false, updatedAt: agora }).where(eq(locaisAtendimento.principal, true));
  for (const { tipo, ...l } of LOCAIS_E2E) {
    const [existente] = await tx
      .select({ id: locaisAtendimento.id })
      .from(locaisAtendimento)
      .where(eq(locaisAtendimento.nome, l.nome))
      .orderBy(sql`${locaisAtendimento.arquivadoEm} is null desc`, locaisAtendimento.createdAt)
      .limit(1);
    const estado = { ...l, agendamentoOnline: true, arquivadoEm: null, updatedAt: agora };
    if (existente) await tx.update(locaisAtendimento).set(estado).where(eq(locaisAtendimento.id, existente.id));
    else await tx.insert(locaisAtendimento).values({ tenantId: consultorio.id, tipo, ...estado });
  }
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

// Plano 20: o consultório do E2E sai com o Financeiro configurado — saldo de R$ 1.000,00 no dia 1º do mês corrente (no fuso do
// consultório), consulta a R$ 250,00 e as categorias iniciais da RN-302 (CATEGORIAS_INICIAIS, a mesma lista do módulo). Tudo com
// ON CONFLICT DO NOTHING: a linha de configuração e as categorias das execuções anteriores ficam como estão.
await withTenant({ tenantId: consultorio.id, role: 'worker' }, async (tx) => {
  await tx
    .insert(finConfiguracoes)
    .values({
      tenantId: consultorio.id,
      saldoInicialCentavos: 100_000,
      saldoInicialEm: sql`date_trunc('month', now() at time zone (select fuso from tenants where id = ${consultorio.id}))::date`,
      valorConsultaCentavos: 25_000,
    })
    .onConflictDoNothing();
  await tx
    .insert(finCategorias)
    .values(CATEGORIAS_INICIAIS.map((c) => ({ tenantId: consultorio.id, ...c })))
    .onConflictDoNothing();
}, db);

// Plano 22 (T5b, CS-371): o catálogo de exames do consultório do E2E — o painel "Hemograma completo" com 20 componentes
// (cada um também no catálogo, com a unidade: "Adicionar do catálogo" monta as 20 linhas com nome e unidade) e "Ferritina"
// com uma faixa do consultório. Repetível: o nome é único no consultório (ON CONFLICT DO NOTHING)
const COMPONENTES_DO_HEMOGRAMA: [string, string][] = [
  ['Hemácias', 'milhões/µL'],
  ['Hemoglobina', 'g/dL'],
  ['Hematócrito', '%'],
  ['VCM', 'fL'],
  ['HCM', 'pg'],
  ['CHCM', 'g/dL'],
  ['RDW', '%'],
  ['Leucócitos', '/µL'],
  ['Promielócitos', '/µL'],
  ['Mielócitos', '/µL'],
  ['Metamielócitos', '/µL'],
  ['Bastonetes', '/µL'],
  ['Segmentados', '/µL'],
  ['Neutrófilos', '/µL'],
  ['Eosinófilos', '/µL'],
  ['Basófilos', '/µL'],
  ['Linfócitos', '/µL'],
  ['Monócitos', '/µL'],
  ['Plaquetas', '/µL'],
  ['VPM', 'fL'],
];
await withTenant({ tenantId: consultorio.id, role: 'worker' }, async (tx) => {
  await tx
    .insert(examesCatalogo)
    .values([
      { tenantId: consultorio.id, nome: 'Hemograma completo', unidade: null, componentes: COMPONENTES_DO_HEMOGRAMA.map(([nome]) => nome) },
      ...COMPONENTES_DO_HEMOGRAMA.map(([nome, unidade]) => ({ tenantId: consultorio.id, nome, unidade })),
      {
        tenantId: consultorio.id,
        nome: 'Ferritina',
        unidade: 'ng/mL',
        sinonimos: ['Ferritina sérica'],
        faixas: [{ sexo: null, idadeMin: 18, idadeMax: null, aPartirDe: null, abaixoDe: 15, categoria: 'Baixo', fonte: 'Laboratório do E2E, 2026', atualizadaEm: '2026-11-01' }],
      },
    ])
    .onConflictDoNothing();
}, db);

// Plano 20: os dois consultórios do primeiro acesso desta execução (sem linha em fin_configuracoes) e as contas que apontam
// para eles, recriadas como a E2E_NUTRI
const sufixo = Date.now();
for (const [cred, slug, nome] of [
  [E2E_FIN_NOVO, `e2e-fin-novo-${sufixo}`, 'Fin Novo E2E'],
  [E2E_FIN_AXE, `e2e-fin-axe-${sufixo}`, 'Fin Axe E2E'],
] as const) {
  const [t] = await db.insert(tenants).values({ slug, nomeExibicao: `Consultório ${nome}`, dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() }).returning({ id: tenants.id });
  await db.delete(user).where(eq(user.email, cred.email));
  const id = randomUUID();
  await db.insert(user).values({ id, name: nome, email: cred.email, emailVerified: true, appRole: 'nutri', tenantId: t.id, guia: TUDO_VISTO, tema: 'sistema' });
  await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(cred.password) });
}

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

// Plano 15 (T13): as duas pacientes da IA Nutri, com conta e o termo do app aceito (`consents` é só de inclusão: as contas
// ficam, como a MULTI), liberadas e com o plano "Lanche da tarde (16:00): Banana prata" e a substituição "Maçã" (publicado
// uma vez pelos serviços de verdade; o banco do E2E persiste). A cada execução o estado delas volta ao começo: (a) a
// conversa apagada (o worker só apaga com o marcador da revogação, local à transação — gatilho ia_nutri_mensagens_sem_apagar),
// (b) a liberação de volta (sem `bloqueada_em`: a variante do passo 6 bloqueia a primeira), (c) a primeira SEM consentimento
// (revogação com o marcador, se o último evento for o aceite — ia_nutri_consentimentos é só de inclusão), (d) a segunda COM
// o consentimento (o aceite só pela sessão dela; o gatilho recusa os outros papéis) e (e) as 10 perguntas de hoje da
// segunda (o limite do dia, passo 6b). O preparo do axe do painel e o passo 6b somam 2 dúvidas diretas abertas: abaixo de 3.
const destinoIa = configIA(getEnv()).destino ?? 'teste'; // o E2E roda com IA_PROVEDOR=sandbox (destino `teste`)
const ctxNutri: TenantContext = { tenantId: consultorio.id, role: 'nutri', actorUserId: nutriId };
const iaNutri: { userId: string; patientId: string }[] = [];
for (const cred of [E2E_IA_NUTRI_1, E2E_IA_NUTRI_2]) {
  const senha = await hashPassword(cred.password);
  const [ja] = await db.select({ id: user.id }).from(user).where(eq(user.email, cred.email));
  const userId = ja?.id ?? randomUUID();
  if (ja) {
    await db.update(account).set({ password: senha }).where(eq(account.userId, userId));
  } else {
    await db.insert(user).values({ id: userId, name: cred.nome, email: cred.email, emailVerified: true, appRole: 'paciente' });
    await db.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: senha });
  }
  await db.insert(consents).values({ userId, tenantId: consultorio.id, termoVersao: TERMO_PACIENTE, ip: null }).onConflictDoNothing();
  const [p] = await withTenant(
    { tenantId: consultorio.id, role: 'worker' },
    (tx) =>
      tx
        .insert(patients)
        .values({ tenantId: consultorio.id, userId, nome: cred.nome, dataNascimento: '1990-01-01', sexo: 'F', email: cred.email })
        .onConflictDoUpdate({ target: [patients.tenantId, patients.email], set: { userId, nome: cred.nome, status: 'ativo', updatedAt: new Date() } })
        .returning({ id: patients.id }),
    db,
  );
  iaNutri.push({ userId, patientId: p.id });
  const [publicado] = await withTenant(
    { tenantId: consultorio.id, role: 'worker' },
    (tx) => tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'publicado'))),
    db,
  );
  if (!publicado) {
    const { id: planId } = await criarRascunho(ctxNutri, p.id, { db });
    const [r] = await withTenant(ctxNutri, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, planId)), db);
    const [banana, maca] = [randomUUID(), randomUUID()];
    const lanche = {
      id: randomUUID(), nome: 'Lanche da tarde', horario: '16:00', observacao: '',
      itens: [
        { id: banana, foodId: idTaco(182), quantidadeG: '86', medida: null, substituiItemId: null }, // Banana, prata, crua
        { id: maca, foodId: idTaco(222), quantidadeG: '130', medida: null, substituiItemId: banana }, // Maçã, Fuji, com casca, crua
      ],
    };
    await salvarRascunho(ctxNutri, planId, { revisao: r.revisao, envio: randomUUID(), titulo: 'Plano da IA Nutri', metaKcal: '', mostrarCalorias: false, orientacoes: '', refeicoes: [lanche] }, { db });
    await publicarPlano(ctxNutri, p.id, planId, { db });
  }
}
const [um, dois] = iaNutri;
await withTenant(
  { tenantId: consultorio.id, role: 'worker' },
  async (tx) => {
    await tx.execute(sql`select set_config('app.ia_nutri_revogando', '1', true)`);
    await tx.delete(iaNutriMensagens).where(inArray(iaNutriMensagens.patientId, [um.patientId, dois.patientId])); // (a)
    for (const { patientId } of iaNutri) {
      await tx
        .insert(iaNutriParticipacoes)
        .values({ tenantId: consultorio.id, patientId, liberadaEm: new Date(), liberadaPor: nutriId })
        .onConflictDoUpdate({ target: [iaNutriParticipacoes.tenantId, iaNutriParticipacoes.patientId], set: { liberadaEm: new Date(), liberadaPor: nutriId, bloqueadaEm: null, updatedAt: new Date() } }); // (b)
    }
    if ((await ultimoEvento(tx, um.patientId))?.evento === 'aceite') {
      await tx.insert(iaNutriConsentimentos).values({ tenantId: consultorio.id, patientId: um.patientId, evento: 'revogacao', canal: 'app', registradoPor: um.userId }); // (c)
    }
    const agora = new Date();
    await tx.insert(iaNutriMensagens).values(
      Array.from({ length: LIMITE_DIA }, (_, k) => ({
        tenantId: consultorio.id, patientId: dois.patientId, sessaoInicio: agora, autor: 'paciente', texto: `Pergunta de teste ${k + 1}`, status: 'respondida',
        contouNoLimite: true, expiraEm: new Date(agora.getTime() + RETENCAO_DIAS * 86_400_000), createdAt: agora,
      })),
    ); // (e)
  },
  db,
);
const vigente = await withTenant({ tenantId: consultorio.id, role: 'worker' }, async (tx) => consentimentoVigente(await ultimoEvento(tx, dois.patientId), destinoIa), db);
if (!vigente) {
  await withTenant(
    { tenantId: consultorio.id, role: 'paciente', patientId: dois.patientId, actorUserId: dois.userId },
    (tx) => tx.insert(iaNutriConsentimentos).values({ tenantId: consultorio.id, patientId: dois.patientId, evento: 'aceite', versao: IA_NUTRI_TERMO_VERSAO, destino: destinoIa, canal: 'app', registradoPor: dois.userId }),
    db,
  ); // (d)
}

// Plano 17 (P17-08): as pacientes fixas do seed (as duas da IA Nutri e a MULTI) começam cada execução sem lembretes de
// rotina e sem a pausa geral, como no banco novo do CI — no banco de dev reaproveitado, um lembrete deixado por uma
// verificação manual punha a seção "Lembretes" em Eu e mudava o cartão de notificações de Hoje. O contexto `worker` apaga
// também o que o paciente desligou (gatilho lembretes_rotina_sem_apagar, 0120) e limpa a pausa (0119); a marca de envio sai
// pela FK em cascata. As pacientes criadas pelas specs são sempre novas (sem lembrete).
await withTenant(
  { tenantId: consultorio.id, role: 'worker' },
  async (tx) => {
    const fixas = await tx.select({ id: patients.id }).from(patients).where(inArray(patients.userId, [multiId, um.userId, dois.userId]));
    const ids = fixas.map((f) => f.id);
    await tx.delete(lembretesRotina).where(inArray(lembretesRotina.patientId, ids));
    await tx.update(patients).set({ lembretesPausadosEm: null }).where(and(inArray(patients.id, ids), isNotNull(patients.lembretesPausadosEm)));
  },
  db,
);

// Plano 18 (T12a): as pacientes do cadastro complementar (E2E_CADASTRO_COMPLETO e E2E_CADASTRO_INCOMPLETO). Idempotente no
// banco de dev reaproveitado: cada uma é achada pelo e-mail (upsert em patients), a conta da completa é reaproveitada (como a
// MULTI) e o cadastro é upsert em (tenant_id, patient_id) com todos os campos — nunca DELETE: o gatilho
// patient_cadastro_sem_apagar só deixa apagar na anonimização. A avaliação só entra se a completa não tiver nenhuma.
if (!cpfValido(E2E_CADASTRO_COMPLETO.cpf)) throw new Error('CPF da semente do cadastro inválido');
const VAZIO_DO_CADASTRO = {
  cpf: null, nomeSocial: null, identidadeGenero: null, estadoCivil: null, escolaridade: null, ocupacao: null, nacionalidade: null, naturalidade: null,
  telefoneFixoE164: null, cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, observacao: null,
};
const senhaCompleta = await hashPassword(E2E_CADASTRO_COMPLETO.password);
const [jaCompleta] = await db.select({ id: user.id }).from(user).where(eq(user.email, E2E_CADASTRO_COMPLETO.email));
const completaUserId = jaCompleta?.id ?? randomUUID();
if (jaCompleta) {
  await db.update(account).set({ password: senhaCompleta }).where(eq(account.userId, completaUserId));
} else {
  await db.insert(user).values({ id: completaUserId, name: E2E_CADASTRO_COMPLETO.nome, email: E2E_CADASTRO_COMPLETO.email, emailVerified: true, appRole: 'paciente' });
  await db.insert(account).values({ id: randomUUID(), userId: completaUserId, accountId: completaUserId, providerId: 'credential', password: senhaCompleta });
}
await db.insert(consents).values({ userId: completaUserId, tenantId: consultorio.id, termoVersao: TERMO_PACIENTE, ip: null }).onConflictDoNothing();
const pacientesDoCadastro = [
  {
    userId: completaUserId,
    email: E2E_CADASTRO_COMPLETO.email,
    nome: E2E_CADASTRO_COMPLETO.nome,
    dataNascimento: '1985-05-17',
    sexo: 'M' as const,
    cadastro: {
      ...VAZIO_DO_CADASTRO,
      cpf: E2E_CADASTRO_COMPLETO.cpf,
      nomeSocial: E2E_CADASTRO_COMPLETO.nomeSocial,
      identidadeGenero: 'mulher',
      estadoCivil: 'casado',
      escolaridade: 'superior_completo',
      ocupacao: 'Professora',
      nacionalidade: 'brasileira',
      naturalidade: 'Campinas (SP)',
      telefoneFixoE164: '+551131234567',
      cep: '13015904',
      logradouro: 'Rua da Semente',
      numero: '18',
      complemento: 'Sala 2',
      bairro: 'Centro',
      cidade: 'Campinas',
      uf: 'SP',
      observacao: 'Paciente fictícia do E2E.',
    },
  },
  {
    userId: null,
    email: E2E_CADASTRO_INCOMPLETO.email,
    nome: E2E_CADASTRO_INCOMPLETO.nome,
    dataNascimento: '1992-08-03',
    sexo: 'F' as const,
    // sem estado civil e sem endereço; o telefone conta pelo fixo
    cadastro: { ...VAZIO_DO_CADASTRO, identidadeGenero: 'mulher', escolaridade: 'medio_completo', ocupacao: 'Analista', nacionalidade: 'brasileira', naturalidade: 'Santos (SP)', telefoneFixoE164: '+551332345678' },
  },
];
for (const p of pacientesDoCadastro) {
  const [linha] = await withTenant(
    { tenantId: consultorio.id, role: 'worker' },
    async (tx) => {
      const [paciente] = await tx
        .insert(patients)
        .values({ tenantId: consultorio.id, userId: p.userId, nome: p.nome, dataNascimento: p.dataNascimento, sexo: p.sexo, email: p.email })
        .onConflictDoUpdate({
          target: [patients.tenantId, patients.email],
          set: { userId: p.userId, nome: p.nome, dataNascimento: p.dataNascimento, sexo: p.sexo, status: 'ativo', pesoOcultoNoAppEm: null, updatedAt: new Date() },
        })
        .returning({ id: patients.id });
      await tx
        .insert(patientCadastro)
        .values({ tenantId: consultorio.id, patientId: paciente.id, ...p.cadastro })
        .onConflictDoUpdate({ target: [patientCadastro.tenantId, patientCadastro.patientId], set: { ...p.cadastro, updatedAt: new Date() } });
      return [paciente];
    },
    db,
  );
  if (p.userId) {
    await withTenant(
      ctxNutri,
      async (tx) => {
        const [ja] = await tx.select({ id: anthropometry.id }).from(anthropometry).where(eq(anthropometry.patientId, linha.id)).limit(1);
        if (!ja) await tx.insert(anthropometry).values({ tenantId: consultorio.id, patientId: linha.id, data: '2026-10-12', pesoKg: 72.4, alturaCm: 165 });
      },
      db,
    );
  }
}

// Plano 22 (T6, US-375, PM-E14): um exame liberado no app ("Mostrar no app") da paciente MULTI no "Consultório E2E 2" —
// consultório sem o recebimento de exames pelo app e sem envio dela, para o app-paciente.spec ver "Resultados liberados" e
// o item "Exames" do menu só pelo exame liberado (RN-386). Uma linha fora da faixa do laudo ("Fora da referência") e uma
// referência longa (quebra a linha a 360 px). Idempotente pelo título; a marca é religada a cada execução. O spec copia
// o título (importar este arquivo roda o seed).
const E2E_EXAME_LIBERADO = { titulo: 'Exames de rotina da semente' };
const [consultorio2] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'e2e-consultorio-2'));
await withTenant(
  { tenantId: consultorio2.id, role: 'worker' },
  async (tx) => {
    const [multi] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.tenantId, consultorio2.id), eq(patients.email, E2E_MULTI.email)));
    const [ja] = await tx.select({ id: exams.id }).from(exams).where(and(eq(exams.patientId, multi.id), eq(exams.titulo, E2E_EXAME_LIBERADO.titulo)));
    if (ja) {
      await tx.update(exams).set({ mostrarNoAppEm: new Date() }).where(and(eq(exams.id, ja.id), sql`${exams.mostrarNoAppEm} is null`));
      return;
    }
    await tx.insert(exams).values({
      tenantId: consultorio2.id,
      patientId: multi.id,
      data: '2026-10-20',
      titulo: E2E_EXAME_LIBERADO.titulo,
      valores: [
        { nome: 'Glicemia de jejum', valor: 105, unidade: 'mg/dL', referencia: '70 a 99 mg/dL', refMin: 70, refMax: 99 },
        { nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: 'Mulheres adultas: de 15 a 150 ng/mL, conforme o método do laboratório' },
      ],
      mostrarNoAppEm: new Date(),
    });
  },
  db,
);
// Plano 25 (T1c; T6, CH-D67, CH-D68): o consultório próprio do E2E do chat, NOVO a cada execução (os outros E2E não veem a
// conversa nem os recados), com o carimbo profissional (RN-475) — sem ele o gatilho recusa liberar, enviar e o recado. Tudo
// por withTenant com papel: a sessão `nutri` libera, escreve e manda o recado (o gatilho carimba, põe o relógio e confere o
// ator) e a sessão do paciente, com a conta dele, escreve a mensagem com sinal de risco — nunca sem papel (o gatilho
// devolveria NEW cedo e o carimbo ficaria por conta da semente). A conta do paciente é reaproveitada (consents é só de
// inclusão) e os vínculos dela com os consultórios do chat das execuções anteriores vão para "arquivado", para o portal abrir
// direto no consultório novo (RN-08: só o vínculo ativo dá acesso). Credenciais copiadas nas specs (importar o seed roda o seed).
export const E2E_CHAT_NUTRI = { email: 'chat-nutri-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_CHAT_PACIENTE = { email: 'chat-paciente-e2e@nutridebby.test', password: 'Nutri2026segura', nome: 'Paciente Chat E2E' };
const CARIMBO_CHAT = { nomeProfissional: 'Nutri Chat E2E da Silva', crn: 'CRN-3 25025' };
const [consultorioChat] = await db
  .insert(tenants)
  .values({ slug: `e2e-chat-${sufixo}`, nomeExibicao: 'Consultório Chat E2E', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), ...CARIMBO_CHAT })
  .returning({ id: tenants.id });
await db.delete(user).where(eq(user.email, E2E_CHAT_NUTRI.email));
const chatNutriId = randomUUID();
await db.insert(user).values({ id: chatNutriId, name: 'Nutri Chat E2E', email: E2E_CHAT_NUTRI.email, emailVerified: true, appRole: 'nutri', tenantId: consultorioChat.id, guia: TUDO_VISTO, tema: 'sistema' });
await db.insert(account).values({ id: randomUUID(), userId: chatNutriId, accountId: chatNutriId, providerId: 'credential', password: await hashPassword(E2E_CHAT_NUTRI.password) });
const senhaChat = await hashPassword(E2E_CHAT_PACIENTE.password);
const [jaChat] = await db.select({ id: user.id }).from(user).where(eq(user.email, E2E_CHAT_PACIENTE.email));
const chatPacienteUserId = jaChat?.id ?? randomUUID();
if (jaChat) {
  await db.update(account).set({ password: senhaChat }).where(eq(account.userId, chatPacienteUserId));
} else {
  await db.insert(user).values({ id: chatPacienteUserId, name: E2E_CHAT_PACIENTE.nome, email: E2E_CHAT_PACIENTE.email, emailVerified: true, appRole: 'paciente' });
  await db.insert(account).values({ id: randomUUID(), userId: chatPacienteUserId, accountId: chatPacienteUserId, providerId: 'credential', password: senhaChat });
}
const chatsAntigos = await db.select({ id: tenants.id }).from(tenants).where(and(like(tenants.slug, 'e2e-chat-%'), sql`${tenants.id} <> ${consultorioChat.id}`));
for (const { id: tenantId } of chatsAntigos) {
  await withTenant(
    { tenantId, role: 'worker' },
    (tx) => tx.update(patients).set({ status: 'arquivado', updatedAt: new Date() }).where(and(eq(patients.userId, chatPacienteUserId), eq(patients.status, 'ativo'))),
    db,
  );
}
await db.insert(consents).values({ userId: chatPacienteUserId, tenantId: consultorioChat.id, termoVersao: TERMO_PACIENTE, ip: null }).onConflictDoNothing();
const ctxChatNutri: TenantContext = { tenantId: consultorioChat.id, role: 'nutri', actorUserId: chatNutriId };
const chatPacienteId = await withTenant(
  ctxChatNutri,
  async (tx) => {
    const [p] = await tx
      .insert(patients)
      .values({ tenantId: consultorioChat.id, userId: chatPacienteUserId, nome: E2E_CHAT_PACIENTE.nome, dataNascimento: '1990-04-12', sexo: 'F', email: E2E_CHAT_PACIENTE.email })
      .returning({ id: patients.id });
    // liberação com a forma do TCLE (CH-D3); o gatilho põe o relógio e confere a liberação em nome de quem libera
    await tx.execute(sql`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma)
                         values (${consultorioChat.id}, ${p.id}, now(), ${chatNutriId}, 'aceite_escrito')`);
    await tx.execute(sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto)
                         values (${consultorioChat.id}, ${p.id}, 'nutri', ${chatNutriId}, 'Olá! A partir de hoje você pode falar comigo por aqui.')`);
    return p.id;
  },
  db,
);
// a mensagem do paciente com o sinal de risco (o selo "Sinal de risco" na caixa e na conversa, para o axe)
await withTenant(
  { tenantId: consultorioChat.id, role: 'paciente', patientId: chatPacienteId, actorUserId: chatPacienteUserId },
  (tx) =>
    tx.execute(sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, risco)
                   values (${consultorioChat.id}, ${chatPacienteId}, 'paciente', ${chatPacienteUserId}, 'Estou com tontura e muita dor de cabeça desde ontem.', 'sintoma_agudo')`),
  db,
);
// o recado com a cópia na conversa (CH-D68: a conversa mostra o rótulo "Recado" e o carimbo desde o PR 2)
await withTenant(
  ctxChatNutri,
  async (tx) => {
    const r = await tx.execute(sql`insert into recados (tenant_id, texto, filtro, filtro_rotulo, destinatarios, autor_nome, autor_crn, criado_por)
                                   values (${consultorioChat.id}, 'O consultório não atende no feriado de sexta-feira.', '{"tipo":"todos"}', 'Todos os pacientes com app', 1,
                                           ${CARIMBO_CHAT.nomeProfissional}, ${CARIMBO_CHAT.crn}, ${chatNutriId}) returning id`);
    await tx.execute(sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, recado_id)
                         values (${consultorioChat.id}, ${chatPacienteId}, 'nutri', ${chatNutriId}, 'O consultório não atende no feriado de sexta-feira.', ${r.rows[0].id as string})`);
  },
  db,
);
// Plano 26 (PM-R10, RE-D46, RE-D69): as duas contas da recepção do consultório do E2E — `E2E_RECEPCAO` (sem a permissão do
// Financeiro) e `E2E_RECEPCAO_FIN` (com ela) —, criadas UMA vez e reaproveitadas: nunca `delete user` (equipe_membros tem o
// DELETE revogado e a FK NO ACTION para `user`; consents também aponta para a conta). A cada execução: a senha e o 2FA de
// teste de novo (o mesmo segredo da E2E_DOCS, `Secret.fromUTF8` no spec), a linha de equipe_membros ativa e com a permissão
// certa — gravada pela sessão `nutri` com ator (o gatilho equipe_membros_regras recusa `worker` e o contexto vazio) — e o
// aceite do termo de confidencialidade em vigor (`SIGILO_EQUIPE_TERMO`, sem o qual a sessão recusa). `E2E_RECEPCAO_FIN` começa com o manual
// guiado zerado (o tour dela no primeiro acesso, T8); `E2E_RECEPCAO`, com tudo visto. Copiadas nos specs: importar o seed
// roda o seed.
export const E2E_RECEPCAO = { email: 'recepcao-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção E2E' };
export const E2E_RECEPCAO_FIN = { email: 'recepcao-fin-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção Financeiro E2E' };
// `E2E_RECEPCAO_CONTRATO` (RN-501): a recepção de um consultório só dela, com o DPA numa versão antiga a cada execução —
// toda tela a leva a "Contrato do consultório pendente" (a nutricionista desse consultório não existe: ninguém aceita).
export const E2E_RECEPCAO_CONTRATO = { email: 'recepcao-contrato-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção Contrato E2E' };
// Revisão final do PR 2 (RNF-481): as duas contas da recepção que só abrem /conta/acesso-desativado, num consultório só
// delas (com o DPA em vigor; a nutricionista desse consultório não existe, como no do contrato): `E2E_RECEPCAO_DESATIVADA`
// (linha de equipe_membros desativada a cada execução, com `desativada_em` pelo gatilho — RN-503) e
// `E2E_RECEPCAO_SEM_TERMO` (ativa, com o 2FA, sem o aceite do termo de confidencialidade, RN-500: desde o code review do
// PR 2, o formulário do aceite da versão em vigor; o axe nunca aceita — quem aceita é a `E2E_RECEPCAO_TERMO_NOVO`). Fora do
// consultório principal: não contam nas 3 ativas dele nem aparecem na tela Equipe da nutricionista do E2E.
export const E2E_RECEPCAO_DESATIVADA = { email: 'recepcao-desativada-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção Desativada E2E' };
export const E2E_RECEPCAO_SEM_TERMO = { email: 'recepcao-sem-termo-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção Sem Termo E2E' };
const [semAcesso] = await db
  .insert(tenants)
  .values({ slug: 'e2e-recepcao-sem-acesso', nomeExibicao: 'Consultório E2E Sem Acesso', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() })
  .onConflictDoUpdate({ target: tenants.slug, set: { status: 'ativa', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() } })
  .returning({ id: tenants.id });
const atorSemAcesso = randomUUID();
const [contratoPendente] = await db
  .insert(tenants)
  .values({ slug: 'e2e-contrato-pendente', nomeExibicao: 'Consultório E2E Contrato', dpaVersao: '0.1-provisorio', dpaAceitoEm: new Date() })
  .onConflictDoUpdate({ target: tenants.slug, set: { status: 'ativa', dpaVersao: '0.1-provisorio' } })
  .returning({ id: tenants.id });
for (const [cred, financeiro, tenantId, ator] of [
  [E2E_RECEPCAO, false, consultorio.id, nutriId],
  [E2E_RECEPCAO_FIN, true, consultorio.id, nutriId],
  [E2E_RECEPCAO_CONTRATO, false, contratoPendente.id, randomUUID()],
  [E2E_RECEPCAO_DESATIVADA, false, semAcesso.id, atorSemAcesso],
  [E2E_RECEPCAO_SEM_TERMO, false, semAcesso.id, atorSemAcesso],
] as const) {
  const senha = await hashPassword(cred.password);
  const [ja] = await db.select({ id: user.id }).from(user).where(eq(user.email, cred.email));
  const id = ja?.id ?? randomUUID();
  if (ja) {
    await db.update(user).set({ name: cred.nome, appRole: 'recepcao', tenantId, twoFactorEnabled: true, tema: 'sistema' }).where(eq(user.id, id));
    await db.update(account).set({ password: senha }).where(eq(account.userId, id));
    await db.delete(twoFactor).where(eq(twoFactor.userId, id));
  } else {
    await db.insert(user).values({ id, name: cred.nome, email: cred.email, emailVerified: true, appRole: 'recepcao', tenantId, twoFactorEnabled: true });
    await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: senha });
  }
  await db.insert(twoFactor).values({
    id: randomUUID(),
    userId: id,
    verified: true,
    secret: await symmetricEncrypt({ key: chave, data: cred.totp }),
    backupCodes: await symmetricEncrypt({ key: chave, data: JSON.stringify([]) }),
  });
  await withTenant(
    { tenantId, role: 'nutri', actorUserId: ator },
    async (tx) => {
      await tx
        .insert(equipeMembros)
        .values({ tenantId, userId: id, papel: 'recepcao', financeiro, convidadaPor: ator })
        .onConflictDoUpdate({ target: equipeMembros.userId, set: { financeiro, desativadaEm: null, desativadaPor: null, updatedAt: new Date() } });
      // o gatilho equipe_membros_regras grava `desativada_em` (relógio do banco) e `desativada_por` (a usuária da sessão)
      if (cred === E2E_RECEPCAO_DESATIVADA)
        await tx.update(equipeMembros).set({ desativadaEm: new Date(), desativadaPor: ator, updatedAt: new Date() }).where(eq(equipeMembros.userId, id));
    },
    db,
  );
  // `E2E_RECEPCAO_SEM_TERMO` nunca recebe o aceite (consents não se apaga: a conta é só dela)
  if (cred !== E2E_RECEPCAO_SEM_TERMO)
    await db.insert(consents).values({ userId: id, tenantId, termoVersao: SIGILO_EQUIPE_TERMO, ip: null }).onConflictDoNothing();
  await db.update(user).set({ guia: cred === E2E_RECEPCAO_FIN ? {} : TUDO_VISTO }).where(eq(user.id, id));
}

// Code review do PR 2 do Plano 26 (RN-500): `E2E_RECEPCAO_TERMO_NOVO`, a recepção ativa, com o 2FA, que aceitou só uma
// versão ANTIGA do termo de confidencialidade (`sigilo-equipe-0.9`) e aceita a versão em vigor pelo formulário de
// /conta/acesso-desativado (e2e/recepcao.spec.ts). O aceite fica em `consents`, que é só de inclusão (0009: DELETE e UPDATE
// revogados) — a semente não tem como devolver a conta ao estado "sem termo". Por isso, a cada execução, uma conta NOVA com o
// mesmo e-mail num consultório NOVO (com o DPA em vigor; a nutricionista dele não existe, só o ator da linha de
// `equipe_membros`): a conta da execução anterior fica no banco com o e-mail trocado para um arquivado (`user` e
// `equipe_membros` não se apagam). `E2E_RECEPCAO_SEM_TERMO` continua como está (nunca aceita: o axe do formulário).
export const E2E_RECEPCAO_TERMO_NOVO = { email: 'recepcao-termo-novo-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção Termo Novo E2E' };
{
  const cred = E2E_RECEPCAO_TERMO_NOVO;
  const [anterior] = await db.select({ id: user.id }).from(user).where(eq(user.email, cred.email));
  if (anterior) await db.update(user).set({ email: `recepcao-termo-novo-arquivada-${anterior.id}@nutridebby.test` }).where(eq(user.id, anterior.id));
  const [t] = await db
    .insert(tenants)
    .values({ slug: `e2e-termo-novo-${sufixo}`, nomeExibicao: 'Consultório E2E Termo Novo', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() })
    .returning({ id: tenants.id });
  const id = randomUUID();
  const ator = randomUUID();
  await db.insert(user).values({ id, name: cred.nome, email: cred.email, emailVerified: true, appRole: 'recepcao', tenantId: t.id, twoFactorEnabled: true, guia: TUDO_VISTO });
  await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(cred.password) });
  await db.insert(twoFactor).values({
    id: randomUUID(),
    userId: id,
    verified: true,
    secret: await symmetricEncrypt({ key: chave, data: cred.totp }),
    backupCodes: await symmetricEncrypt({ key: chave, data: JSON.stringify([]) }),
  });
  await withTenant(
    { tenantId: t.id, role: 'nutri', actorUserId: ator },
    (tx) => tx.insert(equipeMembros).values({ tenantId: t.id, userId: id, papel: 'recepcao', financeiro: false, convidadaPor: ator }),
    db,
  );
  await db.insert(consents).values({ userId: id, tenantId: t.id, termoVersao: 'sigilo-equipe-0.9', ip: null });
}

// Plano 26 (T7, RE-D69): o primeiro acesso da recepção (e2e/equipe-primeiro-acesso.spec.ts) num consultório NOVO por
// execução, com o DPA aceito e uma nutricionista sem senha (só o ator do convite), e o convite criado pelo módulo da Equipe
// (`convidarRecepcao`, a mesma transação da tela) para um e-mail novo por execução: com um e-mail fixo, a 2ª execução cairia
// em "Este e-mail já tem uma conta" (equipe_membros.user_id é NO ACTION, com o DELETE revogado), e o consultório principal
// já tem E2E_RECEPCAO e E2E_RECEPCAO_FIN. O spec acha o convite pelo assunto (o nome do consultório é fixo; o mais novo é o
// desta execução). Os consultórios das execuções anteriores ficam no banco, com as contas deles.
export const E2E_EQUIPE_NOVA = { consultorio: 'Consultório Equipe Nova E2E', nome: 'Recepção Nova E2E' };
{
  const [t] = await db
    .insert(tenants)
    .values({ slug: `e2e-equipe-nova-${sufixo}`, nomeExibicao: E2E_EQUIPE_NOVA.consultorio, dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() })
    .returning({ id: tenants.id });
  const ator = randomUUID();
  await db.insert(user).values({ id: ator, name: 'Nutri Equipe Nova E2E', email: `e2e-equipe-nova-nutri-${sufixo}@nutridebby.test`, emailVerified: true, appRole: 'nutri', tenantId: t.id });
  await convidarRecepcao(
    { tenantId: t.id, role: 'nutri', actorUserId: ator, ip: null },
    { nome: E2E_EQUIPE_NOVA.nome, email: `recepcao-nova-${sufixo}@nutridebby.test`, financeiro: false },
    { db },
  );
}

await stopBoss(); // a publicação do plano enfileira o PDF
await closeDb();
console.log('Seed E2E pronto.');
