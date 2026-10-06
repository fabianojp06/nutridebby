import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { exams, tenants, type ExamRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { cancelarTarefas } from '@/modules/ia/cancelar';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';
import { EXAME_MAX_BYTES, MSG_EXAME } from './exames-constantes';

export { EXAME_MAX_BYTES, MSG_EXAME };

/** `iaTarefaId` (Plano 11, §5.11): a linha veio da leitura por IA dessa tarefa. A digitação manual (lerValores) nunca o grava. */
export type ValorExame = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string };

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

/** Linhas de valores do formulário. Linha toda vazia é ignorada; nome sem valor numérico (ou o contrário) → null. */
export function lerValores(bruto: unknown): ValorExame[] | null {
  if (!Array.isArray(bruto)) return null;
  const out: ValorExame[] = [];
  if (bruto.length > MAX_LINHAS) return null; // recusa em vez de cortar: dado de saúde não some em silêncio
  for (const l of bruto as Record<string, unknown>[]) {
    if (l !== null && typeof l !== 'object') return null;
    if (passaDoLimite(l?.nome, 80) || passaDoLimite(l?.unidade, 20) || passaDoLimite(l?.referencia, 80)) return null;
    const nome = texto(l?.nome, 80);
    const valorTxt = l?.valor;
    const vazio = !nome && (valorTxt === undefined || valorTxt === '' || valorTxt === null);
    if (vazio) continue;
    const valor = lerDecimal(valorTxt);
    // isFinite, não só isNaN: '9'.repeat(400) vira Infinity, que o jsonb gravaria como null
    if (!nome || typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) >= MAX_VALOR) return null;
    out.push({ nome, valor, unidade: texto(l.unidade, 20) || null, referencia: texto(l.referencia, 80) || null });
  }
  return out;
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
  const valores = lerValores(input.valores);
  if (!valores) erros.valores = MSG_EXAME.valores;
  if (input.arquivo && input.arquivo.length > EXAME_MAX_BYTES) erros.arquivo = MSG_EXAME.arquivo;
  if (Object.keys(erros).length || !valores) throw new ExameError(erros);

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
    // Plano 11 (D20, spec §5.3 minimização): leituras de IA do exame na fila canceladas (reserva estornada) e sugestão pronta
    // esvaziada ANTES do DELETE (o SET NULL deixaria o resultado guardado sem uso). Tenant travado antes do contador da
    // plataforma (ordem da cota; apagarArquivo trava o tenant de novo depois). A tarefa em processamento não passa do portão
    // do envio ou falha no worker (exame_indisponivel).
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for('update');
    await cancelarTarefas(tx, { patientId, examId: id, agora: new Date(), por: ctx.actorUserId ?? null });
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

/**
 * Um marcador por nome + unidade (sem diferenciar maiúsculas/espaços), pontos em ordem cronológica: glicemia em
 * mg/dL e em mmol/L são duas séries — misturadas, o gráfico sairia errado.
 */
export function agruparMarcadores(lista: Pick<ExamRow, 'data' | 'valores'>[]): SerieMarcador[] {
  const series = new Map<string, SerieMarcador>();
  const norm = (t: string | null) => (t ?? '').normalize('NFC').trim().toLowerCase();
  for (const e of [...lista].sort((a, b) => a.data.localeCompare(b.data))) {
    for (const v of e.valores) {
      const chave = `${norm(v.nome)}\u0000${norm(v.unidade)}`;
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
