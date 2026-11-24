import { and, asc, count, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, exams, patients, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { normalizarTexto } from '@/lib/text';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { avisarEnvioAtualizado } from '@/modules/portal/avisos';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';
import { MSG_EXAME } from './exames-constantes';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';
import { MOTIVO_RECUSA_TEXTO_MAX, MOTIVOS_RECUSA, MSG_REVISAO, type MotivoRecusa, type StatusEnvio } from './exames-enviados-constantes';

/** Recusa com texto pronto para a tela (US-015, US-163, US-164). */
export class RevisaoError extends Error {
  override name = 'RevisaoError';
  constructor(readonly erros: Partial<Record<'titulo' | 'data' | 'motivo' | 'texto' | 'geral', string>>) {
    super('Revisão do envio recusada');
  }
}

export type EnvioNaFila = { id: string; patientId: string; paciente: string; enviadoEm: Date; dataColeta: string; nome: string | null };

/**
 * Revisão do plano (LGPD art. 16, minimização): entre o atendimento da exclusão e o job exclusao-atendida (ou por até um dia, se
 * o job falhar de vez), os envios do titular bloqueado ou anonimizado não aparecem na fila, nos contadores nem abrem. A seção
 * "Exames enviados" do Início (Plano 18, `src/modules/ficha/secoes/exames-enviados.ts`) usa o mesmo filtro.
 */
export const doTitular = and(eq(patients.tenantId, examSubmissions.tenantId), eq(patients.id, examSubmissions.patientId));
export const titularVisivel = and(ne(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm));

/** US-162: a fila "Exames recebidos" — todos os pacientes, os mais antigos primeiro. Só lista: sem auditRead (como a lista de pacientes). */
export async function filaDeEnvios(ctx: TenantContext, db: Db = getDb()): Promise<EnvioNaFila[]> {
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: examSubmissions.id, patientId: examSubmissions.patientId, paciente: patients.nome, enviadoEm: examSubmissions.createdAt, dataColeta: examSubmissions.dataColeta, nome: examSubmissions.nome })
        .from(examSubmissions)
        .innerJoin(patients, doTitular)
        .where(and(eq(examSubmissions.status, 'recebido'), titularVisivel))
        .orderBy(asc(examSubmissions.createdAt)),
    db,
  );
}

/** US-162: o contador do menu ("Exames recebidos (3)"); só conta, sem auditoria. */
export async function contarEnviosRecebidos(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  const [{ n }] = await withTenant(ctx, (tx) => tx.select({ n: count() }).from(examSubmissions).innerJoin(patients, doTitular).where(and(eq(examSubmissions.status, 'recebido'), titularVisivel)), db);
  return n;
}

/** US-162 "No prontuário": "Exames enviados pelo paciente ({n})" — os que aguardam a revisão. */
export async function contarEnviosDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<number> {
  if (!idValido(patientId)) return 0;
  const [{ n }] = await withTenant(
    ctx,
    (tx) => tx.select({ n: count() }).from(examSubmissions).innerJoin(patients, doTitular).where(and(eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'recebido'), titularVisivel)),
    db,
  );
  return n;
}

/** §6.5 item 1 (ECF.17.01): os exames do paciente que vieram de um envio aceito — o selo "Enviado pelo paciente" na aba Exames. */
export async function examesEnviadosPeloPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Set<string>> {
  if (!idValido(patientId)) return new Set();
  const r = await withTenant(
    ctx,
    (tx) => tx.select({ examId: examSubmissions.examId }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'aceito'), isNotNull(examSubmissions.examId))),
    db,
  );
  return new Set(r.map((x) => x.examId!));
}

export type EnvioAberto = {
  id: string;
  paciente: PatientRow;
  status: StatusEnvio;
  enviadoEm: Date;
  dataColeta: string;
  nome: string | null;
  /** A observação do paciente (só em "recebido"). */
  observacao: string | null;
  /** O PDF limpo (só em "recebido"). */
  pdf: string | null;
  /** As imagens de página, na ordem (D23 = a: a nutricionista confere como imagens; só em "recebido"). */
  paginas: string[];
};

/**
 * US-162: abre um envio no painel. Só o envio "recebido" (o que aguarda a revisão) devolve o conteúdo — observação, PDF limpo
 * e imagens de página — e registra "Visualizou — Exames enviados pelo paciente" (auditRead na mesma transação). Nas outras
 * situações (code review do PR #25, P12-22 b) o envio abre só com a situação, como na fila e sem auditRead: o PDF e as páginas
 * de um envio cancelado, recusado, expirado ou com falha esperam a limpeza e não são mais da nutricionista (RN-165, RN-166,
 * LGPD art. 6º III); o do aceito já está no exame.
 */
