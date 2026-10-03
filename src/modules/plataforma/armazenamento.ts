import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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

export type TipoDeArquivo =
  'logo' | 'capa' | 'exame' | 'plano_pdf' | 'diario_foto' | 'diario_foto_original' | 'orientacao_pdf' | 'exportacao';

/** D4: arquivos com dono (paciente). O resto é do consultório. */
export const TIPOS_DO_PACIENTE: readonly TipoDeArquivo[] = ['exame', 'plano_pdf', 'diario_foto', 'diario_foto_original', 'exportacao'];
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

export function nivelDeUso(bytes: number): {
  percentual: number;
  nivel: 'ok' | 'aviso' | 'esgotado';
} {
  const percentual = Math.min(100, Math.floor((bytes / COTA_BYTES) * 100));
  const nivel =
    bytes >= COTA_BYTES ? 'esgotado' : bytes >= COTA_BYTES * COTA_AVISO ? 'aviso' : 'ok';
  return { percentual, nivel };
}

/** Caminho absoluto dentro de DATA_DIR; qualquer coisa que escape da pasta é erro (path traversal). */
export function resolverCaminho(dataDir: string, caminho: string): string {
  const raiz = path.resolve(dataDir);
  const alvo = path.resolve(raiz, caminho);
  if (!caminho || !alvo.startsWith(raiz + path.sep))
    throw new Error('caminho fora do diretório de dados');
  return alvo;
}

/**
 * Salva um arquivo do tenant. O tipo vem do conteúdo (nunca do nome); SVG nunca é guardado
 * (a Tarefa 10 converte o logo SVG em PNG antes). A cota é reservada na mesma transação do
 * registro: a linha do tenant fica travada até o commit, então uploads simultâneos não passam do limite.
 * ORDEM DE TRAVAS (evita deadlock): dono do arquivo (paciente, em `antesDaReserva`) → tenant (cota) → `registrar`.
 * É a mesma ordem de `apagarArquivo` (`naMesmaTransacao` → tenant).
 */
export async function salvarArquivo(
  ctx: TenantContext,
  input: {
    tipo: TipoDeArquivo;
    conteudo: Buffer;
    permitidos: readonly TipoArquivo['ext'][];
    /** Grava o registro que aponta para o arquivo (exame, exportação) na mesma transação. */
    registrar?: (tx: Tx, arquivo: ArquivoSalvo) => Promise<void>;
    /** Roda na transação ANTES da reserva de cota: é onde se trava o dono do arquivo (paciente). */
    antesDaReserva?: (tx: Tx) => Promise<void>;
    /** Só a exportação LGPD (obrigação legal, art. 18): o arquivo conta na cota, mas não é barrado por ela. */
    naoBarrarPelaCota?: boolean;
    /** D4: dono do arquivo — obrigatório nos TIPOS_DO_PACIENTE, proibido no resto. */
    patientId?: string;
  },
  deps: Deps = {},
): Promise<ArquivoSalvo> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  if (TIPOS_DO_PACIENTE.includes(input.tipo) !== Boolean(input.patientId)) {
    throw new Error(`salvarArquivo: patientId ${input.patientId ? 'proibido' : 'obrigatório'} para o tipo ${input.tipo}`);
  }
  const real = detectarTipo(input.conteudo);
  if (!real || real.ext === 'svg' || !input.permitidos.includes(real.ext))
    throw new TipoNaoPermitidoError();
  const id = randomUUID();
  const caminho = `${ctx.tenantId}/${input.tipo}/${id}.${real.ext}`;
  const destino = resolverCaminho(dataDir, caminho);
  const tmp = `${destino}.${process.pid}.tmp`;
  const bytes = input.conteudo.length;
  let gravado = false;
  try {
    // O conteúdo vai para o disco ANTES da transação: a linha do tenant (e o dono do arquivo) ficam
    // travados só pelo `rename`, não pelo tempo de escrita de um arquivo grande
    await mkdir(path.dirname(destino), { recursive: true, mode: 0o750 });
    await writeFile(tmp, input.conteudo, { mode: 0o640, flag: 'wx' });
    return await withTenant(
      ctx,
      async (tx) => {
        if (input.antesDaReserva) await input.antesDaReserva(tx);
        const reserva = await tx
          .update(tenants)
          .set({ armazenamentoBytes: sql`${tenants.armazenamentoBytes} + ${bytes}` })
          .where(
            and(
              eq(tenants.id, ctx.tenantId),
              input.naoBarrarPelaCota
                ? undefined
                : sql`${tenants.armazenamentoBytes} + ${bytes} <= ${COTA_BYTES}`,
            ),
          )
          .returning({ id: tenants.id });
        if (!reserva.length) throw new CotaEsgotadaError();
        await tx
          .insert(storedFiles)
          .values({
            id,
            tenantId: ctx.tenantId,
            tipo: input.tipo,
            caminho,
            bytes,
            mime: real.mime,
            criadoPor: ctx.actorUserId ?? null,
            patientId: input.patientId ?? null,
          });
        const arquivo = { id, caminho, bytes, mime: real.mime };
        if (input.registrar) await input.registrar(tx, arquivo);
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
 * só vira aviso de arquivo órfão). Ordem de travas: `naMesmaTransacao` (paciente/dono) → tenant (cota), igual a `salvarArquivo`.
 * `removerAntesDoCommit`: o `rm` roda na transação e, se falhar, nada é apagado.
 */
export async function apagarArquivo(
  ctx: TenantContext,
  filtro: { id: string } | { caminho: string },
  deps: Deps & {
    naMesmaTransacao?: (tx: Tx) => Promise<boolean>;
    removerAntesDoCommit?: boolean;
  } = {},
): Promise<boolean> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  const onde =
    'id' in filtro ? eq(storedFiles.id, filtro.id) : eq(storedFiles.caminho, filtro.caminho);
  const apagado = await withTenant(
    ctx,
    async (tx) => {
      if (deps.naMesmaTransacao && !(await deps.naMesmaTransacao(tx))) return null;
      const [row] = await tx
        .delete(storedFiles)
        .where(onde)
        .returning({ caminho: storedFiles.caminho, bytes: storedFiles.bytes });
      if (!row) return null;
      await tx
        .update(tenants)
        .set({ armazenamentoBytes: sql`greatest(${tenants.armazenamentoBytes} - ${row.bytes}, 0)` })
        .where(eq(tenants.id, ctx.tenantId));
      if (deps.removerAntesDoCommit)
        await rm(resolverCaminho(dataDir, row.caminho), { force: true });
      return row;
    },
    db,
  );
  if (!apagado) return false;
  if (!deps.removerAntesDoCommit) {
    await rm(resolverCaminho(dataDir, apagado.caminho), { force: true }).catch((err: unknown) =>
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId },
        'arquivo órfão no disco',
      ),
    );
  }
  return true;
}

