import { randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { and, eq, inArray, isNotNull, like, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, consents, contents, finCategorias, finConfiguracoes, iaNutriConsentimentos, iaNutriMensagens, iaNutriParticipacoes, lembretesRotina, mealPlans, patients, rateLimit, tenants, twoFactor, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { stopBoss } from '@/jobs/boss';
import { hashPassword } from '@/lib/password.server';
import { chaveDoLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { idTaco } from '@/modules/alimentos/taco';
import { GUIAS } from '@/modules/ajuda/conteudo';
import { criarConteudo, publicarConteudo } from '@/modules/conteudo/conteudos';
import { configIA } from '@/modules/ia/modo';
import { LIMITE_DIA, RETENCAO_DIAS } from '@/modules/ia/nutri-paciente/constantes';
import { consentimentoVigente, ultimoEvento } from '@/modules/ia/nutri-paciente/estado';
import { IA_ADITIVO_VERSAO, IA_NUTRI_TERMO_VERSAO } from '@/modules/ia/textos-legais';
import { ligarConteudo, ligarLista } from '@/modules/plano-alimentar/ligados';
import { listarListas, salvarLista } from '@/modules/plano-alimentar/listas';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
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
/**
 * Plano 19 (T11): a paciente do plano por dia da semana — com conta e o termo aceito, e um plano publicado em texto livre
 * com "Almoço" de segunda a sexta e "Almoço" de sábado e domingo, a lista de substituição "Trocas do dia a dia (seed
 * E2E)" e a orientação "Como montar o prato (seed E2E)" (fora da audiência dela) ligadas. Publicado uma vez (o banco do
 * E2E persiste); os planos das outras pacientes fixas não mudam. O acessibilidade.spec audita /p/plano com ela (dois
 * perfis de dia, a lista inline e o conteúdo ligado; o texto da nutricionista com um link longo a 320 px).
 */
export const E2E_PLANO_DIAS = { email: 'plano-dias-e2e@nutridebby.test', password: 'Nutri2026segura', nome: 'Paciente Plano por Dia' };
/** Plano 19: o link longo (sem espaço, maior que 320 px) do texto livre e da orientação da lista da E2E_PLANO_DIAS. */
export const LINK_LONGO_PLANO_DIAS = 'https://exemplo.com.br/receitas/marmita-da-semana-com-legumes-assados-e-graos-integrais-variados';
export const E2E_FIN_NOVO = { email: 'fin-novo-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_FIN_AXE = { email: 'fin-axe-e2e@nutridebby.test', password: 'Nutri2026segura' };

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
// consultório), consulta a R$ 250,00 e as categorias iniciais da RN-302 (a T2 passa a lista para CATEGORIAS_INICIAIS). Tudo com
// ON CONFLICT DO NOTHING: a linha de configuração e as categorias das execuções anteriores ficam como estão.
const CATEGORIAS_DO_E2E: { tipo: 'entrada' | 'saida'; nome: string; chave: 'consultas' | null }[] = [
  { tipo: 'entrada', nome: 'Consultas', chave: 'consultas' },
  { tipo: 'entrada', nome: 'Outras entradas', chave: null },
  ...[
    'Aluguel e condomínio',
    'Contas de consumo (água, luz, internet, telefone)',
    'Material e insumos',
    'Equipamentos',
    'Software e assinaturas',
    'Divulgação',
    'Impostos e taxas',
    'Conselho e associações',
    'Cursos e eventos',
    'Outras saídas',
  ].map((nome) => ({ tipo: 'saida' as const, nome, chave: null })),
];
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
    .values(CATEGORIAS_DO_E2E.map((c) => ({ tenantId: consultorio.id, ...c })))
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

// Plano 19 (T11): a E2E_PLANO_DIAS (o comentário da constante). Tudo idempotente: a conta e o aceite como os da IA Nutri;
// a lista (nome único no consultório) e a orientação (pelo título) só são criadas se ainda não existem; o plano só é
// montado e publicado se a paciente ainda não tem um publicado (ligarLista/ligarConteudo devolvem a ligação que já existe
// num rascunho que sobrou de uma execução interrompida). A audiência da orientação é só a MULTI: a paciente a vê só pelo plano.
{
  const cred = E2E_PLANO_DIAS;
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
  const [publicado] = await withTenant(ctxNutri, (tx) => tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'publicado'))), db);
  if (!publicado) {
    const NOME_LISTA = 'Trocas do dia a dia (seed E2E)';
    const listaId =
      (await listarListas(ctxNutri, db)).find((l) => l.nome === NOME_LISTA)?.id ??
      (
        await salvarLista(ctxNutri, null, {
          nome: NOME_LISTA,
          orientacao: `Troque um alimento por outro do mesmo grupo. Veja ${LINK_LONGO_PLANO_DIAS}`,
          grupos: [
            {
              id: randomUUID(),
              nome: 'Frutas — 1 porção',
              itens: [
                { id: randomUUID(), foodId: idTaco(182), quantidadeG: '86', medida: null }, // Banana, prata, crua
                { id: randomUUID(), foodId: idTaco(222), quantidadeG: '130', medida: null }, // Maçã, Fuji, com casca, crua
              ],
            },
          ],
        }, { db })
      ).id;
    const TITULO_ORIENTACAO = 'Como montar o prato (seed E2E)';
    const [orientacao] = await withTenant(ctxNutri, (tx) => tx.select({ id: contents.id }).from(contents).where(and(eq(contents.titulo, TITULO_ORIENTACAO), eq(contents.tipo, 'orientacao'))), db);
    let conteudoId = orientacao?.id;
    if (!conteudoId) {
      const [multi] = await withTenant(ctxNutri, (tx) => tx.select({ id: patients.id }).from(patients).where(eq(patients.userId, multiId)), db);
      conteudoId = await criarConteudo(ctxNutri, 'orientacao', { titulo: TITULO_ORIENTACAO, resumo: '', etiquetas: '', visibilidade: 'pacientes', pacientes: [multi.id], corpo: '## O prato\n\nMetade do prato com legumes e verduras.' }, { db });
      await publicarConteudo(ctxNutri, conteudoId, { avisar: false }, { db });
    }
    const { id: planId } = await criarRascunho(ctxNutri, p.id, { db });
    const [r] = await withTenant(ctxNutri, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, planId)), db);
    const almoco = (horario: string, diasSemana: number[], texto: string) => ({ id: randomUUID(), nome: 'Almoço', horario, observacao: '', diasSemana, descricaoLivre: texto, itens: [] });
    await salvarRascunho(ctxNutri, planId, {
      revisao: r.revisao, envio: randomUUID(), titulo: 'Plano por dia da semana', metaKcal: '1800', mostrarCalorias: false, orientacoes: '', modo: 'livre', macrosPrescritos: null,
      refeicoes: [
        almoco('12:00', [1, 2, 3, 4, 5], `Arroz, feijão, frango grelhado e salada. Receita da marmita: ${LINK_LONGO_PLANO_DIAS}`),
        almoco('13:00', [0, 6], 'Peixe assado com legumes e purê de batata.'),
      ],
    }, { db });
    await ligarLista(ctxNutri, { planId, patientId: p.id }, listaId, { db });
    await ligarConteudo(ctxNutri, { planId, patientId: p.id }, conteudoId, { db });
    const resultado = await publicarPlano(ctxNutri, p.id, planId, { db });
    if (resultado.avisos) throw new Error(`plano da ${cred.email} não publicado: ${resultado.avisos.join(' ')}`);
  }
}

await stopBoss(); // a publicação do plano enfileira o PDF
await closeDb();
console.log('Seed E2E pronto.');
