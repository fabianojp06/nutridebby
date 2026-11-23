import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { formatarQuando, quandoComFuso, somarDias } from '@/modules/agenda/fuso';
import { localInicial } from '@/modules/agenda/horarios';
import { idValido } from '@/modules/pacientes/base';
import { formatarData } from '@/modules/pacientes/datas';
import { consultaDoPaciente, horariosDaSemana } from '@/modules/portal/agenda';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { QuandoLocal } from '../../../quando-local';
import { AcoesConsulta } from '../acoes-consulta';
import { remarcarAction } from '../actions';
import { AgendarForm } from '../agendar-form';

export const dynamic = 'force-dynamic';

export default async function ConsultaDoPortal({ params, searchParams }: PageProps<'/p/agenda/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  if (!idValido(id)) notFound();
  const agora = new Date();
  const c = await consultaDoPaciente(ctx, tenant, id, agora);
  if (!c) notFound();
  const sp = await searchParams;
  const ativa = c.status === 'agendada' || c.status === 'confirmada';
  const s = ativa && c.podeAlterar ? await horariosDaSemana(tenant, agora, sp.semana, c.id) : null;
  // US-033: a remarcação traz para a consulta nova (`remarcarAction`); a confirmação vem pela URL, como no painel
  const remarcada = sp.ok === 'remarcada' && ativa ? MSG_AGENDA.remarcada(quandoComFuso(c.inicio, tenant.fuso)) : null;
  // Plano 23 (RN-407): o endereço do local (pela projeção); a consulta antiga, presencial, o do Perfil, como antes
  const endereco = c.local ? c.local.endereco : c.modalidade === 'presencial' ? tenant.enderecoConsultorio : null;
  return (
    <>
      <CabecalhoDetalhe titulo="Sua consulta" voltar={{ href: '/p/agenda', secao: 'Minhas consultas' }} />
      <main className="space-y-4 p-6">
        {remarcada && <p role="status" className="rounded bg-ok-fundo p-3">{remarcada}</p>}
        <p>
          <QuandoLocal semFuso={formatarQuando(c.inicio, tenant.fuso)} comFuso={quandoComFuso(c.inicio, tenant.fuso)} fuso={tenant.fuso} />
          {` · ${ROTULO_MODALIDADE[c.modalidade]}`}
          {c.local?.nome && ` · ${c.local.nome}`}
        </p>
        {endereco && <p className="text-sm">{`Endereço: ${endereco}`}</p>}
        {ativa && c.modalidade === 'online' && c.linkOnline && (
          <p>
            <a href={c.linkOnline} className="inline-flex min-h-11 items-center underline" rel="noreferrer">Link da chamada</a>
          </p>
        )}
        {ativa ? (
          <AcoesConsulta id={c.id} confirmada={c.status === 'confirmada'} podeAlterar={c.podeAlterar} pedidoRemarcacao={c.pedidoRemarcacao} />
        ) : (
          // Plano 23 (AG-D43, AG-D44): o pedido mostra a situação dele ("Aguardando…", "Não confirmado", "Pedido cancelado");
          // "Desistir do pedido" é da T8
          <p>{c.pedido ? c.situacao : c.status === 'cancelada' ? 'Esta consulta foi cancelada.' : 'Consulta encerrada'}</p>
        )}
        {s && (
          <section aria-labelledby="remarcar" className="space-y-3">
            <h2 id="remarcar" className="text-lg font-semibold">Remarcar</h2>
            {/* Plano 23 (US-403): abre com o local da consulta (ou o `?local=` da troca de semana); pode trocar por outro */}
            <AgendarForm
              acao={remarcarAction.bind(null, c.id)}
              horarios={s.horarios}
              locais={s.locais}
              localInicial={localInicial(s.locais, s.horarios, typeof sp.local === 'string' ? sp.local : c.localId)}
              rotulo="Remarcar para este horário"
              semana={{
                base: `/p/agenda/${c.id}`,
                rotulo: `${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`,
                anterior: s.semana > s.primeira ? somarDias(s.semana, -7) : null,
                proxima: s.semana < s.ultima ? somarDias(s.semana, 7) : null,
              }}
            />
          </section>
        )}
      </main>
    </>
  );
}
