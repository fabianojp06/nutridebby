/**
 * P08-03 (D5): 50 consultórios × 300 pacientes ativos com conta (RNF-02), agenda do mês, acessos de 30 dias,
 * 100 conteúdos por consultório (Plano 07), um plano de 50 refeições por consultório (Plano 19, RN-249: segunda a sexta e
 * sábado e domingo, com a lista de substituição e a orientação ligadas) e as sessões dos usuários virtuais do k6. SÓ na
 * pilha de carga:
 * lê o .env.carga (o da pilha) e troca o host `db:5432` dele por 127.0.0.1:54339; recusa qualquer outro banco.
 * O .env.carga inteiro vale aqui: o e-mail e os avisos que a semente enfileira saem cifrados com a ENCRYPTION_KEY da
 * pilha (o worker dela decifra) e o produtor do pg-boss (`getBoss`) abre o banco por DATABASE_URL.
 * Uso, na raiz do repositório (no commit da imagem): pnpm tsx --env-file=.env.carga test/carga/seed.ts
 * Nunca importado pelo app nem pelo Vitest (não termina em `.test.ts`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { account, accessEvents, consents, patients, pushSubscriptions, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { createAuth } from '@/lib/auth';
import { hashPassword } from '@/lib/password.server';
import { agendarLembretes } from '@/modules/notificacoes/agendar';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { revisaoDoPlano } from '@/modules/plano-alimentar/carregar';
import { ligarConteudo, ligarLista } from '@/modules/plano-alimentar/ligados';
import { salvarLista } from '@/modules/plano-alimentar/listas';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { consultaDireta } from '../agenda';
import { novaEtiqueta, novoConteudo } from '../conteudos';
import type { TenantDeTeste } from '../pacientes';
import { entrar, SENHA_TESTE } from '../sessao';

const DA_PILHA = 'http://localhost:3200'; // APP_URL que só o gerar-env.sh escreve
const u = URL.canParse(process.env.DATABASE_URL ?? '') ? new URL(process.env.DATABASE_URL!) : null;
if (process.env.APP_URL !== DA_PILHA || u?.hostname !== 'db' || u.port !== '5432') {
  throw new Error('seed de carga só roda com o .env.carga da pilha de carga: pnpm tsx --env-file=.env.carga test/carga/seed.ts');
}
u.hostname = '127.0.0.1'; // a porta do banco da pilha no host (docker-compose.carga.yml)
u.port = '54339';
const URL_DB = u.toString();
process.env.DATABASE_URL = URL_DB; // getBoss() (avisos e envios enfileirados na transação) usa o mesmo banco

const TENANTS = Number(process.env.CARGA_TENANTS ?? 50);
const PACIENTES = Number(process.env.CARGA_PACIENTES ?? 300);
const SESSOES_POR_TENANT = 6; // 300 pacientes com sessão no total (+ 50 com o plano de 50 refeições, Plano 19): os VUs do k6 se revezam entre eles
const pool = new Pool({ connectionString: URL_DB, max: 8 });
const db = drizzle({ client: pool, schema });
// trustedProxies vazio: o `entrar` sorteia o IP em x-forwarded-for (limite de 5 logins por IP em 15 min)
const auth = createAuth(db, { baseURL: 'http://localhost:3000', trustedProxies: [], verificarTurnstile: async () => 'ok' });
const boss = await getBoss();
const hash = await hashPassword(SENHA_TESTE); // um hash para todas as contas (argon2 é lento de propósito)
const fuso = 'America/Sao_Paulo';
const agora = new Date();
type Inscricao = { endpoint: string; keys: { p256dh: string; auth: string } };
const sessoes: { pacientes: { cookie: string; conteudo: string; inscricao: Inscricao }[]; nutris: { cookie: string; pacientes: string[]; planos: { id: string; paciente: string }[] }[]; slugs: string[] } = { pacientes: [], nutris: [], slugs: [] };
const tenantIds: string[] = [];
let alimentos: string[] = []; // TACO (tenant_id nulo), lida na sessão do primeiro consultório (RLS de foods)

for (let t = 0; t < TENANTS; t++) {
  const slug = `carga-${String(t).padStart(2, '0')}`;
  const [tn] = await db.insert(tenants).values({ slug, nomeExibicao: `Consultório Carga ${t}`, dpaVersao: DPA_VERSAO, dpaAceitoEm: agora, agendamentoPublicoAtivo: true }).returning({ id: tenants.id });
  tenantIds.push(tn.id);
  const nutriId = randomUUID();
  const emailNutri = `nutri-${slug}@carga.test`;
  await db.insert(user).values({ id: nutriId, name: `Nutri ${t}`, email: emailNutri, emailVerified: true, appRole: 'nutri', tenantId: tn.id });
  await db.insert(account).values({ id: randomUUID(), userId: nutriId, accountId: nutriId, providerId: 'credential', password: hash });
  const ctx: TenantContext = { tenantId: tn.id, role: 'nutri', actorUserId: nutriId, ip: '127.0.0.1' };
  const T: TenantDeTeste = { tenantId: tn.id, nutriId, ctx, tenant: { fuso, nomeExibicao: `Consultório Carga ${t}` } };
  if (!alimentos.length) {
    alimentos = await withTenant(ctx, async (tx) => (await tx.execute<{ id: string }>(sql`select id from foods where tenant_id is null order by id limit 6`)).rows.map((r) => r.id), db);
    if (!alimentos.length) throw new Error('foods sem a TACO: as migrations não rodaram na pilha de carga');
  }

  // 300 pacientes ativos, todos com conta e o termo aceito
  const ids: { id: string; userId: string; email: string }[] = [];
  for (let p = 0; p < PACIENTES; p++) {
    const userId = randomUUID();
    const email = `p${p}-${slug}@carga.test`;
    ids.push({ id: randomUUID(), userId, email });
  }
  await db.insert(user).values(ids.map((x, i) => ({ id: x.userId, name: `Paciente ${i}`, email: x.email, emailVerified: true, appRole: 'paciente' })));
  await db.insert(account).values(ids.map((x) => ({ id: randomUUID(), userId: x.userId, accountId: x.userId, providerId: 'credential', password: hash })));
  await withTenant(ctx, (tx) => tx.insert(patients).values(ids.map((x, i) => ({ id: x.id, tenantId: tn.id, nome: `Paciente ${i} ${slug}`, email: x.email, userId: x.userId, dataNascimento: '1990-01-01', sexo: i % 2 ? 'F' : 'M' }))), db);
  await db.insert(consents).values(ids.map((x) => ({ userId: x.userId, tenantId: tn.id, termoVersao: TERMO_PACIENTE, ip: null })));

  // agenda do mês: 8 consultas por dia útil, espalhadas entre os pacientes (varredura de notificações, N9).
  // consultaDireta grava "sem regra, sem lembrete" (test/agenda.ts): as futuras ganham os lembretes pela função real
  // (agendarLembretes, a mesma da marcação) — senão `notifications` fica vazia e a meta da D4 não é medida
  for (let d = -10; d <= 20; d++) {
    const dia = new Date(agora.getTime() + d * 86_400_000);
    if ([0, 6].includes(dia.getUTCDay())) continue;
    for (let h = 0; h < 8; h++) {
      const inicio = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 11 + h, 0));
      const patientId = ids[(d * 8 + h + 400) % PACIENTES].id;
      const appointmentId = await consultaDireta(db, ctx, patientId, inicio, 60, d < 0 ? { status: 'realizada' } : {});
      if (inicio > agora) await withTenant(ctx, (tx) => agendarLembretes(tx, { tenantId: tn.id, patientId, appointmentId, inicio }, fuso, agora), db);
    }
  }
  // acessos dos últimos 30 dias (CS-02): ~60% dos pacientes por dia
  const acessos: (typeof accessEvents.$inferInsert)[] = [];
  for (let d = 0; d < 30; d++) {
    const dia = new Date(agora.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    for (const x of ids) if ((x.id.charCodeAt(0) + d) % 5 < 3) acessos.push({ tenantId: tn.id, patientId: x.id, dia });
  }
  for (let i = 0; i < acessos.length; i += 2000) await withTenant(ctx, (tx) => tx.insert(accessEvents).values(acessos.slice(i, i + 2000)).onConflictDoNothing(), db);

  // 100 conteúdos (Plano 07): 70 para todos, 20 por etiqueta de paciente, 10 para pacientes específicos (N20)
  const etiqueta = await novaEtiqueta(db, T, 'gestante', ids.slice(0, 60).map((x) => x.id));
  const conteudos: string[] = [];
  for (let c = 0; c < 100; c++) {
    const extra = c < 70 ? {} : c < 90 ? { visibilidade: 'etiquetas' as const, tags: [etiqueta] } : { visibilidade: 'pacientes' as const, pacientes: ids.slice(c, c + 20).map((x) => x.id) };
    const row = await novoConteudo(db, T, { titulo: `Conteúdo ${c} com aveia`, resumo: 'Receita sem lactose', etiquetas: ['sem lactose'], ...extra });
    if (c < 70) conteudos.push(row.id);
  }

  // planos publicados e sessões só para os pacientes que o k6 usa
  const planos: { id: string; paciente: string }[] = []; // a revisão do plano de paciente pede ?paciente= (D7)
  for (const x of ids.slice(0, SESSOES_POR_TENANT)) {
    const { id: planId } = await criarRascunho(ctx, x.id, { db });
    const revisao = (await revisaoDoPlano(ctx, planId, x.id, db)) ?? 0;
    const refeicao = randomUUID();
    await salvarRascunho(ctx, planId, {
      revisao, envio: randomUUID(), titulo: 'Plano de carga', metaKcal: '1800', mostrarCalorias: true, orientacoes: '',
      refeicoes: [{ id: refeicao, nome: 'Almoço', horario: '12:00', observacao: '', itens: alimentos.map((foodId) => ({ id: randomUUID(), foodId, quantidadeG: '100', medida: null, substituiItemId: null })) }],
    }, { db });
    await publicarPlano(ctx, x.id, planId, { db, boss });
    planos.push({ id: planId, paciente: x.id });
    // B-8: uma inscrição de push sintética (formato do Zod de push-inscricao.ts) já gravada, para o
    // POST /api/p/push?sincronizar=1 do k6 percorrer o app_soltar_endpoint_push com 50 tenants e responder 204
    const inscricao: Inscricao = {
      endpoint: `https://fcm.googleapis.com/fcm/send/carga-${randomUUID()}`,
      keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') },
    };
    const ctxPaciente: TenantContext = { tenantId: tn.id, role: 'paciente', patientId: x.id, actorUserId: x.userId, ip: '127.0.0.1' };
    await withTenant(ctxPaciente, (tx) => tx.insert(pushSubscriptions).values({ tenantId: tn.id, patientId: x.id, endpoint: inscricao.endpoint, p256dh: inscricao.keys.p256dh, auth: inscricao.keys.auth, userAgent: 'k6' }), db);
    sessoes.pacientes.push({ cookie: await entrar(auth, x.email), conteudo: conteudos[sessoes.pacientes.length % conteudos.length], inscricao });
  }
  // Plano 19 (RN-249, PM-PA9): mais um paciente com sessão, o seguinte aos de cima (sem plano até aqui), com o plano no
  // limite do editor — 50 refeições (25 de segunda a sexta e 25 de sábado e domingo, os 6 alimentos em cada uma: 300
  // itens) — e a lista de substituição e a orientação (fora da audiência dele) ligadas. Os planos de cima não mudam. A
  // semente cria consultórios novos a cada rodada: a lista (nome único no consultório) e o conteúdo nunca repetem.
  {
    const x = ids[SESSOES_POR_TENANT];
    const { id: listaId } = await salvarLista(ctx, null, {
      nome: 'Trocas do dia a dia', orientacao: 'Troque um alimento por outro do mesmo grupo.',
      grupos: [{ id: randomUUID(), nome: 'Carboidratos — 1 porção', itens: alimentos.map((foodId) => ({ id: randomUUID(), foodId, quantidadeG: '100', medida: null })) }],
    }, { db });
    const orientacao = await novoConteudo(db, T, { titulo: 'Como montar o prato', visibilidade: 'pacientes', pacientes: [ids[0].id] });
    const { id: planId } = await criarRascunho(ctx, x.id, { db });
    const revisao = (await revisaoDoPlano(ctx, planId, x.id, db)) ?? 0;
    const NOMES = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar'];
    await salvarRascunho(ctx, planId, {
      revisao, envio: randomUUID(), titulo: 'Plano de carga (50 refeições)', metaKcal: '1800', mostrarCalorias: true, orientacoes: '',
      refeicoes: Array.from({ length: 50 }, (_, k) => ({
        id: randomUUID(),
        nome: `${NOMES[k % NOMES.length]} ${Math.floor(k / 2) + 1}`,
        horario: `${String(6 + (Math.floor(k / 2) % 17)).padStart(2, '0')}:${k % 2 ? '30' : '00'}`,
        observacao: '',
        diasSemana: k % 2 ? [0, 6] : [1, 2, 3, 4, 5],
        itens: alimentos.map((foodId) => ({ id: randomUUID(), foodId, quantidadeG: '100', medida: null, substituiItemId: null })),
      })),
    }, { db });
    await ligarLista(ctx, { planId, patientId: x.id }, listaId, { db });
    await ligarConteudo(ctx, { planId, patientId: x.id }, orientacao.id, { db });
    const publicacao = await publicarPlano(ctx, x.id, planId, { db, boss });
    if (publicacao.avisos) throw new Error(`plano de 50 refeições não publicado: ${publicacao.avisos.join(' ')}`);
    planos.push({ id: planId, paciente: x.id });
    const inscricao: Inscricao = {
      endpoint: `https://fcm.googleapis.com/fcm/send/carga-${randomUUID()}`,
      keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') },
    };
    const ctxPaciente: TenantContext = { tenantId: tn.id, role: 'paciente', patientId: x.id, actorUserId: x.userId, ip: '127.0.0.1' };
    await withTenant(ctxPaciente, (tx) => tx.insert(pushSubscriptions).values({ tenantId: tn.id, patientId: x.id, endpoint: inscricao.endpoint, p256dh: inscricao.keys.p256dh, auth: inscricao.keys.auth, userAgent: 'k6' }), db);
    sessoes.pacientes.push({ cookie: await entrar(auth, x.email), conteudo: conteudos[sessoes.pacientes.length % conteudos.length], inscricao });
  }
  sessoes.nutris.push({ cookie: await entrar(auth, emailNutri), pacientes: ids.slice(0, 50).map((x) => x.id), planos });
  sessoes.slugs.push(slug);
  console.log(`${slug}: ${PACIENTES} pacientes, ${acessos.length} acessos, 100 conteúdos`);
}

// D4: parte dos lembretes vence DURANTE a rodada (o job `notificacoes` varre e envia de verdade, para o Mailpit).
// CARGA_VENCER_EM_MIN: minutos entre o fim da semente e o início da rodada; os vencimentos se espalham por 12 min.
const VENCER_EM_MIN = Number(process.env.CARGA_VENCER_EM_MIN ?? 20);
for (const tenantId of tenantIds) {
  await withTenant({ tenantId, role: 'worker' }, (tx) => tx.execute(sql`
    update notifications set agendada_para = now() + make_interval(mins => ${VENCER_EM_MIN}) + random() * interval '12 minutes'
    where id in (select id from notifications where status = 'pendente' order by random() limit 150)`), db);
}

writeFileSync('test/carga/.sessoes.json', JSON.stringify(sessoes), { mode: 0o600 }); // cookies de sessão: só o dono lê
await stopBoss();
await pool.end();
console.log('pronto: test/carga/.sessoes.json');
