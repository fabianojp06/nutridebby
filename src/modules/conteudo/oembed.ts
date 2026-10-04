import { detectarTipo } from '@/lib/file-type';
import { logger, nomeDoErro } from '@/lib/logger';
import { urlDoVideo, type VideoDoLink } from './video';

/** US-050: "oEmbed indisponível (erro ou demora > 5 s) → salvo com a capa padrão". Prazo TOTAL (oEmbed + miniatura). */
export const OEMBED_PRAZO_MS = 5000;
const OEMBED_JSON_MAX = 64 * 1024;
const MINIATURA_MAX = 2 * 1024 * 1024;
const OEMBED: Record<VideoDoLink['provider'], string> = { youtube: 'https://www.youtube.com/oembed', vimeo: 'https://vimeo.com/api/oembed.json' };
/** D9: os únicos hosts de onde o servidor baixa a miniatura. */
const HOSTS_MINIATURA = new Set(['i.ytimg.com', 'i.vimeocdn.com']);

class OembedFalhou extends Error {
  override name = 'OembedFalhou';
}

/** O `thumbnail_url` do oEmbed, se for https de um host da lista (sem credenciais nem porta); senão null. */
export function urlDaMiniatura(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !HOSTS_MINIATURA.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Lê o corpo até `max` bytes (não confia no Content-Length); passou → erro. */
async function lerAte(r: Response, max: number): Promise<Buffer> {
  if (Number(r.headers.get('content-length') ?? 0) > max) {
    await r.body?.cancel().catch(() => undefined);
    throw new OembedFalhou('grande');
  }
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel().catch(() => undefined);
      throw new OembedFalhou('grande');
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/**
 * INT-05 / D9: a miniatura do vídeo para virar a capa (baixada para /data: o PWA nunca carrega imagem de terceiros).
 * Chamar FORA de transação. Qualquer falha (rede, prazo, HTTP, JSON, host, tamanho, tipo) → null, e o conteúdo fica
 * com a capa padrão. RNF-11: o log leva só o provedor e o motivo, nunca a URL nem o corpo.
 */
export async function miniaturaDoVideo(v: VideoDoLink, o: { fetchImpl?: typeof fetch; prazoMs?: number } = {}): Promise<Buffer | null> {
  const f = o.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(o.prazoMs ?? OEMBED_PRAZO_MS);
  try {
    const url = `${OEMBED[v.provider]}?${new URLSearchParams({ url: urlDoVideo(v), format: 'json' })}`;
    const r = await f(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!r.ok) {
      await r.body?.cancel().catch(() => undefined);
      throw new OembedFalhou(`http_${r.status}`);
    }
    let dados: { thumbnail_url?: unknown };
    try {
      dados = JSON.parse((await lerAte(r, OEMBED_JSON_MAX)).toString('utf8'));
    } catch (e) {
      throw e instanceof OembedFalhou ? e : new OembedFalhou('json');
    }
    const miniatura = urlDaMiniatura(dados?.thumbnail_url);
    if (!miniatura) throw new OembedFalhou('host');
    const m = await f(miniatura, { signal, redirect: 'error' });
    if (!m.ok) {
      await m.body?.cancel().catch(() => undefined);
      throw new OembedFalhou(`http_${m.status}`);
    }
    const buf = await lerAte(m, MINIATURA_MAX);
    const tipo = detectarTipo(buf);
    if (!tipo || !['jpg', 'png', 'webp'].includes(tipo.ext)) throw new OembedFalhou('tipo');
    return buf;
  } catch (err) {
    logger.info({ provider: v.provider, motivo: err instanceof OembedFalhou ? err.message : nomeDoErro(err) }, 'capa do vídeo indisponível: capa padrão');
    return null;
  }
}
