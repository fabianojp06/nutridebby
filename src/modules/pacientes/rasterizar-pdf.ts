import { fork, type ChildProcess } from 'node:child_process';
import { constants, readFileSync } from 'node:fs';
import { mkdtemp, open, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@/lib/logger';
import type { MensagemDoProcesso } from './rasterizar-pdf-processo';

/** RNF-162 / D1: heap do processo filho, prazo da rasterização inteira e teto de memória residente (o filho é morto acima). */
export const HEAP_MAX_RASTER_MB = 64;
export const TEMPO_MAX_RASTER_MS = 120_000;
/**
 * D-R1 revista pela R-D4 (dono, 07/10/2026): 256 MiB. Medido 66–69 MB só do Node com o WASM, 153–156 MB com uma página A4 a
 * 2000 px e ~195 MiB com uma página que traz uma foto de 12 MP (o PDFium decodifica o JPEG embutido); o teto de 200 MB deixava
 * o laudo escaneado pelo celular no fio. Nunca subir por conta própria.
 */
export const TETO_RSS_RASTER_BYTES = 256 * 1024 * 1024;
const VIGIA_MS = 20;
/** R-D2: quanto esperar o filho morto (SIGKILL) sair antes de apagar o diretório temporário do job. */
const ESPERA_SAIDA_MS = 5_000;

export class RasterizacaoError extends Error {
  override name = 'RasterizacaoError';
  constructor(readonly motivo: 'paginas' | 'conversao') {
    super(`rasterização: ${motivo}`);
  }
}

export type PaginaRaster = { indice: number; largura: number; altura: number; rgba: Buffer };
type Opcoes = { limitePaginas: number; ladoMax: number; maxPixelsImagem: number; tempoMaxMs?: number; tetoRssBytes?: number };

/** Só o nome/código do erro (regra 3: nada do PDF nem caminho de arquivo). */
function codigoDe(causa: unknown): string {
  const nome = typeof causa === 'string' ? causa : causa instanceof Error ? ((causa as NodeJS.ErrnoException).code ?? causa.name) : 'erro';
  return nome.slice(0, 60);
}

/** O motivo técnico fica no log, só o nome/código (regra 3: nada do PDF). */
function registrarRecusa(causa: unknown): void {
  logger.warn({ etapa: 'rasterizar', erro: codigoDe(causa) }, 'PDF do paciente recusado na rasterização');
}

/** Memória residente de um processo filho (Linux: /proc). Fora do Linux, null (sem vigia — só dev local). */
function rssDe(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * R-D2: lê o arquivo da página sem seguir link simbólico, só arquivo comum, sem outro nome (hard link) e do tamanho exato — o
 * filho roda com o mesmo usuário e abre conteúdo não confiável: defesa em profundidade contra apontar para outro arquivo.
 */
async function lerPaginaDoFilho(caminho: string, bytes: number): Promise<Buffer | null> {
  const fh = await open(caminho, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size !== bytes) return null;
    const rgba = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await fh.read(rgba, 0, bytes, 0);
    return bytesRead === bytes ? rgba : null;
  } finally {
    await fh.close();
  }
}

/** R-D4: nome do arquivo do PDF no diretório do job — fixo no código, o mesmo em rasterizar-pdf-processo.ts (nunca texto do usuário). */
const NOME_PDF_DE_ENTRADA = 'entrada.pdf';

/**
 * R-D4: grava o PDF no diretório do job (só o dono lê, nunca sobrescreve) e devolve só o tamanho — numa função à parte para
 * que o Buffer lido por `ler` não fique preso a nenhum escopo da rasterização depois de gravado.
 */
async function gravarPdfDeEntrada(dir: string, pdf: Buffer | (() => Promise<Buffer>)): Promise<number> {
  const conteudo = typeof pdf === 'function' ? await pdf() : pdf;
  try {
    await writeFile(path.join(dir, NOME_PDF_DE_ENTRADA), conteudo, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    registrarRecusa(e);
    throw new RasterizacaoError('conversao');
  }
  return conteudo.length;
}

const ladoValido = (n: unknown, ladoMax: number): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= ladoMax;

/**
 * Plano 12 (D23 = a, R-170, RNF-162, D1 do plano): rasteriza o PDF do paciente no processo filho rasterizar-pdf-processo.ts
 * (sem variáveis de ambiente, heap limitado, memória residente vigiada de 20 em 20 ms e prazo) e entrega UMA página por vez a
 * `aoReceber`, que converte e solta os pixels; só então pede a próxima. Estouro do teto, erro, saída sem resposta ou prazo
 * vencido → RasterizacaoError('conversao') e o filho é morto (SIGKILL) — o worker (container de 1 GiB, R-D4) segue com as
 * outras filas. Mais de `limitePaginas` → ('paginas'), antes de desenhar. O erro de `aoReceber` volta como está. Só o worker
 * importa (guarda).
 *
 * R-D2 (dono, 07/10/2026): os pixels de cada página chegam por arquivo, não pela IPC — o diretório temporário é do job
 * (`mkdtemp`, 0700), o nome de cada arquivo é gerado pelo código (o pai calcula o caminho esperado e recusa outro), cada arquivo
 * é lido e apagado antes de `aoReceber` e o diretório inteiro sai no fim, também em erro, prazo vencido ou morte do filho.
 *
 * R-D4 (dono, 07/10/2026): o PDF também chega ao filho por arquivo (`entrada.pdf` no mesmo diretório; o filho o lê direto para
 * a memória do WASM e o apaga), não pela IPC. `pdf` pode ser a função que lê o original: aí o Buffer só existe até ser gravado
 * e o worker o solta antes de o filho começar (com um Buffer, quem chamou ainda o segura). Erro de `pdf()` volta como está.
 */
export async function rasterizarPdf(
  pdf: Buffer | (() => Promise<Buffer>),
  o: Opcoes,
  aoReceber: (p: PaginaRaster) => Promise<void>,
): Promise<{ paginas: number; picoBytes: number | null }> {
  let dir: string;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'nutri-raster-'));
  } catch (e) {
    registrarRecusa(e);
    throw new RasterizacaoError('conversao');
  }
  try {
    const tamanho = await gravarPdfDeEntrada(dir, pdf);
    return await noProcessoFilho(tamanho, o, dir, aoReceber);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((e: unknown) =>
      logger.warn({ etapa: 'rasterizar', erro: codigoDe(e) }, 'diretório temporário da rasterização não foi apagado'),
    );
  }
}

