/**
 * P08-03 (D5): 50 consultórios × 300 pacientes ativos com conta (RNF-02), agenda do mês, acessos de 30 dias,
 * 100 conteúdos por consultório (Plano 07) e as sessões dos usuários virtuais do k6. SÓ na pilha de carga:
 * lê o .env.carga (o da pilha) e troca o host `db:5432` dele por 127.0.0.1:54339; recusa qualquer outro banco.
 * O .env.carga inteiro vale aqui: o e-mail e os avisos que a semente enfileira saem cifrados com a ENCRYPTION_KEY da
 * pilha (o worker dela decifra) e o produtor do pg-boss (`getBoss`) abre o banco por DATABASE_URL.
 * Uso, na raiz do repositório (no commit da imagem): pnpm tsx --env-file=.env.carga test/carga/seed.ts
 * Nunca importado pelo app nem pelo Vitest (não termina em `.test.ts`).
 * Plano 18 (P18-12b, CS-263): os pacientes ganham o cadastro complementar (`semearCadastro`) e o registro clínico que as
 * seções do Início leem (`semearRegistros`). Rodar de novo na mesma pilha (consultórios já semeados) refaz o cadastro, por
 * upsert, grava o registro clínico só no consultório que ainda não tem (pilha semeada antes da P18-12b) e mantém o
 * `.sessoes.json`; o resto da semente é de uma vez por pilha (recriada com `down -v`, roteiro passo 10).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { account, accessEvents, anamneses, anamnesisTemplates, anthropometry, consents, consultations, energyCalcs, exams, patients, pushSubscriptions, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { createAuth } from '@/lib/auth';
import { hashPassword } from '@/lib/password.server';
import { agendarLembretes } from '@/modules/notificacoes/agendar';
import { garantirModeloPadrao } from '@/modules/pacientes/anamnese';
import { gravarCadastro, type CadastroComplementar } from '@/modules/pacientes/cadastro';
import { cpfValido } from '@/modules/pacientes/cpf';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { revisaoDoPlano } from '@/modules/plano-alimentar/carregar';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { consultaDireta } from '../agenda';
import { novaEtiqueta, novoConteudo } from '../conteudos';
import { documentoNoBanco } from '../documentos';
import { envioNoBanco } from '../exames-enviados';
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
const SESSOES_POR_TENANT = 6; // 300 pacientes com sessão no total: os VUs do k6 se revezam entre eles
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
const slugDo = (t: number) => `carga-${String(t).padStart(2, '0')}`;

// Plano 18 (P18-12b, CS-263): cadastro complementar sintético, determinístico por (consultório, paciente) — a segunda
// rodada grava os mesmos valores. CPF fictício com os dígitos verificadores certos, único no consultório (índice
// patient_cadastro_cpf_unico) ou nulo; nunca impresso (regra 3). Variado como num consultório real: 1 em 5 sem linha
// (paciente antigo), metade sem endereço (nota "Cadastro incompleto"), 1 em 10 com nome social (lista e busca).
if (PACIENTES > 100_000) throw new Error('CARGA_PACIENTES acima de 100 mil: o CPF sintético repetiria');
const digito = (base: string) => {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};
function cpfSintetico(t: number, p: number): string {
  const base = String(200_000_000 + t * 100_000 + p); // 9 dígitos, nunca todos iguais (2xx… até 204.999.999)
  const comPrimeiro = `${base}${digito(base)}`;
  const cpf = `${comPrimeiro}${digito(comPrimeiro)}`;
  if (!cpfValido(cpf)) throw new Error('CPF sintético inválido'); // sem o valor (regra 3)
  return cpf;
}
const IDENTIDADES = ['mulher', 'homem', 'nao_binario', 'prefere_nao_informar'] as const;
const ESTADOS = ['solteiro', 'casado', 'uniao_estavel', 'divorciado'] as const;
const ESCOLAS = ['medio_completo', 'superior_incompleto', 'superior_completo', 'pos_graduacao'] as const;
function cadastroSintetico(t: number, p: number): Partial<CadastroComplementar> | null {
  if (p % 5 === 4) return null;
  const endereco = p % 2 === 0;
  return {
    cpf: p % 3 === 0 ? null : cpfSintetico(t, p),
    nomeSocial: p % 10 === 1 ? `Social ${p} ${slugDo(t)}` : null,
    identidadeGenero: IDENTIDADES[p % IDENTIDADES.length],
    estadoCivil: p % 7 === 0 ? null : ESTADOS[p % ESTADOS.length],
    escolaridade: ESCOLAS[p % ESCOLAS.length],
    ocupacao: 'Analista de carga',
    nacionalidade: 'brasileira',
    naturalidade: 'São Paulo (SP)',
    telefoneFixo: `+5511${String(30_000_000 + t * 1_000 + p)}`,
    cep: endereco ? '01310100' : null,
    logradouro: endereco ? 'Avenida da Carga' : null,
    numero: endereco ? String(p + 1) : null,
    complemento: null,
    bairro: endereco ? 'Centro' : null,
    cidade: endereco ? 'São Paulo' : null,
    uf: endereco ? 'SP' : null,
    observacao: p % 4 === 0 ? 'Paciente sintético da pilha de carga.' : null,
  };
}
/**
 * Pelo `gravarCadastro` da tela (validação dos CHECKs e pré-checagem do CPF sob trava, D23), na sessão da nutricionista:
 * upsert em (tenant_id, patient_id), nunca DELETE (gatilho patient_cadastro_sem_apagar). `pacientes[p]` é o paciente `p`.
 */
