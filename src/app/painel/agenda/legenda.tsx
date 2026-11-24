import { MSG_VISOES as M } from '@/modules/agenda/constantes';
import { ROTULO_TIPO_CONSULTA, SELO_PRESENCA_A_REGISTRAR } from '@/modules/agenda/status';
import { MARCADOR_RETORNO_LIGADO, PEDIDOS_NA_AGENDA } from '@/modules/agenda/visoes';

/**
 * Plano 23 (RN-415, spec §7): as marcas da grade, só com os tokens que já existem (`bg-linha`, `aviso`, `ok`, nos dois
 * modos). A diferença entre elas é o texto: a cor só reforça (WCAG 1.4.1). Usadas pela legenda e pelos itens da grade.
 */
export const MARCA = {
  primeira: 'border-l-4 border-ok bg-ok-fundo',
  retorno: 'border-l-4 border-borda bg-linha',
  pedido: 'border-l-4 border-dashed border-aviso bg-aviso-fundo',
  presenca: 'border-l-4 border-aviso bg-aviso-fundo',
  bloqueio: 'border-l-4 border-aviso bg-aviso-fundo text-aviso',
  retornoPrevisto: 'border-l-4 border-dotted border-ok bg-cartao',
  aniversario: 'border-l-4 border-dotted border-aviso bg-cartao',
} as const;

const ITENS: { rotulo: string; marca: string }[] = [
  { rotulo: ROTULO_TIPO_CONSULTA.primeira, marca: MARCA.primeira },
  { rotulo: ROTULO_TIPO_CONSULTA.retorno, marca: MARCA.retorno },
  ...(PEDIDOS_NA_AGENDA ? [{ rotulo: M.pedidoAResponder, marca: MARCA.pedido }] : []),
  { rotulo: SELO_PRESENCA_A_REGISTRAR, marca: MARCA.presenca },
  { rotulo: M.bloqueio, marca: MARCA.bloqueio },
  ...(MARCADOR_RETORNO_LIGADO ? [{ rotulo: M.retornoPrevisto, marca: MARCA.retornoPrevisto }] : []),
  { rotulo: M.aniversario, marca: MARCA.aniversario },
];

/** "Legenda" (título) com os mesmos rótulos, em texto, que os itens da grade mostram (US-405). */
export function LegendaDaAgenda() {
  return (
    <section aria-labelledby="titulo-legenda" data-guia="legenda-agenda" className="space-y-2 text-sm">
      <h2 id="titulo-legenda" className="font-semibold">{M.legenda}</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {ITENS.map((i) => (
          <li key={i.rotulo} className="flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block h-4 w-5 rounded-sm ${i.marca}`} />
            {i.rotulo}
          </li>
        ))}
      </ul>
    </section>
  );
}
