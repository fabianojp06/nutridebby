import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { detectarTipo, type TipoArquivo } from '@/lib/file-type';
import { logger } from '@/lib/logger';

export const COTA_BYTES = 5 * 1024 ** 3; // RN-18: 5 GB por tenant
export const COTA_AVISO = 0.8;
export const MSG_COTA_ESGOTADA = 'Espaço de armazenamento esgotado. Fale com o suporte.';

export type TipoDeArquivo = 'logo' | 'capa' | 'exame' | 'plano_pdf' | 'diario_foto' | 'orientacao_pdf' | 'exportacao';
export type ArquivoSalvo = { id: string; caminho: string; bytes: number; mime: string };

export class CotaEsgotadaError extends Error {
  override name = 'CotaEsgotadaError';
  constructor() {
    super(MSG_COTA_ESGOTADA);
  }
}
export class TipoNaoPermitidoError extends Error {
  override name = 'TipoNaoPermitidoError';
  constructor() {
    super('Formato de arquivo não permitido.');
  }
}

type Deps = { db?: Db; dataDir?: string };

export function nivelDeUso(bytes: number): { percentual: number; nivel: 'ok' | 'aviso' | 'esgotado' } {
  const percentual = Math.min(100, Math.floor((bytes / COTA_BYTES) * 100));
  const nivel = bytes >= COTA_BYTES ? 'esgotado' : bytes >= COTA_BYTES * COTA_AVISO ? 'aviso' : 'ok';
  return { percentual, nivel };
}

/** Caminho absoluto dentro de DATA_DIR; qualquer coisa que escape da pasta é erro (path traversal). */
export function resolverCaminho(dataDir: string, caminho: string): string {
  const raiz = path.resolve(dataDir);
  const alvo = path.resolve(raiz, caminho);
  if (!caminho || !alvo.startsWith(raiz + path.sep)) throw new Error('caminho fora do diretório de dados');
  return alvo;
}

/**
 * Salva um arquivo do tenant. O tipo vem do conteúdo (nunca do nome); SVG nunca é guardado
 * (a Tarefa 10 converte o logo SVG em PNG antes). A cota é reservada na mesma transação do
 * registro: a linha do tenant fica travada até o commit, então uploads simultâneos não passam do limite.
 */
export async function salvarArquivo(
  ctx: TenantContext,
  input: {
    tipo: TipoDeArquivo;
    conteudo: Buffer;
    permitidos: readonly TipoArquivo['ext'][];
    /** Grava o registro que aponta para o arquivo (exame, exportação) na mesma transação. */
    registrar?: (tx: Tx, arquivo: ArquivoSalvo) => Promise<void>;
  },
  deps: Deps = {},
): Promise<ArquivoSalvo> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  const real = detectarTipo(input.conteudo);
  if (!real || real.ext === 'svg' || !input.permitidos.includes(real.ext)) throw new TipoNaoPermitidoError();
  const id = randomUUID();
  const caminho = `${ctx.tenantId}/${input.tipo}/${id}.${real.ext}`;
  const destino = resolverCaminho(dataDir, caminho);
  const tmp = `${destino}.${process.pid}.tmp`;
  const bytes = input.conteudo.length;
  let gravado = false;
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const reserva = await tx
          .update(tenants)
          .set({ armazenamentoBytes: sql`${tenants.armazenamentoBytes} + ${bytes}` })
          .where(and(eq(tenants.id, ctx.tenantId), sql`${tenants.armazenamentoBytes} + ${bytes} <= ${COTA_BYTES}`))
          .returning({ id: tenants.id });
        if (!reserva.length) throw new CotaEsgotadaError();
        await tx
          .insert(storedFiles)
          .values({ id, tenantId: ctx.tenantId, tipo: input.tipo, caminho, bytes, mime: real.mime, criadoPor: ctx.actorUserId ?? null });
        const arquivo = { id, caminho, bytes, mime: real.mime };
        if (input.registrar) await input.registrar(tx, arquivo);
        await mkdir(path.dirname(destino), { recursive: true, mode: 0o750 });
        await writeFile(tmp, input.conteudo, { mode: 0o640, flag: 'wx' });
        await rename(tmp, destino);
        gravado = true;
        return arquivo;
      },
      db,
    );
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    if (gravado) await rm(destino, { force: true }).catch(() => undefined); // o commit falhou depois da gravação
    throw err;
  }
}

/**
 * Apaga o registro e devolve o espaço; por padrão o arquivo sai do disco depois do commit (falha no `rm`
 * só vira aviso de arquivo órfão). `removerAntesDoCommit`: o `rm` roda na transação e, se falhar, nada é apagado.
 */
export async function apagarArquivo(
  ctx: TenantContext,
  filtro: { id: string } | { caminho: string },
  deps: Deps & { naMesmaTransacao?: (tx: Tx) => Promise<boolean>; removerAntesDoCommit?: boolean } = {},
): Promise<boolean> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  const onde = 'id' in filtro ? eq(storedFiles.id, filtro.id) : eq(storedFiles.caminho, filtro.caminho);
  const apagado = await withTenant(
    ctx,
    async (tx) => {
      if (deps.naMesmaTransacao && !(await deps.naMesmaTransacao(tx))) return null;
      const [row] = await tx.delete(storedFiles).where(onde).returning({ caminho: storedFiles.caminho, bytes: storedFiles.bytes });
      if (!row) return null;
      await tx
        .update(tenants)
        .set({ armazenamentoBytes: sql`greatest(${tenants.armazenamentoBytes} - ${row.bytes}, 0)` })
        .where(eq(tenants.id, ctx.tenantId));
      if (deps.removerAntesDoCommit) await rm(resolverCaminho(dataDir, row.caminho), { force: true });
      return row;
    },
    db,
  );
  if (!apagado) return false;
  if (!deps.removerAntesDoCommit) {
    await rm(resolverCaminho(dataDir, apagado.caminho), { force: true }).catch((err: unknown) =>
      logger.warn({ err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId }, 'arquivo órfão no disco'),
    );
  }
  return true;
}