async function semearCadastro(ctx: TenantContext, t: number, pacientes: string[]): Promise<number> {
  return withTenant(
    ctx,
    async (tx) => {
      let n = 0;
      for (const [p, patientId] of pacientes.entries()) {
        const valor = cadastroSintetico(t, p);
        if (!valor) continue;
        await gravarCadastro(tx, { tenantId: ctx.tenantId, patientId, valor, now: agora });
        n++;
      }
      return n;
    },
    db,
  );
}

// Plano 18 (CS-263, RNF-260, R-270): o registro clínico que as 8 seções do Início leem (antropometria, gasto energético,
// anamneses, atendimentos, exames, exames enviados e documentos; o plano alimentar vem dos planos publicados abaixo).
// Sem ele, 7 das 8 consultas iriam a tabelas vazias e o p95 do Início sairia baixo sem medir o risco. Determinístico por
// paciente: os 50 da sessão da nutricionista (os que o k6 abre) com o histórico de um acompanhamento — 1 em 10 sem nenhum
// registro (paciente novo, seções vazias) —, e metade dos outros 250 com pouco, para os índices
// (`anthropometry_paciente_data_idx`, `consultations_paciente_data_idx` e equivalentes) trabalharem com o consultório cheio.
const NA_SESSAO = 50; // ids.slice(0, 50) de `sessoes.nutris[].pacientes`
const diaAntes = (dias: number) => new Date(agora.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);
const FORMULAS = ['mifflin', 'harris_benedict', 'fao_oms'] as const;
const EXAMES = ['Hemograma', 'Glicemia de jejum', 'Perfil lipídico', 'TSH'] as const;
function registrosDe(p: number) {
  if (p < NA_SESSAO) {
    if (p % 10 === 9) return { antropometria: 0, atendimentos: 0, gasto: 0, anamneses: 0, exames: 0, envios: 0, documentos: 0 };
    return { antropometria: 4 + (p % 9), atendimentos: 3 + (p % 6), gasto: 1 + (p % 3), anamneses: 1 + (p % 2), exames: 2 + (p % 4), envios: p % 3 === 0 ? 1 + (p % 2) : 0, documentos: p % 4 === 0 ? 1 : 0 };
  }
  const algum = p % 2 === 0;
  return { antropometria: algum ? 2 : 0, atendimentos: algum ? 1 : 0, gasto: 0, anamneses: 0, exames: p % 6 === 0 ? 1 : 0, envios: 0, documentos: 0 };
}
/**
 * Grava o registro clínico do consultório na sessão da nutricionista (as escritas passam pelo gatilho de auditoria, como
 * na tela). Envios do paciente pelo caminho legal das transições (`envioNoBanco`: "Recusado" pela nutricionista ou
 * "Expirado" pelo worker, sem arquivo) e documentos em rascunho (`documentoNoBanco`: sem PDF, nada em `stored_files`).
 * Uma vez por consultório: se já houver antropometria, não grava nada (segunda rodada da semente). Devolve as linhas gravadas.
 */
