import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissions, exams, type ExamRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { referenciaDaFaixa } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { cancelarTarefas } from '@/modules/ia/cancelar';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';
import { EXAME_MAX_BYTES, MSG_EXAME } from './exames-constantes';

export { EXAME_MAX_BYTES, MSG_EXAME };

/**
 * `iaTarefaId` (Plano 11, §5.11): a linha veio da leitura por IA dessa tarefa. A digitação manual (lerValores) nunca o grava.
 * `refMin`/`refMax` (Plano 22, RN-376, C-378): a faixa numérica do laudo, opcional; nenhuma chave antiga muda.
 */
export type ValorExame = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number };

export class ExameError extends Error {
  override name = 'ExameError';
  constructor(readonly erros: Record<string, string>) {
    super('Exame inválido');
  }
}

const MAX_LINHAS = 50;
const MAX_VALOR = 1e15; // acima disso o número perde precisão / viraria notação exponencial na tela
const texto = (v: unknown, max: number) => normalizarTexto(v).slice(0, max);
const passaDoLimite = (v: unknown, max: number) => normalizarTexto(v).length > max;
const F = MSG_EXAMES.lancamentoErros;

/** Um limite da faixa do laudo (RN-376, RNF-374: só por `lerDecimal`): vazio → null; lixo, não finito ou |x| ≥ 1e15 → 'invalido'. */
function lerLimite(v: unknown): number | null | 'invalido' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return 'invalido';
  const n = lerDecimal(v);
  if (n === null) return null;
  return Number.isFinite(n) && Math.abs(n) < MAX_VALOR ? n : 'invalido';
}

/** Uma linha lida, com o índice dela no que veio do formulário (a edição liga o índice à origem, T4). */
export type LinhaLida = { indice: number; valor: ValorExame };

/**
 * Plano 22 (T4, R22-02): as linhas do formulário com o erro de cada campo (`valores.{i}.nome`, `.valor`, `.unidade`,
 * `.referencia`, `.refMin`, `.refMax`; `valores` para a lista inteira). A linha só é "toda vazia" (ignorada) sem nome,
 * valor, "de" e "até": uma linha só com faixa vira erro, nunca some calada. Sem referência e com faixa, grava-se a
 * referência da faixa ("70 a 99", RN-376), para os leitores que só leem `referencia`. `iaTarefaId` do bruto é sempre
 * ignorado (só o servidor copia a origem da IA, RN-378).
 */
export function lerLinhasComErros(bruto: unknown): { linhas: LinhaLida[] } | { erros: Record<string, string> } {
  // recusa em vez de cortar: dado de saúde não some em silêncio
  if (!Array.isArray(bruto) || bruto.length > MAX_LINHAS) return { erros: { valores: MSG_EXAME.valores } };
  const erros: Record<string, string> = {};
  const linhas: LinhaLida[] = [];
  (bruto as unknown[]).forEach((item, i) => {
    const k = (campo: string) => `valores.${i}.${campo}`;
    if (item === null) return; // como antes: linha nula conta como vazia
    if (typeof item !== 'object' || Array.isArray(item)) {
      erros.valores = MSG_EXAME.valores;
      return;
    }
    const l = item as Record<string, unknown>;
    const nome = texto(l.nome, 80);
    const valorVazio = l.valor === undefined || l.valor === '' || l.valor === null;
    const refMin = lerLimite(l.refMin);
    const refMax = lerLimite(l.refMax);
    if (!nome && valorVazio && refMin === null && refMax === null) return;
    const antes = Object.keys(erros).length;
    if (passaDoLimite(l.nome, 80) || !nome) erros[k('nome')] = MSG_EXAME.valores;
    if (passaDoLimite(l.unidade, 20)) erros[k('unidade')] = MSG_EXAME.valores;
    if (passaDoLimite(l.referencia, 80)) erros[k('referencia')] = MSG_EXAME.valores;
    const valor = lerDecimal(l.valor);
    // isFinite, não só isNaN: '9'.repeat(400) vira Infinity, que o jsonb gravaria como null
    if (typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) >= MAX_VALOR) erros[k('valor')] = MSG_EXAME.valores;
    if (refMin === 'invalido') erros[k('refMin')] = F.faixaInvalida;
    if (refMax === 'invalido') erros[k('refMax')] = F.faixaInvalida;
    if (typeof refMin === 'number' && typeof refMax === 'number' && refMin > refMax) erros[k('refMin')] = F.faixaInvertida;
    if (Object.keys(erros).length > antes || typeof valor !== 'number' || refMin === 'invalido' || refMax === 'invalido') return;
    const v: ValorExame = {
      nome,
      valor,
      unidade: texto(l.unidade, 20) || null,
      referencia: texto(l.referencia, 80) || referenciaDaFaixa(refMin, refMax),
    };
    if (refMin !== null) v.refMin = refMin;
    if (refMax !== null) v.refMax = refMax;
    linhas.push({ indice: i, valor: v });
  });
  return Object.keys(erros).length ? { erros } : { linhas };
}

