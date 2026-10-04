import { ROTULO_TIPO_CONTEUDO, type TipoConteudo } from '@/modules/conteudo/constantes';

/**
 * A capa (URL assinada de 5 min, imagem decorativa: o título está ao lado) ou a "capa padrão" de US-050/D9 — um
 * bloco com o tipo, sem imagem de terceiros.
 */
export function CapaDoConteudo({ tipo, capaUrl, className = '' }: { tipo: TipoConteudo; capaUrl: string | null; className?: string }) {
  if (capaUrl)
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, fora do otimizador de imagens
    return <img src={capaUrl} alt="" className={`aspect-video w-full rounded object-cover ${className}`} />;
  return (
    <div aria-hidden="true" className={`flex aspect-video w-full items-center justify-center rounded bg-emerald-50 text-sm font-semibold text-emerald-900 ${className}`}>
      {ROTULO_TIPO_CONTEUDO[tipo]}
    </div>
  );
}
