import { and, count, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { diaryEntries, mealPlans, meals, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { getBoss } from '@/jobs/boss';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import {
  ehRespostaDoDiario,
  FOTO_DIARIO_MAX_BYTES,
  LIMITE_DIARIO_POR_DIA,
  MSG_DIARIO,
  refeicaoDoDiario,
  REFEICOES_DO_DIARIO,
  type RespostaDoDiario,
  rotuloDaRefeicao,
  TEXTO_DIARIO_MAX,
} from './diario-constantes';
import { pacienteDaSessao } from './sessao';

export class DiarioError extends Error {
  override name = 'DiarioError';
  constructor(readonly erros: Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>>) {
    super('Registro do diário inválido');
  }
}

export type RegistroDoDiario = {
  id: string;
  dataHora: Date;
  refeicao: string;
  texto: string | null;
  foto: { estado: 'sem_foto' | 'processando' | 'falhou' } | { estado: 'pronta'; caminho: string };
  comentario: string | null;
  comentadoEm: Date | null;
  /** Plano 16 (RN-197): resposta à refeição do plano e a cópia "{nome} · {HH:MM}"; null = registro comum. */
  resposta: RespostaDoDiario | null;
  refeicaoDoPlano: string | null;
};

type Deps = { db?: Db; agora?: Date; dataDir?: string; boss?: PgBoss };

/** D12: trava o paciente (a corrida do 11º registro e a da resposta repetida). Fora de "ativo" (RN-08) não registra. */
async function travarPaciente(tx: Tx, patientId: string): Promise<void> {
  const [p] = await tx.select({ status: patients.status }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo') throw new DiarioError({ geral: 'Conta temporariamente indisponível' });
}

/** O dia de `agora` no fuso do tenant, como intervalo [início, fim). */
function diaDe(agora: Date, fuso: string): { inicio: Date; fim: Date } {
  const hoje = partesNoFuso(agora, fuso).data;
  return { inicio: inicioDoDia(hoje, fuso), fim: inicioDoDia(somarDias(hoje, 1), fuso) };
}

/** RN-07: os registros do dia (no fuso do tenant), com o paciente já travado. */
async function conferirLimite(tx: Tx, patientId: string, fuso: string, agora: Date): Promise<void> {
  const { inicio, fim } = diaDe(agora, fuso);
  const [{ n }] = await tx
    .select({ n: count() })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.patientId, patientId), gte(diaryEntries.dataHora, inicio), lt(diaryEntries.dataHora, fim)));
  if (n >= LIMITE_DIARIO_POR_DIA) throw new DiarioError({ geral: MSG_DIARIO.limite });
}