/** Plano 22 (T4, R22-02): as linhas do formulário, ou os erros por campo (as chaves de `lerLinhasComErros`). */
export function lerValoresComErros(bruto: unknown): { valores: ValorExame[] } | { erros: Record<string, string> } {
  const r = lerLinhasComErros(bruto);
  return 'linhas' in r ? { valores: r.linhas.map((l) => l.valor) } : r;
}

/** Linhas de valores do formulário (envoltório de `lerValoresComErros`, o mesmo de antes para `ia/conferencia.ts`): erro → null. */
export function lerValores(bruto: unknown): ValorExame[] | null {
  const r = lerValoresComErros(bruto);
  return 'valores' in r ? r.valores : null;
}

type Entrada = { titulo: unknown; data: unknown; valores: unknown; arquivo: Buffer | null };

/**
 * US-015. Ordem: valida tudo → confere o paciente (barato, antes de mexer em arquivo) → grava arquivo e
 * exame na MESMA transação (`registrar` de salvarArquivo: tipo pelo conteúdo, cota reservada, exame
 * inserido antes de o arquivo ir para o disco). Uma falha no meio não deixa laudo sem exame.
 */
export async function criarExame(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: Entrada,
  deps: { db?: Db; now?: Date; dataDir?: string } = {},
): Promise<string> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const erros: Record<string, string> = {};
  const titulo = texto(input.titulo, 120);
  if (!titulo) erros.titulo = MSG_EXAME.titulo;
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_EXAME.data;
  else if (data > hojeNoFuso(tenant.fuso, now)) erros.data = MSG_EXAME.futuro;
  const lidos = lerValoresComErros(input.valores);
  if ('erros' in lidos) Object.assign(erros, lidos.erros);
  if (input.arquivo && input.arquivo.length > EXAME_MAX_BYTES) erros.arquivo = MSG_EXAME.arquivo;
  if (Object.keys(erros).length || !('valores' in lidos)) throw new ExameError(erros);
  const { valores } = lidos;

  await withTenant(ctx, (tx) => carregarPacienteParaEscrita(tx, patientId), db);
  const inserir = async (tx: Tx, arquivoPath: string | null) => {
    const p = await carregarPacienteParaEscrita(tx, patientId); // de novo, na transação que grava (pode ter sido bloqueado)
    const [e] = await tx
      .insert(exams)
      .values({ tenantId: ctx.tenantId, patientId: p.id, data, titulo, arquivoPath, valores, createdAt: now, updatedAt: now })
      .returning({ id: exams.id });
    return e.id;
  };
  if (!input.arquivo) return withTenant(ctx, (tx) => inserir(tx, null), db);
  let id = '';
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'exame',
        conteudo: input.arquivo,
        permitidos: ['pdf', 'jpg', 'png'],
        patientId,
        // paciente travado ANTES da cota: mesma ordem de excluirExame (senão, deadlock)
        antesDaReserva: async (tx) => void (await carregarPacienteParaEscrita(tx, patientId)),
        registrar: async (tx, a) => void (id = await inserir(tx, a.caminho)) },
      { db, dataDir: deps.dataDir },
    );
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new ExameError({ arquivo: MSG_EXAME.arquivo });
    throw e; // CotaEsgotadaError: quem chama traduz (RN-18)
  }
  return id;
}

