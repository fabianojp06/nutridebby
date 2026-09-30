import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from '../../cabecalho';
import { criarPacienteAction } from '../actions';
import { PacienteForm } from '../paciente-form';

export const dynamic = 'force-dynamic';

const VAZIO = { nome: '', dataNascimento: '', sexo: '', email: '', telefone: '', whatsappAutorizado: false };

export default async function NovoPacientePage() {
  const { tenant } = await requireNutri('/painel/pacientes/novo');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Novo paciente</h1>
        <PacienteForm acao={criarPacienteAction} inicial={VAZIO} botao="Cadastrar paciente" />
      </main>
    </>
  );
}
