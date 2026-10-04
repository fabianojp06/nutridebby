/** RN-10 / INT-05 / D10. Sem banco e sem rede: o formulário (cliente), o servidor e o portal usam o mesmo. */
export type ProvedorVideo = 'youtube' | 'vimeo';
export type VideoDoLink = { provider: ProvedorVideo; id: string };

// os mesmos formatos do CHECK contents_video_id_valido (0081)
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/;
const HOSTS_YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const HOSTS_VIMEO = new Set(['vimeo.com', 'www.vimeo.com']);

const youtube = (id: string | null | undefined): VideoDoLink | null => (id && YT_ID.test(id) ? { provider: 'youtube', id } : null);
/** Vimeo não listado: o "hash" vai junto ("76979871/abcdef1234") — sem ele o player não abre. */
const vimeo = (id: string | undefined, hash: string | null | undefined): VideoDoLink | null => {
  if (!id || !VIMEO_ID.test(id)) return null;
  if (!hash) return { provider: 'vimeo', id };
  return VIMEO_HASH.test(hash) ? { provider: 'vimeo', id: `${id}/${hash}` } : null;
};

/**
 * US-050: a URL colada → provedor + id. Só youtube.com/youtu.be/vimeo.com (RN-10), sem usuário, senha ou porta;
 * qualquer outra coisa → null ("Use um link do YouTube ou do Vimeo"). Sem esquema ("youtu.be/…") vale como https.
 */
export function lerLinkDeVideo(entrada: unknown): VideoDoLink | null {
  if (typeof entrada !== 'string') return null;
  const texto = entrada.trim();
  if (!texto || texto.length > 500) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return partes.length === 1 ? youtube(partes[0]) : null;
  if (HOSTS_YOUTUBE.has(host)) {
    if (partes.length === 1 && partes[0] === 'watch') return youtube(u.searchParams.get('v'));
    if (partes.length === 2 && ['shorts', 'embed', 'live'].includes(partes[0])) return youtube(partes[1]);
    return null;
  }
  if (HOSTS_VIMEO.has(host)) {
    const resto = partes[0] === 'channels' && partes.length >= 3 ? partes.slice(2) : partes;
    if (resto.length === 1) return vimeo(resto[0], u.searchParams.get('h'));
    if (resto.length === 2) return vimeo(resto[0], resto[1]);
    return null;
  }
  if (host === 'player.vimeo.com' && partes.length === 2 && partes[0] === 'video') return vimeo(partes[1], u.searchParams.get('h'));
  return null;
}

/** D10: YouTube sem cookies; Vimeo com `dnt=1`. O src sai só do id validado, nunca da URL digitada. */
export function urlDoPlayer(v: VideoDoLink): string {
  if (v.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${v.id}`;
  const [id, h] = v.id.split('/');
  return `https://player.vimeo.com/video/${id}?${new URLSearchParams(h ? { h, dnt: '1' } : { dnt: '1' })}`;
}

/** O endereço canônico do vídeo: pedido ao oEmbed e o valor que o formulário mostra. */
export function urlDoVideo(v: VideoDoLink): string {
  return v.provider === 'youtube' ? `https://www.youtube.com/watch?v=${v.id}` : `https://vimeo.com/${v.id}`;
}

/** Relê `contents.video_provider/video_id` (o CHECK do banco já garante o formato; aqui é a segunda trava). */
export function videoDoConteudo(c: { videoProvider: string | null; videoId: string | null }): VideoDoLink | null {
  if (c.videoProvider === 'youtube') return youtube(c.videoId);
  if (c.videoProvider === 'vimeo' && c.videoId) {
    const [id, hash] = c.videoId.split('/');
    return vimeo(id, hash ?? null);
  }
  return null;
}