export async function excluirExame(ctx: TenantContext, patientId: string, id: string, deps: { db?: Db; dataDir?: string } = {}): Promise<boolean> {
  const db = deps.db ?? getDb();
  if (!idValido(patientId) || !idValido(id)) return false;
  const doExame = and(eq(exams.id, id), eq(exams.patientId, patientId));
  let exameApagado = false;
  const apagarExame = async (tx: Tx) => {
    await carregarPacienteParaEscrita(tx, patientId); // paciente primeiro, depois tenant (ordem de travas do armazenamento)
    // Plano 12 (code review do PR #25, P12-22 a): o DELETE abaixo dispara a ação de RI da FK exam_submissions_exame_fk
    // (0102, ON DELETE SET NULL (exam_id)): um UPDATE implícito que trava a linha do envio aceito (FOR NO KEY UPDATE) — DEPOIS
    // do tenant que cancelarTarefas e apagarArquivo travam. A limpeza das páginas desse envio (apagarArquivosDoEnvio) trava
    // envio → tenant: o ciclo dava 40P01. O envio que aponta para o exame é travado aqui, antes do tenant, na ordem única
    // paciente → envio → tenant (a de salvarArquivo, aceitarEnvio e recusarEnvio); a ação de RI encontra a trava já nossa.
    await tx.select({ id: examSubmissions.id }).from(examSubmissions).where(eq(examSubmissions.examId, id)).orderBy(asc(examSubmissions.id)).for('no key update');
    // Plano 11 (D20, spec §5.3 minimização): leituras de IA do exame na fila canceladas (reserva estornada) e sugestão pronta
    // esvaziada ANTES do DELETE (o SET NULL deixaria o resultado guardado sem uso). cancelarTarefas trava o tenant antes do
    // contador da plataforma (ordem da cota; apagarArquivo trava o tenant de novo depois). A tarefa em processamento não
    // passa do portão do envio ou falha no worker (exame_indisponivel).
    await cancelarTarefas(tx, { tenantId: ctx.tenantId, patientId, examId: id, agora: new Date(), por: ctx.actorUserId ?? null });
    exameApagado = (await tx.delete(exams).where(doExame).returning({ id: exams.id })).length > 0;
    return exameApagado;
  };
  const [atual] = await withTenant(ctx, (tx) => tx.select({ caminho: exams.arquivoPath }).from(exams).where(doExame), db);
  if (!atual) return false;
  // exame e laudo saem na mesma transação; o arquivo deixa o disco depois do commit
  if (atual.caminho) {
    await apagarArquivo(ctx, { caminho: atual.caminho }, { db, dataDir: deps.dataDir, naMesmaTransacao: apagarExame });
    return exameApagado; // o registro do arquivo pode já ter sumido (FK SET NULL): o exame saiu do mesmo jeito
  }
  return withTenant(ctx, apagarExame, db);
}

export async function listarExames(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<ExamRow[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(exams).where(eq(exams.patientId, patientId)).orderBy(desc(exams.data), desc(exams.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'exames', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

export type SerieMarcador = { nome: string; unidade: string | null; pontos: { data: string; valor: number }[] };

const normMarcador = (t: string | null) => (t ?? '').normalize('NFC').trim().toLowerCase();
/** A chave de um marcador (nome + unidade, sem diferenciar maiúsculas): a de `agruparMarcadores` e a do comparativo (Plano 22). */
export const chaveDoMarcador = (nome: string, unidade: string | null): string => `${normMarcador(nome)}\u0000${normMarcador(unidade)}`;

/**
 * Um marcador por nome + unidade (sem diferenciar maiúsculas/espaços), pontos em ordem cronológica: glicemia em
 * mg/dL e em mmol/L são duas séries — misturadas, o gráfico sairia errado.
 */
export function agruparMarcadores(lista: Pick<ExamRow, 'data' | 'valores'>[]): SerieMarcador[] {
  const series = new Map<string, SerieMarcador>();
  const norm = normMarcador;
  for (const e of [...lista].sort((a, b) => a.data.localeCompare(b.data))) {
    for (const v of e.valores) {
      const chave = chaveDoMarcador(v.nome, v.unidade);
      const s = series.get(chave) ?? { nome: v.nome.trim(), unidade: v.unidade, pontos: [] };
      s.pontos.push({ data: e.data, valor: v.valor });
      series.set(chave, s);
    }
  }
  return [...series.values()].sort((a, b) => norm(a.nome).localeCompare(norm(b.nome), 'pt-BR') || norm(a.unidade).localeCompare(norm(b.unidade)));
}

export async function marcadoresDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<SerieMarcador[]> {
  return agruparMarcadores(await listarExames(ctx, patientId, db));
}
