import { EstadoTarefa } from '@/app/painel/ia/estado-tarefa';
import { Aviso } from '@/components/ui/aviso';

type Props = {
  /** A tarefa em andamento (na fila ou processando): mostra `textos.andamento` e acompanha a situação. */
  andamento: { id: string } | null;
  textos: { andamento: string; pronto: string };
  /** A sugestão abriu: o fim da espera, só para leitor de tela (o conteúdo aparece logo abaixo). */
  pronto: boolean;
  /** O texto da falha (US-122) ou `null`. */
  falha: string | null;
  /** A tarefa da URL não abre mais (descartada, aplicada, vencida, autorização retirada). */
  indisponivel: string | null;
};

/**
 * A linha de estado do resumo e do rascunho (revisão da T11, como a aba Exames na T13 do Plano 11): uma região viva que
 * fica sempre montada no mesmo lugar da página. O `EstadoTarefa` recarrega a página quando a tarefa muda, e o texto
 * DENTRO dela troca de "Preparando…"/"Gerando…" para "… pronto." ou para o aviso de falha — e o leitor de tela anuncia.
 * Só a linha curta fica aqui; o resumo e a prévia ficam fora. Nenhum filho tem papel de região viva própria.
 */
export function EsperaDaIa({ andamento, textos, pronto, falha, indisponivel }: Props) {
  return (
    <div aria-live="polite" className="space-y-2">
      {andamento && (
        <p>
          {textos.andamento}
          <EstadoTarefa url={`/api/painel/ia/tarefas/${andamento.id}`} />
        </p>
      )}
      {!andamento && pronto && <p className="sr-only">{textos.pronto}</p>}
      {indisponivel && <Aviso tipo="aviso" papel="nenhum">{indisponivel}</Aviso>}
      {falha && <Aviso tipo="aviso" papel="nenhum">{falha}</Aviso>}
    </div>
  );
}
