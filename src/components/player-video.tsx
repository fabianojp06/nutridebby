import type { VideoDoLink } from '@/modules/conteudo/video';
import { urlDoPlayer } from '@/modules/conteudo/video';
import { PlayerSobDemanda } from './player-sob-demanda';

/**
 * US-050 / D10 (Plano 07): player sem cookies (YouTube) ou sem rastreamento (Vimeo `dnt=1`), com o `src` só do id validado.
 * D12 (Plano 08): o player só carrega com o clique do paciente.
 */
export function PlayerVideo({ video, titulo }: { video: VideoDoLink; titulo: string }) {
  return <PlayerSobDemanda src={urlDoPlayer(video)} titulo={titulo} provedor={video.provider === 'youtube' ? 'YouTube' : 'Vimeo'} />;
}