function noProcessoFilho(tamanhoPdf: number, o: Opcoes, dir: string, aoReceber: (p: PaginaRaster) => Promise<void>): Promise<{ paginas: number; picoBytes: number | null }> {
  return new Promise((resolve, reject) => {
    let filho: ChildProcess;
    try {
      filho = fork(fileURLToPath(new URL('./rasterizar-pdf-processo.ts', import.meta.url)), [], {
        // R-D2: gc() por página no filho (devolve logo os buffers de cada página)
        execArgv: [`--max-old-space-size=${HEAP_MAX_RASTER_MB}`, '--expose-gc'],
        // nenhuma variável (nem credencial) do worker chega ao processo que abre o PDF do paciente; a única exceção (R-D2, não é
        // credencial) fixa o limiar do mmap do glibc: os blocos grandes voltam ao sistema no free, e o teto de RSS não estoura
        env: { MALLOC_MMAP_THRESHOLD_: '131072' } as unknown as NodeJS.ProcessEnv,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], // nada do filho vai para o log: pode citar o conteúdo
      });
    } catch (e) {
      registrarRecusa(e);
      return reject(new RasterizacaoError('conversao'));
    }
    const saiu = new Promise<void>((r) => filho.once('exit', () => r()));
    /** O filho morto sai antes de o diretório ser apagado (nada grava nele depois); sem processo (falha no fork), não espera. */
    const esperarSaida = () =>
      filho.pid === undefined || filho.exitCode !== null || filho.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((r) => {
            const t = setTimeout(r, ESPERA_SAIDA_MS);
            void saiu.then(() => {
              clearTimeout(t);
              r();
            });
          });
    let acabou = false;
    let paginas = 0;
    const teto = o.tetoRssBytes ?? TETO_RSS_RASTER_BYTES;
    const encerrar = (fim: () => void) => {
      if (acabou) return;
      acabou = true;
      clearTimeout(prazo);
      clearInterval(vigia);
      filho.kill('SIGKILL');
      void esperarSaida().then(fim);
    };
    const falhar = (motivo: 'paginas' | 'conversao', causa?: unknown) =>
      encerrar(() => {
        if (causa !== undefined) registrarRecusa(causa);
        reject(new RasterizacaoError(motivo));
      });
    const prazo = setTimeout(() => falhar('conversao', 'prazo'), o.tempoMaxMs ?? TEMPO_MAX_RASTER_MS);
    const vigia = setInterval(() => {
      const rss = rssDe(filho.pid);
      if (rss !== null && rss > teto) falhar('conversao', 'memoria');
    }, VIGIA_MS);
    const receberPagina = async (m: Extract<MensagemDoProcesso, { tipo: 'pagina' }>) => {
      // o caminho vem do pai, nunca do filho (que abre conteúdo não confiável): outro caminho, índice fora de ordem ou tamanho errado = recusa
      const caminho = path.join(dir, `pagina-${paginas}.rgba`);
      if (m.indice !== paginas || m.caminho !== caminho || !ladoValido(m.largura, o.ladoMax) || !ladoValido(m.altura, o.ladoMax)) return falhar('conversao', 'mensagem_invalida');
      paginas++;
      let rgba: Buffer | null;
      try {
        rgba = await lerPaginaDoFilho(caminho, m.largura * m.altura * 4);
        await unlink(caminho);
      } catch (e) {
        return falhar('conversao', e);
      }
      if (acabou) return;
      if (!rgba) return falhar('conversao', 'arquivo_da_pagina');
      try {
        await aoReceber({ indice: m.indice, largura: m.largura, altura: m.altura, rgba });
      } catch (e) {
        return encerrar(() => reject(e));
      }
      if (!acabou) filho.send('proxima');
    };
    // o "fim" chega logo depois da última página, sem esperar o "proxima": só resolve depois que `aoReceber` terminar com ela
    let emAndamento: Promise<void> = Promise.resolve();
    filho.on('message', (m: MensagemDoProcesso) => {
      if (acabou) return;
      if (m.tipo === 'recusa') return falhar(m.motivo, m.erro);
      if (m.tipo === 'fim') return void emAndamento.then(() => encerrar(() => resolve({ paginas, picoBytes: m.picoBytes })));
      emAndamento = receberPagina(m);
    });
    filho.on('error', (e) => falhar('conversao', e));
    filho.once('exit', () => falhar('conversao', 'saiu_sem_resposta'));
    filho.send({ tipo: 'entrada', tamanhoPdf, dir, limitePaginas: o.limitePaginas, ladoMax: o.ladoMax, maxPixelsImagem: o.maxPixelsImagem });
    filho.send('proxima');
  });
}
