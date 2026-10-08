import { SeloOffline } from '@/app/p/selo-offline';
import { FocarTitulo } from './focar-titulo';
import { MSG_G } from './textos';
import { Voltar } from './voltar';

/** Plano 16 (§4.2): cabeçalho compacto das telas de detalhe — "Voltar" e o título, sem a lista de seções (a seção continua marcada para quem volta). */
export function CabecalhoDetalhe({ titulo, voltar }: { titulo: string; voltar: { href: string; secao: string } }) {
  return (
    <>
      <header data-sobre-marca="" className="flex items-center gap-1 bg-faixa px-2 py-2 text-white">
        <Voltar href={voltar.href} rotulo={MSG_G.voltarPara(voltar.secao)} />
        <h1 id="titulo-da-tela" tabIndex={-1} className="font-portal-titulo text-xl font-extrabold">
          {titulo}
        </h1>
      </header>
      <SeloOffline />
      <FocarTitulo />
    </>
  );
}
