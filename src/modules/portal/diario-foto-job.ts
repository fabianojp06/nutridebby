import { readFile } from 'node:fs/promises';
import sharp, { type Sharp } from 'sharp';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Db } from '@/db/client';
import { diaryEntries } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';

// Só o worker importa este arquivo (sharp + heic-decode/WASM): nenhuma rota do Next (guarda no grafo de imports).

/** RN-07 / Review Focus 3: acima disto (≈ 40 MP, mais que qualquer câmera de celular) é recusado — "bomba de descompressão". */
export const MAX_PIXELS = 40_000_000;
const LADO_MAX = 1600;

export type DadosFotoDiario = { tenantId: string; entryId: string };
/**
 * Dimensões lidas do cabeçalho do HEIC; os pixels (RGBA) só são alocados no `decode()`. `liberar` solta a memória do
 * decodificador (o `dispose` do `decode.all`) e é chamado uma vez, com ou sem `decode()`.
 */
export type ImagemHeic = { width: number; height: number; decode: () => Promise<{ data: Uint8ClampedArray }>; liberar?: () => void };
type AbrirHeic = (buf: Buffer) => Promise<ImagemHeic>;

class FotoInvalidaError extends Error {}

/** `decode.all` só abre o contêiner (Step 1): nada de pixels até o `decode()` — a conferência dos 40 MP vem antes. */
const heicDeVerdade: AbrirHeic = async (buf) => {
  const { default: decode } = await import('heic-decode');
  const imagens = await decode.all({ buffer: buf });
  // a primeira é a mesma que o `decode()` simples do pacote usaria (lib.js: `data[0]`)
  const [primeira] = imagens;
  if (!primeira) {
    imagens.dispose();
    throw new Error('HEIC sem imagem');
  }
  return { width: primeira.width, height: primeira.height, decode: primeira.decode, liberar: () => imagens.dispose() };
};

const grandeDemais = (width: number | undefined, height: number | undefined) =>
  !width || !height || width <= 0 || height <= 0 || width * height > MAX_PIXELS;

/** HEIC → pixels RGBA, recusando pelo cabeçalho ANTES de decodificar (o decode aloca largura × altura × 4 bytes). */
async function pixelsDoHeic(original: Buffer, abrirHeic: AbrirHeic): Promise<Sharp> {
  const heic = await abrirHeic(original).catch(() => {
    throw new FotoInvalidaError('heic');
  });
  try {
    if (grandeDemais(heic.width, heic.height)) throw new FotoInvalidaError('pixels');
    const { data } = await heic.decode().catch(() => {
      throw new FotoInvalidaError('heic');
    });
    if (data.byteLength !== heic.width * heic.height * 4) throw new FotoInvalidaError('heic');
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: heic.width, height: heic.height, channels: 4 }, limitInputPixels: MAX_PIXELS });
  } finally {
    heic.liberar?.(); // os pixels já foram copiados para o heap do JS: a memória do WASM pode sair
  }
}