async function semearRegistros(ctx: TenantContext, pacientes: string[]): Promise<number> {
  const ja = await withTenant(ctx, async (tx) => (await tx.select({ id: anthropometry.id }).from(anthropometry).limit(1)).length > 0, db);
  if (ja) return 0;
  const tenantId = ctx.tenantId;
  const linhas = {
    antropometria: [] as (typeof anthropometry.$inferInsert)[],
    atendimentos: [] as (typeof consultations.$inferInsert)[],
    gasto: [] as (typeof energyCalcs.$inferInsert)[],
    anamneses: [] as (typeof anamneses.$inferInsert)[],
    exames: [] as (typeof exams.$inferInsert)[],
  };
  const extras: { patientId: string; p: number; envios: number; documentos: number }[] = [];
  for (const [p, patientId] of pacientes.entries()) {
    const r = registrosDe(p);
    const sexo = p % 2 ? 'F' : 'M'; // o mesmo do cadastro do paciente (insert de `patients` abaixo)
    for (let i = 0; i < r.antropometria; i++) {
      const data = diaAntes(i * 21 + (p % 5) + 1);
      linhas.antropometria.push({ tenantId, patientId, data, pesoKg: 60 + (p % 30) + i * 0.4, alturaCm: 150 + (p % 40), createdAt: meioDia(data) });
    }
    for (let i = 0; i < r.atendimentos; i++) {
      const data = diaAntes(i * 28 + (p % 3) + 1);
      linhas.atendimentos.push({ tenantId, patientId, data, orientacoesPaciente: 'Orientações sintéticas da pilha de carga.', createdAt: meioDia(data) });
    }
    for (let i = 0; i < r.gasto; i++) {
      const criado = meioDia(diaAntes(i * 60 + 2));
      linhas.gasto.push({ tenantId, patientId, formula: FORMULAS[(p + i) % FORMULAS.length], pesoKg: 70, alturaCm: 165, idade: 36, sexo, fatorAtividade: 1.4, tmb: 1450.5, get: 2030.7, createdAt: criado });
    }
    for (let i = 0; i < r.exames; i++) {
      const data = diaAntes(i * 45 + 3);
      linhas.exames.push({ tenantId, patientId, data, titulo: EXAMES[(p + i) % EXAMES.length], valores: [{ nome: 'Glicose', valor: 88 + (p % 10), unidade: 'mg/dL', referencia: '70 a 99' }], createdAt: meioDia(data) });
    }
    if (r.anamneses || r.envios || r.documentos) extras.push({ patientId, p, envios: r.envios, documentos: r.documentos });
  }
  const gravadas = await withTenant(
    ctx,
    async (tx) => {
      await garantirModeloPadrao(tx, tenantId); // o "Anamnese geral" que a tela usa (anamneses guardam o snapshot)
      const [modelo] = await tx.select().from(anamnesisTemplates).where(and(eq(anamnesisTemplates.padrao, true), eq(anamnesisTemplates.finalidade, 'anamnese')));
      for (const e of extras) {
        for (let i = 0; i < registrosDe(e.p).anamneses; i++) {
          const data = diaAntes(i * 90 + 2);
          linhas.anamneses.push({ tenantId, patientId: e.patientId, templateId: modelo.id, templateSnapshot: { nome: modelo.nome, perguntas: modelo.schema.perguntas }, data, createdAt: meioDia(data) });
        }
      }
      let n = 0;
      const lote = async <T>(valores: T[], inserir: (parte: T[]) => Promise<unknown>) => {
        for (let i = 0; i < valores.length; i += 1000) await inserir(valores.slice(i, i + 1000));
        n += valores.length;
      };
      await lote(linhas.antropometria, (v) => tx.insert(anthropometry).values(v));
      await lote(linhas.atendimentos, (v) => tx.insert(consultations).values(v));
      await lote(linhas.gasto, (v) => tx.insert(energyCalcs).values(v));
      await lote(linhas.anamneses, (v) => tx.insert(anamneses).values(v));
      await lote(linhas.exames, (v) => tx.insert(exams).values(v));
      return n;
    },
    db,
  );
  let outras = 0;
  for (const e of extras) {
    for (let i = 0; i < e.envios; i++) {
      const recusado = (e.p + i) % 2 === 0;
      await envioNoBanco(db, ctx, e.patientId, {
        status: recusado ? 'recusado' : 'expirado',
        ...(recusado ? { motivoRecusa: 'ilegivel' } : {}),
        nome: EXAMES[(e.p + i) % EXAMES.length],
        dataColeta: diaAntes(i * 30 + 10),
        createdAt: meioDia(diaAntes(i * 30 + 8)),
      });
      outras++;
    }
    for (let i = 0; i < e.documentos; i++) {
      await documentoNoBanco(db, ctx, e.patientId, { status: 'rascunho', tipo: e.p % 8 === 0 ? 'parecer' : 'receita' });
      outras++;
    }
  }
  return gravadas + outras;
}
// D20 do Plano 10A e D18 do Plano 12: documentos liberados e recebimento de exames ligado, para as 8 seções do Início
// serem consultadas (como num consultório que usa tudo); só a admin muda, então fora de withTenant, como o insert do tenant
const TUDO_LIGADO = { documentosLiberados: true, examesPacienteAtivadoEm: agora } as const;