export async function abrirEnvio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<EnvioAberto | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select().from(examSubmissions).where(eq(examSubmissions.id, id));
      if (!e) return null;
      const [p] = await tx.select().from(patients).where(eq(patients.id, e.patientId));
      if (!p || p.status === 'bloqueado' || p.anonimizadoEm) return null; // revisão do plano: titular com exclusão atendida
      const status = e.status as StatusEnvio;
      const cabecalho = { id: e.id, paciente: p, status, enviadoEm: e.createdAt, dataColeta: e.dataColeta, nome: e.nome };
      if (status !== 'recebido') return { ...cabecalho, observacao: null, pdf: null, paginas: [] };
      const paginas = await tx
        .select({ c: examSubmissionFiles.arquivoPath })
        .from(examSubmissionFiles)
        .where(and(eq(examSubmissionFiles.submissionId, id), eq(examSubmissionFiles.papel, 'pagina')))
        .orderBy(asc(examSubmissionFiles.ordem));
      await auditRead(tx, { entidade: 'exames_enviados', entidadeId: id, patientId: e.patientId });
      return { ...cabecalho, observacao: e.observacao, pdf: e.arquivoPath, paginas: paginas.map((x) => x.c) };
    },
    db,
  );
}

async function lerEnvio(ctx: TenantContext, id: string, db: Db): Promise<{ patientId: string; arquivoPath: string | null }> {
  const [e] = idValido(id)
    ? await withTenant(ctx, (tx) => tx.select({ patientId: examSubmissions.patientId, arquivoPath: examSubmissions.arquivoPath }).from(examSubmissions).where(eq(examSubmissions.id, id)), db)
    : [];
  if (!e) throw new RevisaoError({ geral: MSG_REVISAO.naoEncontrado });
  return e;
}

/**
 * Ordem de travas de criarExame e de salvarArquivo: paciente (carregarPacienteParaEscrita: bloqueado ou anonimizado →
 * PacienteBloqueadoError; arquivado passa, §6.3) → envio (FOR UPDATE) → tenant (no apagarArquivo da recusa). Corridas da US-163.
 */
async function travarEnvioRecebido(tx: Tx, id: string, patientId: string): Promise<{ arquivoPath: string | null }> {
  await carregarPacienteParaEscrita(tx, patientId);
  const [e] = await tx.select({ status: examSubmissions.status, arquivoPath: examSubmissions.arquivoPath }).from(examSubmissions).where(eq(examSubmissions.id, id)).for('update');
  if (!e) throw new RevisaoError({ geral: MSG_REVISAO.naoEncontrado });
  if (e.status === 'cancelado') throw new RevisaoError({ geral: MSG_REVISAO.cancelado });
  if (e.status !== 'recebido') throw new RevisaoError({ geral: MSG_REVISAO.jaRevisado });
  return e;
}

/** Interna da recusa: o PDF da linha travada não é o lido antes da trava (desfaz a transação; a recusa recomeça). */
class PdfDoEnvioMudou extends Error {
  override name = 'PdfDoEnvioMudou';
}

const soltarPaginas = (ctx: TenantContext, id: string, deps: { db: Db; dataDir?: string }) =>
  apagarArquivosDoEnvio(ctx, id, deps).catch((err: unknown) =>
    logger.warn({ tenantId: ctx.tenantId, envioId: id, err: err instanceof Error ? err.name : 'erro' }, 'páginas do envio revisado não apagadas (a varredura tenta de novo)'),
  );

/**
 * US-163 / RN-164: numa transação — exame novo (título 1–120, data válida e não futura, `valores = []`) apontando para o MESMO
 * PDF limpo (sem cópia: o exame passa a ser o único dono do arquivo) e o envio "aceito" com `exam_id`, quem e quando, soltando
 * o ponteiro; o push neutro ao paciente. Depois do commit, as imagens de página saem (cada uma no seu apagarArquivo; sobra →
 * varredura). "Aceitar e ler valores com IA" chama `pedirLeituraExame` DEPOIS desta função (a recusa da IA não desfaz o aceite).
 */
