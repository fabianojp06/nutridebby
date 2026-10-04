import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { DIAS_SEMANA, ROTULO_MODALIDADE_REGRA } from '@/modules/agenda/constantes';
import { listarBloqueios, listarRegras } from '@/modules/agenda/disponibilidade';
import { formatarQuando } from '@/modules/agenda/fuso';
import { excluirBloqueioAction, excluirRegraAction } from './actions';
import { BloqueioForm } from './bloqueio-form';
import { RegraForm } from './regra-form';

export const dynamic = 'force-dynamic';

export default async function HorariosPage() {
  const { ctx, tenant } = await requireNutri('/painel/agenda/horarios');
  const agora = new Date();
  const [regras, bloqueios] = await Promise.all([listarRegras(ctx), listarBloqueios(ctx, agora, new Date(agora.getTime() + 10 * 366 * 86_400_000))]);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-8 p-4 md:p-6">
        <p className="text-sm"><Link href="/painel/agenda" className="text-link underline">Agenda</Link></p>
        <h1 className="font-titulo text-2xl font-semibold">Horários de atendimento</h1>
        <section data-guia="regras-horario" aria-labelledby="regras" className="space-y-3">
          <h2 id="regras" className="text-lg font-semibold">Horários da semana</h2>
          {regras.length === 0 ? (
            <p>Nenhum horário cadastrado: a página de agendamento não oferece horários.</p>
          ) : (
            <ul className="divide-y divide-linha">
              {regras.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>{`${DIAS_SEMANA[r.diaSemana]}, ${r.inicio}–${r.fim}, ${r.duracaoMin} min, ${ROTULO_MODALIDADE_REGRA[r.modalidade]}`}</span>
                  <form action={excluirRegraAction.bind(null, r.id)}>
                    <ConfirmarBotao mensagem="Excluir este horário de atendimento?" rotulo={`Excluir ${DIAS_SEMANA[r.diaSemana]} ${r.inicio}–${r.fim}`}>Excluir</ConfirmarBotao>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-medium">Adicionar horário</h3>
          <RegraForm />
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