/** Pixels → JPEG ≤ 1600 px no maior lado, qualidade 80, sem metadados (o sharp só copia EXIF/GPS com withMetadata). */
async function paraJpeg(original: Buffer, ext: string, abrirHeic: AbrirHeic): Promise<Buffer> {
  let img: Sharp;
  if (ext === 'heic') {
    img = await pixelsDoHeic(original, abrirHeic);
  } else {
    const meta = await sharp(original).metadata().catch(() => {
      throw new FotoInvalidaError('metadata');
    }); // só o cabeçalho: o sharp não decodifica pixels no metadata()
    if (grandeDemais(meta.width, meta.height)) throw new FotoInvalidaError('pixels');
    img = sharp(original, { limitInputPixels: MAX_PIXELS }).rotate(); // aplica a orientação do EXIF antes de descartá-lo
  }
  return img
    .resize({ width: LADO_MAX, height: LADO_MAX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // PNG com transparência → fundo branco
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
    .catch(() => {
      throw new FotoInvalidaError('conversao');
    });
}

/**
 * Job `diario-foto` (US-042 / RN-07). Idempotente: age sobre registro "processando" com original (converte) ou
 * "pronta" que ainda aponta para o original (o worker caiu entre gravar o JPEG e apagar o original: só apaga).
 * CLAUDE.md regra 9: o JPEG entra por salvarArquivo e o registro aponta para ele no `registrar`; o original sai por
 * apagarArquivo e o ponteiro `foto_original_path` é limpo no `naMesmaTransacao` dele — nunca numa transação separada
 * (senão uma queda entre as duas deixa o original no disco, contando na cota, sem nada que aponte para ele).
 * Imagem que não decodifica ou grande demais → "falhou" na hora (definitivo) e o original sai. Erro de infraestrutura →
 * o pg-boss tenta de novo; na última tentativa, "falhou".
 * `descartar` (só a varredura `expirarFotosPendentes`): registro "processando" esquecido vira "falhou" e o original sai,
 * sem nova conversão.
 * ORDEM DE TRAVAS: registro do diário → tenant (cota), nos dois caminhos (`antesDaReserva` e `naMesmaTransacao`).
 */
export async function converterFotoDoDiario(
  data: DadosFotoDiario,
  deps: { db: Db; dataDir: string; ultimaTentativa: boolean; abrirHeic?: AbrirHeic; descartar?: boolean },
): Promise<'pronta' | 'ignorada' | 'falhou'> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const [e] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select()
        .from(diaryEntries)
        .where(and(eq(diaryEntries.id, data.entryId), isNotNull(diaryEntries.fotoOriginalPath), inArray(diaryEntries.fotoStatus, ['processando', 'pronta']))),
    deps.db,
  );
  if (!e?.fotoOriginalPath) return 'ignorada';
  const original = e.fotoOriginalPath;
  const arquivos = { db: deps.db, dataDir: deps.dataDir };
  /** Apaga o original e, na MESMA transação, o ponteiro (e o que mais `set` disser) — só se o registro ainda aponta para ele. */
  const apagarOriginal = (set: Partial<typeof diaryEntries.$inferInsert>, status: 'processando' | 'pronta') =>
    apagarArquivo(ctx, { caminho: original }, {
      ...arquivos,
      naMesmaTransacao: async (tx) => {
        const r = await tx
          .update(diaryEntries)
          .set({ ...set, fotoOriginalPath: null, updatedAt: new Date() })
          .where(and(eq(diaryEntries.id, e.id), eq(diaryEntries.fotoStatus, status), eq(diaryEntries.fotoOriginalPath, original)))
          .returning({ id: diaryEntries.id });
        return r.length > 0;
      },
    });
  if (e.fotoStatus === 'pronta') {
    await apagarOriginal({}, 'pronta'); // sobra de uma tentativa que caiu depois de gravar o JPEG
    return 'ignorada';
  }
  const falhar = async (): Promise<'falhou'> => {
    await apagarOriginal({ fotoStatus: 'falhou' }, 'processando');
    return 'falhou';
  };
  if (deps.descartar) return falhar();
  let convertida = false;
  try {
    const buf = await readFile(resolverCaminho(deps.dataDir, original));
    const jpeg = await paraJpeg(buf, original.slice(original.lastIndexOf('.') + 1), deps.abrirHeic ?? heicDeVerdade);
    await salvarArquivo(
      ctx,
      {
        tipo: 'diario_foto',
        conteudo: jpeg,
        permitidos: ['jpg'],
        patientId: e.patientId,
        // Trava o registro antes da cota (mesma ordem do apagarArquivo abaixo)
        antesDaReserva: async (tx) => {
          const [ainda] = await tx
            .select({ id: diaryEntries.id })
            .from(diaryEntries)
            .where(and(eq(diaryEntries.id, e.id), eq(diaryEntries.fotoStatus, 'processando'), eq(diaryEntries.fotoOriginalPath, original)))
            .for('update');
          if (!ainda) throw new Error('registro do diário mudou durante a conversão');
        },
        // O original continua apontado aqui: quem o solta é o naMesmaTransacao do apagarArquivo
        registrar: async (tx, arquivo) => {
          await tx.update(diaryEntries).set({ fotoPath: arquivo.caminho, fotoStatus: 'pronta', updatedAt: new Date() }).where(eq(diaryEntries.id, e.id));
        },
      },
      arquivos,
    );
    convertida = true;
    await apagarOriginal({}, 'pronta');
    return 'pronta';
  } catch (err) {
    if (convertida) {
      // O JPEG já está gravado e apontado; o registro ainda aponta para o original (não é órfão): outra tentativa o apaga
      logger.warn({ tenantId: data.tenantId, entryId: data.entryId, motivo: 'original' }, 'original da foto do diário não apagado');
      if (!deps.ultimaTentativa) throw err;
      return 'pronta';
    }
    const definitivo = err instanceof FotoInvalidaError || deps.ultimaTentativa;
    // RNF-11: só ids e o motivo; nunca o caminho nem o conteúdo
    logger.warn({ tenantId: data.tenantId, entryId: data.entryId, motivo: err instanceof FotoInvalidaError ? err.message : 'erro', definitivo }, 'falha ao converter a foto do diário');
    if (!definitivo) throw err;
    return falhar();
  }
}

