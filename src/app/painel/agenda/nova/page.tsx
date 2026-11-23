import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_LOCAIS } from '@/modules/agenda/constantes';
import { dataDaAgendaOuHoje } from '@/modules/agenda/fuso';
import { locaisDoPainel } from '@/modules/agenda/locais';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { listarPacientes } from '@/modules/pacientes/pacientes';
import { agendarAction } from '../actions';
import { ConsultaForm } from '../consulta-form';

export const dynamic = 'force-dynamic';

export default async function NovaConsultaPage({ searchParams }: PageProps<'/painel/agenda/nova'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/nova');
  const sp = await searchParams;
  // Plano 18 (D7): a agenda mostra o nome de registro (`p.nome`), então ordena por ele
  const pacientes = await listarPacientes(ctx, { aba: 'ativos', ordem: 'registro' });
  // Plano 23 (RN-407, AG-D45): os locais iniciais garantidos antes do formulário; "Local" vem com o principal
  const locais = await locaisDoPainel(ctx);
  const principal = (locais.find((l) => l.principal) ?? locais[0])?.id ?? '';
  const data = dataDaAgendaOuHoje(sp.data, hojeNoFuso(tenant.fuso));
  // `?paciente=` que não é de um paciente ativo da lista fica sem seleção (o <select> sem opção igual escolheria o primeiro paciente)
  const patientId = typeof sp.paciente === 'string' && pacientes.some((p) => p.id === sp.paciente) ? sp.paciente : '';
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <p className="text-sm"><Link href={`/painel/agenda?data=${data}`} className="text-link underline">Agenda</Link></p>
        <h1 className="font-titulo text-2xl font-semibold">Nova consulta</h1>
        {locais.length === 0 ? (
          <p>{MSG_LOCAIS.vazio} <Link href="/painel/agenda/locais" className="text-link underline">Locais de atendimento</Link></p>
        ) : (
          // minimização: ao componente de cliente só vai o que a lista de escolha mostra (e, do local, o que o formulário usa)
          <ConsultaForm acao={agendarAction} pacientes={pacientes.map(({ id, nome, email }) => ({ id, nome, email }))} locais={locais.map(({ id, nome, tipo, linkSala }) => ({ id, nome, tipo, linkSala }))}
            botao="Marcar consulta" inicial={{ patientId, data, hora: '', duracaoMin: '60', localId: principal, linkOnline: '' }} />
        )}
      </main>
    </>
  );
}
