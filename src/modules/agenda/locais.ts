import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation, uniqueViolation } from '@/db/errors';
import { locaisAtendimento, tenants, TIPOS_DE_LOCAL, type LocalRow, type TenantRow, type TipoDeLocal } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { idValido } from '@/modules/pacientes/base';
import { MSG_LOCAIS } from './constantes';
import type { LocalVisivel } from './horarios';

/**
 * Plano 23 (US-400, RN-400 a RN-407, RN-410a): locais de atendimento do consultório. O CRUD é só da sessão `nutri` (a função
 * confere o papel antes de abrir a transação, RN-400); o portal e a página pública leem só pelas projeções SQL
 * (`locaisParaAgendamento`, `localDaConsulta`), sem a sala (RN-406). Nenhum texto do local (nome, endereço, sala) vai para
 * mensagem de erro ou log (regra 3): os erros levam só as mensagens fixas de `MSG_LOCAIS`.
 */

export class LocalError extends Error {
  override name = 'LocalError';
  constructor(readonly erros: Record<string, string>) {
    super('Local de atendimento inválido');
  }
}

export type LocalNaTela = Pick<LocalRow, 'id' | 'nome' | 'tipo' | 'endereco' | 'cidade' | 'mostrarEndereco' | 'linkSala' | 'agendamentoOnline' | 'principal' | 'arquivadoEm'> & {
  /** Há consulta, regra ou pedido no local: não se exclui (FK NO ACTION) e o tipo não muda (FK composta, RN-401). */
  emUso: boolean;
};

/** Projeção para o portal e a página pública (AG-D62): sem a sala; `nome` e `cidade` nulos no local sem agendamento. */
export type LocalProjetado = { id: string; nome: string | null; tipo: TipoDeLocal; cidade: string | null; endereco: string | null; principal: boolean; agendamentoOnline: boolean; criadoEm: Date };

/** O local de uma consulta do próprio paciente (`app_local_da_consulta`): nunca a sala. */
export type LocalDaConsulta = Pick<LocalProjetado, 'nome' | 'tipo' | 'cidade' | 'endereco'>;

type Deps = { db?: Db };

/** O nome do local que a migration e `garantirLocaisIniciais` criam para o link padrão do Perfil (AG-D6, P23-I1). */
const NOME_VIDEOCONFERENCIA = 'Videoconferência';

function exigirNutri(ctx: TenantContext): void {
  if (ctx.role !== 'nutri') throw new Error('locais de atendimento: só a sessão da nutricionista');
}