/** Para o log: o código do erro (ENOENT, EACCES…), nunca a mensagem — a de disco leva o caminho (RNF-11). */
export const motivoDoErro = (err: unknown): string =>
  err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : 'erro';

/**
 * Plano 03 (c): `salvarArquivo` grava `<destino>.<pid>.tmp` antes da transação; uma queda deixa o .tmp.
 * Uma pasta ilegível (ou que some no meio) e um .tmp que não sai não param a varredura dos outros tenants:
 * o log leva só o tenant e o motivo, nunca o caminho.
 */
export async function limparTmpOrfaos(dataDir: string, agora: Date, idadeMinMs = 24 * 3600_000): Promise<number> {
  const avisar = (tenantId: string, err: unknown) => logger.warn({ tenantId, motivo: motivoDoErro(err) }, 'falha na limpeza de .tmp órfãos');
  const ler = (pasta: string, tenantId: string) =>
    readdir(pasta, { withFileTypes: true }).catch((err: unknown) => {
      avisar(tenantId, err);
      return [];
    });
  let apagados = 0;
  for (const tenant of await readdir(dataDir, { withFileTypes: true }).catch(() => [])) {
    if (!tenant.isDirectory()) continue;
    for (const tipo of await ler(path.join(dataDir, tenant.name), tenant.name)) {
      if (!tipo.isDirectory()) continue;
      const pasta = path.join(dataDir, tenant.name, tipo.name);
      for (const f of await ler(pasta, tenant.name)) {
        if (!/\.\d+\.tmp$/.test(f.name)) continue;
        const caminho = path.join(pasta, f.name);
        // um .tmp que acabou de virar o arquivo final (rename) some entre o readdir e o stat: não é órfão
        const info = await stat(caminho).catch(() => null);
        if (!info || agora.getTime() - info.mtimeMs < idadeMinMs) continue;
        try {
          await rm(caminho, { force: true });
          apagados++;
        } catch (err) {
          avisar(tenant.name, err);
        }
      }
    }
  }
  return apagados;
}