export async function aceitarEnvio(
  ctx: TenantContext,
  tenant: { fuso: string },
  id: string,
  entrada: { titulo: unknown; data: unknown },
  deps: { db?: Db; dataDir?: string; agora?: Date } = {},
): Promise<{ examId: string; patientId: string }> {
  const revisor = ctx.actorUserId;
  if (ctx.role !== 'nutri' || !revisor) throw new Error('aceitarEnvio: só a nutricionista');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const erros: Partial<Record<'titulo' | 'data', string>> = {};
  // SUS-110: o corte em 120 pode deixar meio emoji (surrogate sem par) no fim — limpo de novo
  const titulo = semInvalidosNoBanco(normalizarTexto(entrada.titulo).slice(0, 120));
  if (!titulo) erros.titulo = MSG_EXAME.titulo;
  const data = typeof entrada.data === 'string' ? entrada.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_EXAME.data;
  else if (data > hojeNoFuso(tenant.fuso, agora)) erros.data = MSG_EXAME.futuro;
  if (Object.keys(erros).length) throw new RevisaoError(erros);
  const lido = await lerEnvio(ctx, id, db);
  const r = await withTenant(
    ctx,
    async (tx) => {
      const e = await travarEnvioRecebido(tx, id, lido.patientId);
      if (!e.arquivoPath) throw new RevisaoError({ geral: MSG_REVISAO.jaRevisado });
      const [ex] = await tx
        .insert(exams)
        .values({ tenantId: ctx.tenantId, patientId: lido.patientId, data, titulo, arquivoPath: e.arquivoPath, valores: [], createdAt: agora, updatedAt: agora })
        .returning({ id: exams.id });
      await tx
        .update(examSubmissions)
        .set({ status: 'aceito', examId: ex.id, revisadoPor: revisor, revisadoEm: agora, arquivoPath: null, updatedAt: agora })
        .where(eq(examSubmissions.id, id));
      await avisarEnvioAtualizado(tx, { tenantId: ctx.tenantId, patientId: lido.patientId, tipo: 'exame_revisado' }, agora);
      return { examId: ex.id, patientId: lido.patientId };
    },
    db,
  );
  await soltarPaginas(ctx, id, { db, dataDir: deps.dataDir });
  return r;
}

/**
 * US-164 / RN-165 (D20 = a): motivo da lista; "outro" exige texto de 1 a 300. O PDF limpo sai por apagarArquivo cujo
 * `naMesmaTransacao` trava paciente → envio, confere "recebido" e o marca "recusado" (quem, quando, motivo) com o push neutro;
 * as imagens de página saem logo depois. "Exame de outra pessoa": o mesmo caminho (dado de terceiro, minimização).
 */
export async function recusarEnvio(ctx: TenantContext, id: string, entrada: { motivo: unknown; texto: unknown }, deps: { db?: Db; dataDir?: string; agora?: Date } = {}): Promise<void> {
  const revisor = ctx.actorUserId;
  if (ctx.role !== 'nutri' || !revisor) throw new Error('recusarEnvio: só a nutricionista');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const motivo = typeof entrada.motivo === 'string' && (MOTIVOS_RECUSA as readonly string[]).includes(entrada.motivo) ? (entrada.motivo as MotivoRecusa) : null;
  if (!motivo) throw new RevisaoError({ motivo: MSG_REVISAO.escolhaMotivo });
  const texto = motivo === 'outro' ? normalizarTexto(entrada.texto) : '';
  if (motivo === 'outro' && (!texto || [...texto].length > MOTIVO_RECUSA_TEXTO_MAX)) throw new RevisaoError({ texto: MSG_REVISAO.motivoObrigatorio });
  // Regra 9 (um dono só): o ponteiro só é zerado com a linha travada apontando para o MESMO PDF que o apagarArquivo desta
  // transação apaga. Se mudou desde a leitura sem trava (o worker gravou "processando → recebido" no intervalo), nada é gravado
  // e a recusa recomeça uma vez da leitura; a segunda divergência vira "já revisado".
  for (let tentativa = 1; ; tentativa++) {
    const lido = await lerEnvio(ctx, id, db);
    const marcar = async (tx: Tx): Promise<boolean> => {
      const e = await travarEnvioRecebido(tx, id, lido.patientId);
      if (e.arquivoPath !== lido.arquivoPath) throw new PdfDoEnvioMudou();
      await tx
        .update(examSubmissions)
        .set({ status: 'recusado', motivoRecusa: motivo, motivoRecusaTexto: motivo === 'outro' ? texto : null, revisadoPor: revisor, revisadoEm: agora, arquivoPath: null, updatedAt: agora })
        .where(eq(examSubmissions.id, id));
      await avisarEnvioAtualizado(tx, { tenantId: ctx.tenantId, patientId: lido.patientId, tipo: 'exame_revisado' }, agora);
      return true;
    };
    try {
      if (lido.arquivoPath) await apagarArquivo(ctx, { caminho: lido.arquivoPath }, { db, dataDir: deps.dataDir, naMesmaTransacao: marcar });
      else await withTenant(ctx, marcar, db);
      break;
    } catch (err) {
      if (!(err instanceof PdfDoEnvioMudou)) throw err;
      if (tentativa >= 2) throw new RevisaoError({ geral: MSG_REVISAO.jaRevisado });
    }
  }
  await soltarPaginas(ctx, id, { db, dataDir: deps.dataDir });
}
