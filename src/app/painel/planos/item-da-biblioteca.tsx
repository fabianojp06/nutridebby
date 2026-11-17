'use client';

import { Selo } from '@/app/painel/alimentos/busca-alimento';
import { textoMedida } from '@/modules/alimentos/medidas-constantes';
import { casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import { kcalTexto, nutrientesDoItem } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { gramasDoItem, medidaDaOpcao, opcaoDaMedida, opcoesDeMedida, type ItemEstado } from './editor/estado';

/**
 * Plano 19 (US-237/US-238): a linha de um item de minha refeição ou de lista de substituição — medida caseira ou
 * gramas (as mesmas regras e funções do editor do plano), a energia calculada agora e "Remover". `onde` entra no nome
 * acessível ("Gramas de Arroz em Carboidratos"): o mesmo alimento pode estar em dois grupos (RNF-232).
 */
export function ItemDaBiblioteca({ i, onde, substituicao = false, alterar, remover, erro }: {
  i: ItemEstado;
  onde: string;
  substituicao?: boolean;
  alterar: (i: ItemEstado) => void;
  remover: () => void;
  erro: (chave: string) => string | undefined;
}) {
  const g = gramasDoItem(i);
  const n = g === null ? null : nutrientesDoItem(i.porCem, g);
  const q = lerDecimal(i.qtdTexto);
  const errQ = erro(`item:${i.id}:quantidadeG`) ?? erro(`item:${i.id}:medida`) ?? (g === null ? MSG_PLANO.quantidade : undefined);
  const errAlimento = erro(`item:${i.id}:foodId`);
  const errSub = erro(`item:${i.id}:substituiItemId`);
  const sr = <span className="sr-only"> em {onde}</span>;
  return (
    <li className={`flex flex-wrap items-end gap-3 ${substituicao ? 'ml-6 border-l-2 border-borda pl-3' : ''}`}>
      <p className="min-w-48 flex-1 font-medium">{substituicao && <span className="text-sm text-suave">ou </span>}{i.nome} <Selo fonte={i.fonte} /></p>
      {(i.medidas.length > 0 || i.medida) && (
        <div className="space-y-1">
          <label htmlFor={`${i.id}-medida`} className="block text-sm">Medida de {i.nome}{sr}</label>
          <select
            id={`${i.id}-medida`}
            value={opcaoDaMedida(i)}
            onChange={(e) => {
              const medida = medidaDaOpcao(i, e.target.value);
              alterar(medida ? { ...i, medida, qtdTexto: '1' } : { ...i, medida: null, quantidadeTexto: g === null ? i.quantidadeTexto : formatarDecimal(g, casasDecimais(g)) });
            }}
            className="rounded-xl border border-campo bg-cartao p-2 text-texto"
          >
            <option value="">gramas</option>
            {opcoesDeMedida(i).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </div>
      )}
      {i.medida ? (
        <div className="space-y-1">
          <label htmlFor={`${i.id}-qtd`} className="block text-sm">Quantidade de {i.nome}{sr}</label>
          <input id={`${i.id}-qtd`} inputMode="decimal" value={i.qtdTexto} onChange={(e) => alterar({ ...i, qtdTexto: e.target.value })} aria-invalid={errQ ? true : undefined} aria-describedby={errQ ? `${i.id}-erro` : undefined} className="w-20 rounded-xl border border-campo bg-cartao p-2 text-texto" />
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${i.id}-g`} className="block text-sm">Gramas de {i.nome}{sr}</label>
          <input id={`${i.id}-g`} inputMode="decimal" value={i.quantidadeTexto} onChange={(e) => alterar({ ...i, quantidadeTexto: e.target.value })} aria-invalid={errQ ? true : undefined} aria-describedby={errQ ? `${i.id}-erro` : undefined} className="w-24 rounded-xl border border-campo bg-cartao p-2 text-texto" />
        </div>
      )}
      <p className="text-sm">
        {i.medida && q !== null && Number.isFinite(q) && q > 0 && g !== null && <span>{textoMedida(q, i.medida)} · {formatarDecimal(g, casasDecimais(g))} g · </span>}
        {n === null ? '—' : n.semValor.includes('kcal') ? MSG_PLANO.semValor(i.fonte) : `${kcalTexto(n.kcal)} kcal`}
      </p>
      <button type="button" onClick={remover} className="inline-flex min-h-11 items-center text-sm text-link underline">
        Remover {i.nome}{sr}
      </button>
      {errQ && <p id={`${i.id}-erro`} role="alert" className="w-full text-sm text-erro">{errQ}</p>}
      {/* sem campo ao lado: o próprio aviso recebe o foco do primeiro erro (`useFocoNoPrimeiroErro`) */}
      {errAlimento && <p role="alert" tabIndex={-1} data-foco-erro className="w-full text-sm text-erro">{errAlimento}</p>}
      {errSub && <p role="alert" tabIndex={-1} data-foco-erro className="w-full text-sm text-erro">{errSub}</p>}
    </li>
  );
}
