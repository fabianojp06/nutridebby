import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { DIAS_SEMANA, MSG_LOCAIS, MSG_SOLICITACOES, ROTULO_MODALIDADE_REGRA, ROTULO_TIPO_LOCAL } from '@/modules/agenda/constantes';
import { listarBloqueios, listarHorarios, type RegraSalva } from '@/modules/agenda/disponibilidade';
import { formatarQuando } from '@/modules/agenda/fuso';
import { abaDeSolicitacoes } from '@/modules/agenda/solicitacoes';
import { AbasDaAgenda } from '../abas';
import { excluirBloqueioAction, excluirRegraAction } from './actions';
import { BloqueioForm } from './bloqueio-form';
import { ChaveDosPedidosForm } from './chave-form';
import { RegraForm } from './regra-form';

export const dynamic = 'force-dynamic';

/** `local`: o nome do grupo, no rótulo do "Excluir" (o mesmo horário em dois locais não dá dois botões com o mesmo nome). */
function ListaDeRegras({ regras, local }: { regras: RegraSalva[]; local?: string }) {
  return (
    <ul className="divide-y divide-linha">
      {regras.map((r) => (
        <li key={r.id} className="flex items-center justify-between py-2">
          <span>{`${DIAS_SEMANA[r.diaSemana]}, ${r.inicio}–${r.fim}, ${r.duracaoMin} min, ${ROTULO_MODALIDADE_REGRA[r.modalidade]}`}</span>
          <form action={excluirRegraAction.bind(null, r.id)}>
            <ConfirmarBotao mensagem="Excluir este horário de atendimento?" rotulo={`Excluir ${DIAS_SEMANA[r.diaSemana]} ${r.inicio}–${r.fim}${local ? ` em ${local}` : ''}`}>Excluir</ConfirmarBotao>
          </form>
        </li>
      ))}
    </ul>
  );
}

/**
 * US-030 / Plano 23 (US-401, RN-410): as regras agrupadas por local ativo (o principal primeiro). A regra que sobrou sem local
 * ativo (online sem nenhum local online, ou de um local arquivado) aparece no fim, para poder ser excluída: não gera horário.
 */
export default async function HorariosPage() {
  const { ctx, tenant } = await requireNutri('/painel/agenda/horarios');
  const agora = new Date();
  const [{ regras, locais }, bloqueios] = await Promise.all([listarHorarios(ctx), listarBloqueios(ctx, agora, new Date(agora.getTime() + 10 * 366 * 86_400_000))]);
  const solicitacoes = await abaDeSolicitacoes(ctx, tenant, { agora });
  const ativos = new Set(locais.map((l) => l.id));
  const semLocal = regras.filter((r) => !r.localId || !ativos.has(r.localId));
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-8 p-4 md:p-6">
        <h1 className="font-titulo text-2xl font-semibold">Horários de atendimento</h1>
        <AbasDaAgenda atual="horarios" solicitacoes={solicitacoes} />
        <section data-guia="regras-horario" aria-labelledby="regras" className="space-y-3">
          <h2 id="regras" className="text-lg font-semibold">Horários da semana</h2>
          {locais.length === 0 ? (
            <p>{MSG_LOCAIS.vazio} <Link href="/painel/agenda/locais" className="text-link underline">Locais de atendimento</Link></p>
          ) : (
            <>
              {regras.length === 0 ? (
                <p>Nenhum horário cadastrado: a página de agendamento não oferece horários.</p>
              ) : (
                locais.map((l) => {
                  const doLocal = regras.filter((r) => r.localId === l.id);
                  return (
                    <div key={l.id} className="space-y-1">
                      <h3 className="font-medium">{`${l.nome} (${ROTULO_TIPO_LOCAL[l.tipo]})`}</h3>
                      {doLocal.length ? <ListaDeRegras regras={doLocal} local={l.nome} /> : <p className="text-sm text-suave">Nenhum horário neste local.</p>}
                    </div>
                  );
                })
              )}
              {semLocal.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-medium">Sem local ativo</h3>
                  <p className="text-sm text-suave">Estes horários não aparecem para os pacientes.</p>
                  <ListaDeRegras regras={semLocal} />
                </div>
              )}
              <h3 className="font-medium">Adicionar horário</h3>
              <RegraForm locais={locais.map(({ id, nome, tipo, principal }) => ({ id, nome, tipo, principal }))} />
            </>
          )}
        </section>
        {/* Plano 23 (US-407, RN-420): a chave dos pedidos; desligar não mexe nos pendentes (continuam em Solicitações) */}
        <section aria-labelledby="pedidos-de-consulta" className="space-y-3">
          <h2 id="pedidos-de-consulta" className="text-lg font-semibold">{MSG_SOLICITACOES.chave.titulo}</h2>
          <ChaveDosPedidosForm ligada={tenant.agendaConfirmarPedidos} />
        </section>
        <section data-guia="bloqueios-horario" aria-labelledby="bloqueios" className="space-y-3">
          <h2 id="bloqueios" className="text-lg font-semibold">Bloqueios</h2>
          {bloqueios.length === 0 ? (
            <p>Nenhum bloqueio futuro.</p>
          ) : (
            <ul className="divide-y divide-linha">
              {bloqueios.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span>{`${formatarQuando(b.inicio, tenant.fuso)} até ${formatarQuando(b.fim, tenant.fuso)}${b.motivo ? ` — ${b.motivo}` : ''}`}</span>
                  <form action={excluirBloqueioAction.bind(null, b.id)}>
                    <ConfirmarBotao mensagem="Excluir este bloqueio?" rotulo={`Excluir bloqueio de ${formatarQuando(b.inicio, tenant.fuso)}`}>Excluir</ConfirmarBotao>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-medium">Adicionar bloqueio</h3>
          <BloqueioForm />
        </section>
      </main>
    </>
  );
}