/** Uma escrita de local por vez no consultório (principal único, nome único, primeiro local, locais iniciais). */
const travarLocais = (tx: Tx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-locais'), hashtext(${tenantId}))`);

const ORDEM = [desc(locaisAtendimento.principal), asc(locaisAtendimento.createdAt), asc(locaisAtendimento.id)];

/**
 * Há consulta, regra ou pedido (de pessoa nova) neste local. Correlacionado pelo nome da tabela externa (o Drizzle escreve a
 * coluna sem a tabela numa consulta de uma tabela só, e `"id"` dentro do subselect seria o id da tabela de dentro).
 */
const EM_USO = sql<boolean>`(
  exists (select 1 from appointments a where a.tenant_id = locais_atendimento.tenant_id and a.local_id = locais_atendimento.id)
  or exists (select 1 from availability_rules r where r.tenant_id = locais_atendimento.tenant_id and r.local_id = locais_atendimento.id)
  or exists (select 1 from public_booking_requests p where p.tenant_id = locais_atendimento.tenant_id and p.local_id = locais_atendimento.id)
)`;

const COLUNAS_NA_TELA = {
  id: locaisAtendimento.id,
  nome: locaisAtendimento.nome,
  tipo: locaisAtendimento.tipo,
  endereco: locaisAtendimento.endereco,
  cidade: locaisAtendimento.cidade,
  mostrarEndereco: locaisAtendimento.mostrarEndereco,
  linkSala: locaisAtendimento.linkSala,
  agendamentoOnline: locaisAtendimento.agendamentoOnline,
  principal: locaisAtendimento.principal,
  arquivadoEm: locaisAtendimento.arquivadoEm,
  emUso: EM_USO,
};

async function lerLocal(tx: Tx, id: string): Promise<(LocalRow & { emUso: boolean }) | undefined> {
  const [l] = await tx.select({ local: locaisAtendimento, emUso: EM_USO }).from(locaisAtendimento).where(eq(locaisAtendimento.id, id));
  return l ? { ...l.local, emUso: l.emUso } : undefined;
}

/** RN-401: nome único entre os não arquivados, sem diferença de maiúsculas (a comparação no JS não depende do `lc_ctype`). */
async function nomeEmUso(tx: Tx, nome: string, exceto: string | null): Promise<boolean> {
  const ativos = await tx.select({ id: locaisAtendimento.id, nome: locaisAtendimento.nome }).from(locaisAtendimento).where(isNull(locaisAtendimento.arquivadoEm));
  const alvo = nome.toLocaleLowerCase('pt-BR');
  return ativos.some((l) => l.id !== exceto && l.nome.toLocaleLowerCase('pt-BR') === alvo);
}

const naoEncontrado = () => new LocalError({ geral: MSG_LOCAIS.naoEncontrado });

/**
 * AG-D45 / RN-410a: garante, na sessão `nutri`, pelo menos o "Consultório" (principal, presencial, com agendamento e o
 * endereço do Perfil) no consultório sem nenhum local, e aplica às regras sem local o backfill da migration 0127 (bloco
 * P23-BACKFILL, na mesma ordem de escolha do local: principal, depois o mais antigo): "ambas" vira presencial e ganha a
 * cópia online quando há local online ativo; presencial e online vão para o local ativo do tipo; a online sem local online
 * espera. Idempotente; sem trabalho a fazer, não trava nada (é chamada a cada abertura do Início do painel). Chamadores:
 * `lerInicio`, `listarHorarios`/`criarRegra` (disponibilidade.ts), `listarLocais`, `locaisDoPainel` (Nova consulta e Alterar) e,
 * na T5, a Agenda.
 */
export async function garantirLocaisIniciais(tx: Tx, tenant: Pick<TenantRow, 'id' | 'enderecoConsultorio'>): Promise<void> {
  const pendente = async () =>
    (
      await tx.execute<{ sem_local: boolean; regra_sem_local: boolean }>(sql`select
        not exists (select 1 from locais_atendimento where tenant_id = ${tenant.id}) as sem_local,
        exists (select 1 from availability_rules where tenant_id = ${tenant.id} and local_id is null) as regra_sem_local`)
    ).rows[0];
  if (!Object.values(await pendente()).some(Boolean)) return;
  await travarLocais(tx, tenant.id);
  const p = await pendente(); // de novo sob a trava: outra transação pode ter acabado de criar
  if (p.sem_local) {
    const endereco = normalizarTexto(tenant.enderecoConsultorio).slice(0, 300) || null;
    await tx.insert(locaisAtendimento).values({ tenantId: tenant.id, nome: 'Consultório', tipo: 'presencial', endereco, agendamentoOnline: true, principal: true });
  }
  if (!p.regra_sem_local) return;
  // a mesma trava das gravações de regra (disponibilidade.ts): a "ambas" não some entre a cópia e o UPDATE
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-regras'), hashtext(${tenant.id}))`);
  const primeiro = (tipo: TipoDeLocal) =>
    sql`(select l.id from locais_atendimento l where l.tenant_id = ${tenant.id} and l.tipo = ${tipo} and l.arquivado_em is null order by l.principal desc, l.created_at, l.id limit 1)`;
  // "ambas" com os dois tipos de local: a cópia online (a original vira presencial logo abaixo)
  await tx.execute(sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade, local_id, created_at, updated_at)
    select r.tenant_id, r.dia_semana, r.inicio, r.fim, r.duracao_min, 'online', ${primeiro('online')}, r.created_at, now()
      from availability_rules r
     where r.tenant_id = ${tenant.id} and r.local_id is null and r.modalidade = 'ambas'
       and ${primeiro('presencial')} is not null and ${primeiro('online')} is not null`);
  await tx.execute(sql`update availability_rules set modalidade = 'presencial', local_id = ${primeiro('presencial')}, updated_at = now()
     where tenant_id = ${tenant.id} and local_id is null and modalidade in ('presencial', 'ambas') and ${primeiro('presencial')} is not null`);
  // o que sobrou: online, e "ambas" de consultório sem local presencial ativo (vira online, como na migration)
  await tx.execute(sql`update availability_rules set modalidade = 'online', local_id = ${primeiro('online')}, updated_at = now()
     where tenant_id = ${tenant.id} and local_id is null and modalidade in ('online', 'ambas') and ${primeiro('online')} is not null`);
}

/**
 * Tela "Locais de atendimento". Garante os locais iniciais antes de ler (AG-D45). `avisoLinkDivergente` (RN-410a, P23-I1):
 * o Perfil anterior ao PR 2 editou o link padrão depois da migration, e ele não bate mais com a sala do local
 * "Videoconferência".
 */
export async function listarLocais(ctx: TenantContext, o: { arquivados: boolean }, deps: Deps = {}): Promise<{ locais: LocalNaTela[]; avisoLinkDivergente: boolean }> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx
        .select({ id: tenants.id, enderecoConsultorio: tenants.enderecoConsultorio, linkOnlinePadrao: tenants.linkOnlinePadrao })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));
      await garantirLocaisIniciais(tx, t);
      const locais = await tx
        .select(COLUNAS_NA_TELA)
        .from(locaisAtendimento)
        .where(o.arquivados ? isNotNull(locaisAtendimento.arquivadoEm) : isNull(locaisAtendimento.arquivadoEm))
        .orderBy(...ORDEM);
      const link = t.linkOnlinePadrao?.trim() || null;
      let avisoLinkDivergente = false;
      if (link) {
        const [video] = await tx
          .select({ linkSala: locaisAtendimento.linkSala })
          .from(locaisAtendimento)
          .where(and(eq(locaisAtendimento.tipo, 'online'), eq(locaisAtendimento.nome, NOME_VIDEOCONFERENCIA), isNull(locaisAtendimento.arquivadoEm)));
        avisoLinkDivergente = !!video && video.linkSala !== link;
      }
      return { locais, avisoLinkDivergente };
    },
    deps.db ?? getDb(),
  );
}

const ehTipo = (v: unknown): v is TipoDeLocal => typeof v === 'string' && (TIPOS_DE_LOCAL as readonly string[]).includes(v);
const marcado = (v: unknown) => v === 'on' || v === true;
const tamanho = (s: string) => [...s].length; // como o char_length do CHECK (pontos de código)

/** SUS-109: sem NUL (22021, com o texto no log) nem surrogate sem par (o driver trocaria por U+FFFD), antes de normalizar. */
const textoDoCampo = (v: unknown) => normalizarTexto(typeof v === 'string' ? semInvalidosNoBanco(v) : v);

type Valores = { nome: string; tipo: TipoDeLocal; endereco: string | null; cidade: string | null; mostrarEndereco: boolean; linkSala: string | null; agendamentoOnline: boolean };

/** RN-401 / RN-405: valida o formulário. No online, endereço, cidade e "mostrar o endereço" são ignorados; no presencial, a sala. */
function validar(input: Record<string, unknown>, tipo: unknown): { ok: true; v: Valores } | { ok: false; erros: Record<string, string> } {
  const erros: Record<string, string> = {};
  const nome = textoDoCampo(input.nome);
  if (tamanho(nome) < 2 || tamanho(nome) > 60) erros.nome = MSG_LOCAIS.nomeTamanho;
  if (!ehTipo(tipo)) return { ok: false, erros: { ...erros, tipo: MSG_LOCAIS.tipo } };
  const agendamentoOnline = marcado(input.agendamentoOnline);
  let v: Valores;
  if (tipo === 'presencial') {
    const endereco = textoDoCampo(input.endereco) || null;
    const cidade = textoDoCampo(input.cidade) || null;
    if (endereco && tamanho(endereco) > 300) erros.endereco = MSG_LOCAIS.enderecoLongo;
    if (cidade && tamanho(cidade) > 80) erros.cidade = MSG_LOCAIS.cidadeLonga;
    v = { nome, tipo, endereco, cidade, mostrarEndereco: marcado(input.mostrarEndereco), linkSala: null, agendamentoOnline };
  } else {
    const linkSala = (typeof input.linkSala === 'string' ? input.linkSala.trim() : '') || null;
    // como appointments_link_online e o CHECK locais_atendimento_link_sala: https://, sem espaço, até 500
    // SUS-109: link com NUL ou surrogate sem par é link inválido (limpar trocaria o endereço da sala em silêncio)
    if (linkSala && tamanho(linkSala) > 500) erros.linkSala = MSG_LOCAIS.linkLongo;
    else if (linkSala && (semInvalidosNoBanco(linkSala) !== linkSala || !(/^https:\/\/\S+$/.test(linkSala) && URL.canParse(linkSala)))) erros.linkSala = MSG_LOCAIS.link;
    else if (!linkSala && agendamentoOnline) erros.agendamentoOnline = MSG_LOCAIS.agendamentoSemSala;
    v = { nome, tipo, endereco: null, cidade: null, mostrarEndereco: false, linkSala, agendamentoOnline };
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, v };
}

/**
 * Cria (`id` nulo) ou edita um local ativo. Sem o campo `tipo` na edição (a tela mostra o tipo como texto quando o local
 * está em uso), vale o gravado. O primeiro local de um consultório sem principal vira o principal.
 */
export async function salvarLocal(ctx: TenantContext, id: string | null, input: Record<string, unknown>, deps: Deps = {}): Promise<{ id: string }> {
  exigirNutri(ctx);
  if (id !== null && !idValido(id)) throw naoEncontrado();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await travarLocais(tx, ctx.tenantId);
        const atual = id ? await lerLocal(tx, id) : undefined;
        if (id && (!atual || atual.arquivadoEm)) throw naoEncontrado();
        const tipo = input.tipo === undefined ? atual?.tipo : input.tipo;
        const r = validar(input, tipo);
        if (!r.ok) throw new LocalError(r.erros);
        const { v } = r;
        if (atual && atual.tipo !== v.tipo && atual.emUso) throw new LocalError({ tipo: MSG_LOCAIS.tipoFixo });
        if (await nomeEmUso(tx, v.nome, id)) throw new LocalError({ nome: MSG_LOCAIS.nomeRepetido });
        const agora = new Date();
        if (atual) {
          await tx.update(locaisAtendimento).set({ ...v, updatedAt: agora }).where(eq(locaisAtendimento.id, atual.id));
          return { id: atual.id };
        }
        const [principal] = await tx.select({ id: locaisAtendimento.id }).from(locaisAtendimento).where(and(eq(locaisAtendimento.principal, true), isNull(locaisAtendimento.arquivadoEm)));
        const [n] = await tx
          .insert(locaisAtendimento)
          .values({ tenantId: ctx.tenantId, ...v, principal: !principal, createdAt: agora, updatedAt: agora })
          .returning({ id: locaisAtendimento.id });
        return { id: n.id };
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'locais_atendimento_nome_unique') throw new LocalError({ nome: MSG_LOCAIS.nomeRepetido });
    if (fkViolation(e) !== null) throw new LocalError({ tipo: MSG_LOCAIS.tipoFixo }); // o uso nasceu entre a conferência e o UPDATE
    throw e;
  }
}

/** RN-402: "Definir como principal" tira o antigo e põe o novo na mesma transação; o arquivado não vira principal. */
export async function definirPrincipal(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(id)) throw naoEncontrado();
  await withTenant(
    ctx,
    async (tx) => {
      await travarLocais(tx, ctx.tenantId);
      const l = await lerLocal(tx, id);
      if (!l || l.arquivadoEm) throw naoEncontrado();
      if (l.principal) return;
      const agora = new Date();
      await tx.update(locaisAtendimento).set({ principal: false, updatedAt: agora }).where(and(eq(locaisAtendimento.principal, true), isNull(locaisAtendimento.arquivadoEm)));
      await tx.update(locaisAtendimento).set({ principal: true, updatedAt: agora }).where(eq(locaisAtendimento.id, id));
    },
    deps.db ?? getDb(),
  );
}

/** RN-402 / RN-403: o principal não se arquiva; arquivar desliga o agendamento pelo paciente na mesma gravação (CHECK). */
export async function arquivarLocal(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(id)) throw naoEncontrado();
  await withTenant(
    ctx,
    async (tx) => {
      await travarLocais(tx, ctx.tenantId);
      const l = await lerLocal(tx, id);
      if (!l || l.arquivadoEm) throw naoEncontrado();
      if (l.principal) throw new LocalError({ geral: MSG_LOCAIS.principalNaoArquiva });
      const agora = new Date();
      await tx.update(locaisAtendimento).set({ arquivadoEm: agora, agendamentoOnline: false, updatedAt: agora }).where(eq(locaisAtendimento.id, id));
    },
    deps.db ?? getDb(),
  );
}

/** RN-403: "Reativar" devolve o local, sem o agendamento pelo paciente (a nutricionista liga de novo, se quiser). */
export async function reativarLocal(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(id)) throw naoEncontrado();
  try {
    await withTenant(
      ctx,
      async (tx) => {
        await travarLocais(tx, ctx.tenantId);
        const l = await lerLocal(tx, id);
        if (!l) throw naoEncontrado();
        if (!l.arquivadoEm) return;
        if (await nomeEmUso(tx, l.nome, l.id)) throw new LocalError({ geral: MSG_LOCAIS.nomeRepetido });
        await tx.update(locaisAtendimento).set({ arquivadoEm: null, updatedAt: new Date() }).where(eq(locaisAtendimento.id, id));
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'locais_atendimento_nome_unique') throw new LocalError({ geral: MSG_LOCAIS.nomeRepetido });
    throw e;
  }
}

/** RN-403: só sai o local sem nenhum uso (e nunca o principal); o uso que nasce numa corrida cai na FK (23503) e dá a mesma mensagem. */
export async function excluirLocal(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  if (!idValido(id)) throw naoEncontrado();
  try {
    await withTenant(
      ctx,
      async (tx) => {
        await travarLocais(tx, ctx.tenantId);
        const l = await lerLocal(tx, id);
        if (!l) throw naoEncontrado();
        if (l.principal) throw new LocalError({ geral: MSG_LOCAIS.principalNaoArquiva });
        if (l.emUso) throw new LocalError({ geral: MSG_LOCAIS.emUso });
        await tx.delete(locaisAtendimento).where(eq(locaisAtendimento.id, id));
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (fkViolation(e) !== null) throw new LocalError({ geral: MSG_LOCAIS.emUso });
    throw e;
  }
}

/** O que os seletores de local do painel mostram (Nova consulta, Alterar, Horários). A sala só vai à tela da equipe. */
export type LocalDoSeletor = Pick<LocalRow, 'id' | 'nome' | 'linkSala' | 'principal'> & { tipo: TipoDeLocal };

/**
 * AG-D45 / RN-407: os locais ativos para os seletores do painel, o principal primeiro, depois de garantir os locais iniciais
 * (e o local das regras antigas). Só a sessão `nutri` (nunca passar a sala a um componente do portal).
 */
export async function locaisDoPainel(ctx: TenantContext, deps: Deps = {}): Promise<LocalDoSeletor[]> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx.select({ id: tenants.id, enderecoConsultorio: tenants.enderecoConsultorio }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      if (t) await garantirLocaisIniciais(tx, t);
      return locaisDoSeletor(tx);
    },
    deps.db ?? getDb(),
  );
}

/** `locaisAtivos` no formato dos seletores do painel, na transação de quem chama (sessão `nutri`). */
export async function locaisDoSeletor(tx: Tx): Promise<LocalDoSeletor[]> {
  return (await locaisAtivos(tx)).map(({ id, nome, tipo, linkSala, principal }) => ({ id, nome, tipo: tipo as TipoDeLocal, linkSala, principal }));
}

/** Plano 23 (US-415, US-416): uma opção do filtro "Local" fora da agenda — só id e nome (nunca a sala nem o endereço). */
export type LocalDoFiltro = { id: string; nome: string };

/**
 * Plano 23 (US-415, US-416): as opções do filtro "Local" da lista de pacientes e do Financeiro, como as da agenda (a
 * mesma ordem; os ativos e o escolhido, mesmo arquivado — o filtro de um local arquivado continua aparecendo escolhido).
 * Não cria os locais iniciais (é só leitura). Id inválido no `selecionado` é ignorado.
 */
export async function locaisParaFiltro(ctx: TenantContext, selecionado?: string, deps: Deps = {}): Promise<LocalDoFiltro[]> {
  exigirNutri(ctx);
  return withTenant(ctx, (tx) => locaisDoFiltro(tx, selecionado), deps.db ?? getDb());
}

/** `locaisParaFiltro` na transação de quem chama (sessão `nutri`: as telas do Financeiro, RNF-301). */
export function locaisDoFiltro(tx: Tx, selecionado?: string): Promise<LocalDoFiltro[]> {
  const ativo = isNull(locaisAtendimento.arquivadoEm);
  return tx
    .select({ id: locaisAtendimento.id, nome: locaisAtendimento.nome })
    .from(locaisAtendimento)
    .where(idValido(selecionado) ? or(ativo, eq(locaisAtendimento.id, selecionado)) : ativo)
    .orderBy(...ORDEM);
}

/** Locais ativos, o principal primeiro (sessão `nutri`: seletores do painel). */
export function locaisAtivos(tx: Tx): Promise<LocalRow[]> {
  return tx.select().from(locaisAtendimento).where(isNull(locaisAtendimento.arquivadoEm)).orderBy(...ORDEM);
}

/**
 * Sessões `publico` e `paciente`: todos os locais ativos pela projeção `app_locais_para_agendamento()` (AG-D62), sem a sala.
 * O recorte por `agendamentoOnline` vem depois da atribuição das regras sem local (RN-410a). Fora desses papéis, vazio.
 */
export async function locaisParaAgendamento(tx: Tx): Promise<LocalProjetado[]> {
  const r = await tx.execute<{ id: string; nome: string | null; tipo: TipoDeLocal; cidade: string | null; endereco: string | null; principal: boolean; agendamento_online: boolean; criado_em: Date | string }>(
    sql`select id, nome, tipo, cidade, endereco, principal, agendamento_online, criado_em from app_locais_para_agendamento()`,
  );
  return r.rows.map((l) => ({ id: l.id, nome: l.nome, tipo: l.tipo, cidade: l.cidade, endereco: l.endereco, principal: l.principal, agendamentoOnline: l.agendamento_online, criadoEm: new Date(l.criado_em) }));
}

/**
 * Plano 23 (US-403, RN-405): os locais que a escolha do portal, da página pública e do link mostra — os ativos com "Aceita
 * agendamento pelo paciente", na ordem da projeção (principal → `created_at`), só com nome, tipo, cidade e o endereço que a
 * projeção liberou. Lista fechada de chaves: nada além disso vai ao navegador.
 */
export function locaisVisiveis(ls: LocalProjetado[]): LocalVisivel[] {
  return ls.flatMap((l) => (l.agendamentoOnline && l.nome ? [{ id: l.id, nome: l.nome, tipo: l.tipo, cidade: l.cidade, endereco: l.endereco }] : []));
}

/**
 * Plano 23 (RN-407, US-402): o local que o paciente vê na própria consulta (portal e link) — o nome e o endereço do local
 * (`localDaConsulta`); a consulta antiga, sem local, mostra o endereço do Perfil, como antes (só a presencial). Nunca a sala.
 */
export function localParaOPaciente(l: LocalDaConsulta | null, c: { localId: string | null; modalidade: string }, enderecoDoPerfil: string | null): { nome: string | null; endereco: string | null } {
  if (c.localId && l) return { nome: l.nome, endereco: l.tipo === 'presencial' ? l.endereco : null };
  return { nome: null, endereco: c.modalidade === 'presencial' ? enderecoDoPerfil : null };
}

/** Sessão de paciente: o local de uma consulta dele (`app_local_da_consulta`), ou nulo. */
export async function localDaConsulta(tx: Tx, appointmentId: string): Promise<LocalDaConsulta | null> {
  if (!idValido(appointmentId)) return null;
  const r = await tx.execute<LocalDaConsulta>(sql`select nome, tipo, cidade, endereco from app_local_da_consulta(${appointmentId}::uuid)`);
  const l = r.rows[0];
  return l ? { nome: l.nome, tipo: l.tipo, cidade: l.cidade, endereco: l.endereco } : null;
}

/** O link que a consulta num local herda por sugestão: a sala fixa do local online, se houver. */
export function linkSugerido(local: Pick<LocalRow, 'tipo' | 'linkSala'>): string | null {
  return local.tipo === 'online' && local.linkSala ? local.linkSala : null;
}
