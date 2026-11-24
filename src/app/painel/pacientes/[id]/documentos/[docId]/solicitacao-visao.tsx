import { MarcacaoBlocos } from '@/components/marcacao-blocos';
import { Cartao } from '@/components/ui/cartao';
import type { ConteudoSolicitacao } from '@/modules/documentos/solicitacao';

/**
 * Plano 22 (T8, US-377): a solicitação fora do rascunho, só para leitura, no painel — "Exames solicitados" (a lista como
 * foi preparada; um painel é um item, com o nome dele), "Indicação clínica" e "Orientações" (só quando preenchidas). As
 * orientações pela marcação mínima em componentes (`MarcacaoBlocos`, T9; `<`, `>` e `&` são texto; nunca HTML, RN-395).
 * Nenhum campo de laboratório (EP-D2). O portal e a página do link continuam sem itens nem orientações (D17 do 10A).
 */
export function SolicitacaoVisao({ conteudo }: { conteudo: ConteudoSolicitacao }) {
  return (
    <>
      <Cartao id="exames-solicitados" titulo="Exames solicitados">
        <ol className="list-decimal space-y-1 pl-5">
          {conteudo.exames.map((x) => (
            // T12 (Minor da T8): nome longo sem espaço quebra dentro do cartão a 360 px
            <li key={x.nome} className="wrap-break-word">
              {x.nome}
            </li>
          ))}
        </ol>
      </Cartao>
      {conteudo.indicacaoClinica && (
        <Cartao id="indicacao-clinica" titulo="Indicação clínica">
          <p className="wrap-break-word whitespace-pre-line">{conteudo.indicacaoClinica}</p>
        </Cartao>
      )}
      {conteudo.orientacoes && (
        <Cartao id="orientacoes-solicitacao" titulo="Orientações">
          <MarcacaoBlocos texto={conteudo.orientacoes} formato={conteudo.orientacoesFormato} />
        </Cartao>
      )}
    </>
  );
}
