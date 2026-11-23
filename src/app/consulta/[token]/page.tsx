import type { Metadata } from 'next';
import { abrirLinkConsulta, horariosDoLink, MENSAGEM_DO_LINK } from '@/modules/agenda/acoes-link';
import { semanaDaJanela } from '@/modules/agenda/agendamento-paciente';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { inicioDoDia, somarDias } from '@/modules/agenda/fuso';
import { localInicial } from '@/modules/agenda/horarios';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { AcoesConsulta } from './acoes';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /consulta/*)
export const metadata: Metadata = { title: 'Sua consulta', referrer: 'no-referrer', robots: { index: false, follow: false } };

const SITUACAO = { agendada: 'Agendada', confirmada: 'Presença confirmada', cancelada: MSG_AGENDA.consultaJaCancelada, realizada: 'Consulta realizada', faltou: 'Consulta encerrada' } as const;

function Aviso({ texto }: { texto: string }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sua consulta</h1>
      <p role="alert">{texto}</p>
    </main>
  );
}

/** D20 / US-033 / US-035: página do link assinado. O GET só lê (a pré-visualização do WhatsApp abre a URL). */
export default async function ConsultaPeloLink({ params, searchParams }: PageProps<'/consulta/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const e = await abrirLinkConsulta(token);
  if (e.estado !== 'ok') return <Aviso texto={MENSAGEM_DO_LINK[e.estado]} />;
  const { semana, primeira, ultima } = semanaDaJanela(sp.semana, hojeNoFuso(e.fuso));
  const horarios = e.podeAlterar ? await horariosDoLink(token, inicioDoDia(semana, e.fuso), inicioDoDia(somarDias(semana, 7), e.fuso)) : [];
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sua consulta</h1>
      <p>{`Com ${e.nutri} · ${e.quando} · ${ROTULO_MODALIDADE[e.modalidade]}${e.local.nome ? ` · ${e.local.nome}` : ''}`}</p>
      {e.local.endereco && <p className="text-sm">{`Endereço: ${e.local.endereco}`}</p>}
      {e.linkChamada && <p className="text-sm">{`Link da chamada: ${e.linkChamada}`}</p>}
      <p role="status">{SITUACAO[e.status]}</p>
      <AcoesConsulta
        token={token}
        ativa={e.ativa}
        confirmada={e.confirmada}
        podeAlterar={e.podeAlterar}
        pedidoRemarcacao={e.pedidoRemarcacao}
        locais={e.locais}
        localInicial={localInicial(e.locais, horarios, typeof sp.local === 'string' ? sp.local : e.localId)}
        semana={{
          rotulo: `${formatarData(semana)} a ${formatarData(somarDias(semana, 6))}`,
          anterior: semana > primeira ? somarDias(semana, -7) : null,
          proxima: semana < ultima ? somarDias(semana, 7) : null,
        }}
        horarios={horarios}
      />
    </main>
  );
}
