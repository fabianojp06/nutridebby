import { requireNutri } from '@/lib/tenant-session';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { criarPacienteAction } from '../actions';
import { PacienteForm } from '../paciente-form';
import { avisoDoConviteWhatsapp, VALORES_VAZIOS } from '../valores';

export const dynamic = 'force-dynamic';

/** Plano 18 (§8.4): o mesmo formulário em seções do Perfil, sem Acesso ao app (o convite sai ao salvar) e sem Etiquetas. */
export default async function NovoPacientePage() {
  const { ctx } = await requireNutri('/painel/pacientes/novo');
  // US-010 (rodada 1): a opção continua valendo; o aviso diz quando o convite iria só por e-mail
  const aviso = avisoDoConviteWhatsapp(await situacaoDoWhatsapp(ctx, provedorDoApp() !== null));
  return (
    <>
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="font-titulo text-2xl font-semibold">Novo paciente</h1>
        <PacienteForm acao={criarPacienteAction} inicial={VALORES_VAZIOS} botao="Cadastrar paciente" conviteWhatsapp={{ aviso }} />
      </main>
    </>
  );
}
