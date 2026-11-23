import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_SOLICITACOES as M } from '@/modules/agenda/constantes';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { listarSolicitacoes, type PedidoNaFila } from '@/modules/agenda/solicitacoes';
import { formatarData } from '@/modules/pacientes/datas';
import { Mensagens } from '../../financeiro/mensagens';
import { marcadorDoEnvio } from '../../financeiro/topo';
import { AbasDaAgenda } from '../abas';
import { aceitarAction, recusarAction } from './actions';
import { AcoesDoPedido } from './recusar-dialogo';
import { retornoDaFila } from './retornos';

export const dynamic = 'force-dynamic';

/** O h1 recebe o foco depois das ações que tiram a linha da fila (§7, `focarTitulo` do Financeiro, sem cópia). */
const ID_TITULO_AGENDA = 'titulo-agenda';

/** "Nova pessoa: {nome}" para o pedido de quem ainda não é paciente (§6.2); o paciente, pelo nome de registro (C-408). */
const nomeNaFila = (p: PedidoNaFila) => (p.tipo === 'pessoa_nova' ? M.novaPessoa(p.nome) : p.nome);

/**
 * Plano 23 (US-409, §7): "Solicitações" — os pedidos ainda no prazo, em cartões (`h2` por pedido), do que vence primeiro ao
 * último: paciente (ou "Nova pessoa: {nome}"), horário, local, origem, "Pedido em" e "Responda até", com "Aceitar" e
 * "Recusar". O vencido e ainda não processado não aparece (leitura preguiçosa, RN-427). Leitura da agenda: sem `auditRead`
 * (RN-414). A região `role="status"` fica fixa acima da lista (`?ok=`/`?erro=` das actions, listas fechadas), e o foco vai
 * ao h1. A aba "Solicitações ({n})" conta a própria fila (um `count` só, a lista já lida).
 */
export default async function SolicitacoesPage({ searchParams }: PageProps<'/painel/agenda/solicitacoes'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/solicitacoes');
  const sp = await searchParams;
  const fila = await listarSolicitacoes(ctx, tenant);
  const retorno = retornoDaFila(sp);
  const dia = (d: Date) => formatarData(partesNoFuso(d, tenant.fuso).data);
  const hora = (d: Date) => partesNoFuso(d, tenant.fuso).hora;
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 id={ID_TITULO_AGENDA} tabIndex={-1} className="font-titulo text-2xl font-semibold">{M.titulo}</h1>
      <AbasDaAgenda atual="solicitacoes" solicitacoes={fila.length} />
      <Mensagens texto={retorno?.texto ?? ''} tipo={retorno?.tipo ?? 'ok'} focar={retorno !== null} marcador={marcadorDoEnvio(sp.envio)} alvos={[ID_TITULO_AGENDA]} />
      {fila.length === 0 ? (
        <p>{M.vazio}</p>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
          {fila.map((p) => {
            const nome = nomeNaFila(p);
            return (
              <li key={`${p.tipo}-${p.id}`}>
                <article aria-labelledby={`pedido-${p.id}`} className="space-y-2 rounded-3xl border border-borda bg-cartao p-5">
                  <h2 id={`pedido-${p.id}`} className="font-titulo text-lg font-semibold">{nome}</h2>
                  <p>{`${formatarQuando(p.inicio, tenant.fuso)}–${hora(p.fim)}`}</p>
                  <p>{[p.local, M.origem[p.origem]].filter(Boolean).join(' · ')}</p>
                  <p className="text-sm">{M.pedidoEm(dia(p.pedidoEm))}</p>
                  <p className="text-sm font-medium">{M.respondaAte(dia(p.respondaAte), hora(p.respondaAte))}</p>
                  {p.primeiraOnline && <Aviso tipo="aviso" papel="nenhum">{M.primeiraOnline}</Aviso>}
                  <AcoesDoPedido nome={p.nome} comMotivo={p.tipo === 'consulta'} aceitar={aceitarAction.bind(null, p.tipo, p.id)} recusar={recusarAction.bind(null, p.tipo, p.id)} />
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