/** As 3 tentativas do job somam poucos minutos (30 s, 60 s, 120 s de espera + até 120 s cada): 30 min sem mudança é abandono. */
export const FOTO_PENDENTE_MAX_MS = 30 * 60_000;
const JOB_VIVO = new Set(['created', 'retry', 'active']);

/**
 * Rede de segurança da US-042 / RN-07 (fila `expirar-diario-foto`, de 15 em 15 min), como a `expirar-plano-pdf`: registro
 * com o original (que pode ter EXIF/GPS) parado há mais de 30 min, porque o job acabou sem terminar o trabalho (o worker
 * caiu na última tentativa e o pg-boss expirou o job, ou o banco caiu e nem o "falhou" foi gravado).
 * - "processando" sem job vivo (`created`/`retry`/`active`) para ele → "falhou" e o original sai do disco e da cota.
 *   Não converte de novo: se a queda foi falta de memória com esta foto, cada varredura derrubaria o worker outra vez.
 *   Com job ainda na fila (worker parado, voltando agora) espera por ele.
 * - "pronta" ainda apontando para o original → só apaga o original (o mesmo ramo do job).
 * Idempotente; um registro com erro não impede os outros (vale na próxima rodada). Log só com contagens e ids (RNF-11).
 */
export async function expirarFotosPendentes(
  deps: { db: Db; dataDir: string; boss: Pick<PgBoss, 'findJobs'> },
  now: Date,
  idadeMinMs = FOTO_PENDENTE_MAX_MS,
): Promise<{ descartadas: number; originais: number }> {
  const limite = new Date(now.getTime() - idadeMinMs);
  const r = { descartadas: 0, originais: 0 };
  for (const t of await listarTenantsParaVarredura(deps.db)) {
    try {
      const parados = await withTenant(
        { tenantId: t.id, role: 'worker' },
        (tx) =>
          tx
            .select({ id: diaryEntries.id, fotoStatus: diaryEntries.fotoStatus })
            .from(diaryEntries)
            .where(and(isNotNull(diaryEntries.fotoOriginalPath), inArray(diaryEntries.fotoStatus, ['processando', 'pronta']), lt(diaryEntries.updatedAt, limite))),
        deps.db,
      );
      for (const e of parados) {
        try {
          const data = { tenantId: t.id, entryId: e.id };
          if (e.fotoStatus === 'processando') {
            const jobs = await deps.boss.findJobs<DadosFotoDiario>('diario-foto', { data: { entryId: e.id } });
            if (jobs.some((j) => JOB_VIVO.has(j.state))) continue;
          }
          const fim = await converterFotoDoDiario(data, { db: deps.db, dataDir: deps.dataDir, ultimaTentativa: true, descartar: true });
          if (fim === 'falhou') r.descartadas++;
          else if (e.fotoStatus === 'pronta') r.originais++;
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id, entryId: e.id }, 'falha ao expirar a foto parada do diário');
        }
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao varrer as fotos paradas do diário');
    }
  }
  if (r.descartadas || r.originais) logger.warn(r, 'fotos do diário paradas há mais de 30 min: "falhou" ou original apagado');
  return r;
}