// Segunda rodada na mesma pilha: o cadastro (upsert), pelos mesmos índices (o `p` do e-mail `p<p>-<slug>@carga.test`), e o
// registro clínico só se o consultório ainda não tiver (pilha semeada antes da P18-12b)
const [jaSemeado] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slugDo(0)));
if (jaSemeado) {
  for (let t = 0; t < TENANTS; t++) {
    const slug = slugDo(t);
    const [tn] = await db.select({ id: tenants.id, documentosLiberados: tenants.documentosLiberados, examesPacienteAtivadoEm: tenants.examesPacienteAtivadoEm }).from(tenants).where(eq(tenants.slug, slug));
    const [nutri] = await db.select({ id: user.id }).from(user).where(eq(user.email, `nutri-${slug}@carga.test`));
    if (!tn || !nutri) throw new Error(`${slug} não está na pilha: semente incompleta, recrie a pilha (down -v) e rode de novo`);
    if (!tn.documentosLiberados || !tn.examesPacienteAtivadoEm) await db.update(tenants).set(TUDO_LIGADO).where(eq(tenants.id, tn.id));
    const ctx: TenantContext = { tenantId: tn.id, role: 'nutri', actorUserId: nutri.id, ip: '127.0.0.1' };
    const linhas = await withTenant(ctx, (tx) => tx.select({ id: patients.id, email: patients.email }).from(patients), db);
    const pacientes: string[] = [];
    for (const l of linhas) {
      const m = new RegExp(`^p(\\d+)-${slug}@carga\\.test$`).exec(l.email);
      if (m) pacientes[Number(m[1])] = l.id;
    }
    if (pacientes.length !== PACIENTES || Object.keys(pacientes).length !== PACIENTES) throw new Error(`${slug}: pacientes diferentes de CARGA_PACIENTES`);
    const comCadastro = await semearCadastro(ctx, t, pacientes);
    console.log(`${slug}: cadastro de ${comCadastro} pacientes (upsert), ${await semearRegistros(ctx, pacientes)} registros clínicos novos`);
  }
  await stopBoss();
  await pool.end();
  console.log('pronto: cadastro refeito e registro clínico conferido (a pilha já estava semeada; .sessoes.json mantido)');
  process.exit(0);
}

for (let t = 0; t < TENANTS; t++) {
  const slug = slugDo(t);
  const [tn] = await db.insert(tenants).values({ slug, nomeExibicao: `Consultório Carga ${t}`, dpaVersao: DPA_VERSAO, dpaAceitoEm: agora, agendamentoPublicoAtivo: true, ...TUDO_LIGADO }).returning({ id: tenants.id });
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
  const comCadastro = await semearCadastro(ctx, t, ids.map((x) => x.id));
  const registros = await semearRegistros(ctx, ids.map((x) => x.id));

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
  sessoes.nutris.push({ cookie: await entrar(auth, emailNutri), pacientes: ids.slice(0, 50).map((x) => x.id), planos });
  sessoes.slugs.push(slug);
  console.log(`${slug}: ${PACIENTES} pacientes (${comCadastro} com cadastro), ${registros} registros clínicos, ${acessos.length} acessos, 100 conteúdos`);
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
