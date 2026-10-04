import { urlDoPlayer, type VideoDoLink } from '@/modules/conteudo/video';

/**
 * US-050 / D10: player sem cookies (YouTube) ou sem rastreamento (Vimeo `dnt=1`). O `src` sai só do id validado. O
 * YouTube recusa embed sem referrer: `strict-origin-when-cross-origin` manda só a origem (nunca o caminho do portal).
 */
export function PlayerVideo({ video, titulo }: { video: VideoDoLink; titulo: string }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
      <iframe
        src={urlDoPlayer(video)}
        title={`Vídeo: ${titulo}`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