/** Plano 16 (RN-197): a refeição do plano PUBLICADO do paciente da sessão (a RLS já esconde a dos outros); senão null. */
async function refeicaoDoPlanoPublicado(tx: Tx, patientId: string, refeicaoId: string): Promise<{ nome: string; horario: string } | null> {
  const [r] = await tx
    .select({ nome: meals.nome, horario: meals.horario })
    .from(meals)
    .innerJoin(mealPlans, and(eq(mealPlans.id, meals.planId), eq(mealPlans.tenantId, meals.tenantId)))
    .where(and(eq(meals.id, refeicaoId), eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
  return r ? { nome: r.nome, horario: r.horario ? r.horario.slice(0, 5) : '' } : null;
}

/** `refeicaoSlot` (Plano 17): o rótulo da refeição do plano escolhida, com ou sem resposta — só para o pedido do diário do worker. */
type Gravacao = { refeicao: string; resposta: RespostaDoDiario | null; refeicaoDoPlano: string | null; refeicaoSlot: string | null };

/**
 * US-042 / RN-07 e, no Plano 16, as respostas à refeição do plano (RN-197): `refeicaoId` + `resposta` ("como_no_plano"
 * dispensa texto e foto; "outra_coisa" exige um dos dois). A refeição é lida do plano publicado pela RLS e a resposta é uma
 * por refeição do plano por dia, com o paciente travado: o "Comi assim" repetido (toque duplo, outra aba) devolve o registro
 * que já existe — mesmo no limite de 10; com texto ou foto, depois de uma resposta, o registro entra como registro comum (D3).
 * A foto original (JPEG/PNG/HEIC ≤ 10 MB, tipo pelo conteúdo) entra por salvarArquivo e o registro + o job de conversão vão
 * no `registrar` (mesma transação, CLAUDE.md regra 9). Cota esgotada com texto → o texto é salvo sem a foto; só a foto → erro.
 */
export async function registrarNoDiario(
  ctx: TenantContext,
  tenant: { fuso: string },
  input: { refeicao: unknown; texto: unknown; foto: Buffer | null; refeicaoId?: unknown; resposta?: unknown },
  deps: Deps = {},
): Promise<{ id: string; semFoto: boolean; jaRegistrado: boolean }> {
  const patientId = pacienteDaSessao(ctx, 'registrarNoDiario');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const refeicaoId = typeof input.refeicaoId === 'string' && input.refeicaoId !== '' ? input.refeicaoId : null;
  const respostaBruta = input.resposta === undefined || input.resposta === null || input.resposta === '' ? null : input.resposta;
  if (respostaBruta !== null && (!ehRespostaDoDiario(respostaBruta) || !refeicaoId)) throw new DiarioError({ geral: MSG_DIARIO.formulario });
  const resposta = respostaBruta as RespostaDoDiario | null;
  if (refeicaoId && !idValido(refeicaoId)) throw new DiarioError({ geral: MSG_DIARIO.refeicaoNaoEncontrada });
  const refeicaoInformada = typeof input.refeicao === 'string' ? input.refeicao : '';
  if (!refeicaoId && !(REFEICOES_DO_DIARIO as readonly string[]).includes(refeicaoInformada)) throw new DiarioError({ refeicao: MSG_DIARIO.refeicao });
  // SUS-110 (regra 3): o NUL (22021 no `text`, com um trecho do diário no log) e o surrogate sem par (U+FFFD no banco) saem
  // em silêncio, antes de tudo — como no SUS-109; antes (F-4) o NUL era recusado com "Formulário inválido."
  const texto = typeof input.texto === 'string' ? semInvalidosNoBanco(input.texto).normalize('NFC').trim() : '';
  // Caracteres (code points), como o CHECK do banco (char_length) e a spec — não unidades UTF-16 (um emoji conta 1)
  if ([...texto].length > TEXTO_DIARIO_MAX) throw new DiarioError({ texto: MSG_DIARIO.texto });
  const foto = input.foto && input.foto.length > 0 ? input.foto : null;
  if (!texto && !foto && resposta !== 'como_no_plano') throw new DiarioError({ geral: MSG_DIARIO.vazio });
  if (foto && foto.length > FOTO_DIARIO_MAX_BYTES) throw new DiarioError({ foto: MSG_DIARIO.foto });

  /** Com o paciente travado: a refeição do plano, a resposta que vale (ou o registro que já existe) e o limite do dia. */
  const preparar = async (tx: Tx): Promise<Gravacao | { existente: string }> => {
    await travarPaciente(tx, patientId);
    let g: Gravacao = { refeicao: refeicaoInformada, resposta: null, refeicaoDoPlano: null, refeicaoSlot: null };
    if (refeicaoId) {
      const r = await refeicaoDoPlanoPublicado(tx, patientId, refeicaoId);
      if (!r) throw new DiarioError({ geral: MSG_DIARIO.refeicaoNaoEncontrada });
      const rotulo = rotuloDaRefeicao(r.nome, r.horario);
      g = { refeicao: refeicaoDoDiario(r.nome), resposta: null, refeicaoDoPlano: null, refeicaoSlot: rotulo };
      if (resposta) {
        const { inicio, fim } = diaDe(agora, tenant.fuso);
        const [ja] = await tx
          .select({ id: diaryEntries.id })
          .from(diaryEntries)
          .where(and(eq(diaryEntries.patientId, patientId), isNotNull(diaryEntries.resposta), eq(diaryEntries.refeicaoDoPlano, rotulo), gte(diaryEntries.dataHora, inicio), lt(diaryEntries.dataHora, fim)))
          .limit(1);
        if (ja && !texto && !foto) return { existente: ja.id };
        if (!ja) g = { ...g, resposta, refeicaoDoPlano: rotulo };
      }
    }
    await conferirLimite(tx, patientId, tenant.fuso, agora);
    return g;
  };

  const soTexto = () =>
    withTenant(
      ctx,
      async (tx) => {
        const g = await preparar(tx);
        if ('existente' in g) return { id: g.existente, jaRegistrado: true };
        const [e] = await tx
          .insert(diaryEntries)
          .values({ tenantId: ctx.tenantId, patientId, dataHora: agora, refeicao: g.refeicao, texto: texto || null, resposta: g.resposta, refeicaoDoPlano: g.refeicaoDoPlano, refeicaoSlot: g.refeicaoSlot, createdAt: agora, updatedAt: agora })
          .returning({ id: diaryEntries.id });
        return { id: e.id, jaRegistrado: false };
      },
      db,
    );
  if (!foto) return { ...(await soTexto()), semFoto: false };

  // Fora da transação: o start do pg-boss não pode esperar segurando a conexão (e a trava) do paciente
  const boss = deps.boss ?? (await getBoss());
  let id = '';
  let gravacao: Gravacao = { refeicao: refeicaoInformada, resposta: null, refeicaoDoPlano: null, refeicaoSlot: null };
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'diario_foto_original',
        conteudo: foto,
        permitidos: ['jpg', 'png', 'heic'],
        patientId,
        antesDaReserva: async (tx) => {
          const g = await preparar(tx);
          // com foto nunca há "existente" (só o "Comi assim" sem conteúdo é idempotente)
          if (!('existente' in g)) gravacao = g;
        },
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .insert(diaryEntries)
            .values({
              tenantId: ctx.tenantId,
              patientId,
              dataHora: agora,
              refeicao: gravacao.refeicao,
              texto: texto || null,
              resposta: gravacao.resposta,
              refeicaoDoPlano: gravacao.refeicaoDoPlano,
              refeicaoSlot: gravacao.refeicaoSlot,
              fotoOriginalPath: arquivo.caminho,
              fotoStatus: 'processando',
              createdAt: agora,
              updatedAt: agora,
            })
            .returning({ id: diaryEntries.id });
          id = e.id;
          const job = await boss.send('diario-foto', { tenantId: ctx.tenantId, entryId: e.id }, { db: fromDrizzle(tx, sql) });
          if (!job) throw new Error('A fila recusou a conversão da foto');
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return { id, semFoto: false, jaRegistrado: false };
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new DiarioError({ foto: MSG_DIARIO.foto });
    if (e instanceof CotaEsgotadaError) {
      if (!texto) throw new DiarioError({ foto: MSG_COTA_ESGOTADA });
      return { ...(await soTexto()), semFoto: true };
    }
    throw e;
  }
}

/** Plano 16: os rótulos ("Almoço · 12:30") das refeições do plano já respondidas hoje (Plano e refeição aberta escondem o "Comi assim"). Auditado (D22). */
export async function respostasDeHoje(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<Set<string>> {
  const patientId = pacienteDaSessao(ctx, 'respostasDeHoje');
  const { inicio, fim } = diaDe(o.agora ?? new Date(), fuso);
  const r = await withTenant(
    ctx,
    async (tx) => {
      const linhas = await tx
        .select({ rotulo: diaryEntries.refeicaoDoPlano })
        .from(diaryEntries)
        .where(and(eq(diaryEntries.patientId, patientId), isNotNull(diaryEntries.resposta), gte(diaryEntries.dataHora, inicio), lt(diaryEntries.dataHora, fim)));
      if (linhas.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });
      return linhas;
    },
    o.db ?? getDb(),
  );
  return new Set(r.flatMap((x) => (x.rotulo ? [x.rotulo] : [])));
}

/** US-042: os registros do paciente da sessão (mais recentes primeiro), com o estado da foto. Leitura auditada (D22). */
export async function diarioDoPaciente(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<RegistroDoDiario[]> {
  const patientId = pacienteDaSessao(ctx, 'diarioDoPaciente');
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, patientId)).orderBy(desc(diaryEntries.dataHora)).limit(o.limite ?? 50);
      if (r.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map(paraRegistro);
}

/** Só `foto_path` (o JPEG convertido) vira caminho assinável; o original (`foto_original_path`) nunca sai daqui. */
export function paraRegistro(e: typeof diaryEntries.$inferSelect): RegistroDoDiario {
  return {
    id: e.id,
    dataHora: e.dataHora,
    refeicao: e.refeicao,
    texto: e.texto,
    foto:
      e.fotoStatus === 'pronta' && e.fotoPath
        ? { estado: 'pronta', caminho: e.fotoPath }
        : { estado: e.fotoStatus === 'pronta' ? 'falhou' : e.fotoStatus === 'removida' ? 'sem_foto' : (e.fotoStatus as 'sem_foto' | 'processando' | 'falhou') },
    comentario: e.comentarioNutri,
    comentadoEm: e.comentadoEm,
    resposta: (e.resposta as RespostaDoDiario | null) ?? null,
    refeicaoDoPlano: e.refeicaoDoPlano,
  };
}
