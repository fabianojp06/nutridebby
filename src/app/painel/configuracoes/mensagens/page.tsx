import { requireNutri } from '@/lib/tenant-session';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { lerConfiguracao } from '@/modules/mensagens/horario';
import { FormularioDoHorario } from './horario-form';

export const dynamic = 'force-dynamic';

const C = MSG_MENSAGENS.configuracao;

/**
 * US-446 (RN-451, RN-472): "Atendimento por mensagens" — o horário que o app mostra ao paciente (informativo: nunca
 * impede o envio) e o aviso por e-mail à nutricionista. Sem linha gravada, os padrões (horário desligado, aviso ligado).
 * A região `role="status"` fica sempre montada, com "Configuração salva." depois de gravar (`?ok=salva`).
 */
export default async function AtendimentoPorMensagens({ searchParams }: PageProps<'/painel/configuracoes/mensagens'>) {
  const { ctx } = await requireNutri('/painel/configuracoes/mensagens');
  const sp = await searchParams;
  const salva = sp.ok === 'salva';
  // o marcador da gravação (`r`, gerado pela action) só serve para a região anunciar de novo; fora do formato, vazio
  const marcador = salva && typeof sp.r === 'string' && /^[0-9a-f]{8}$/.test(sp.r) ? sp.r : '';
  const config = await lerConfiguracao(ctx);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">{C.titulo}</h1>
      <p key={marcador} role="status">
        {salva ? C.salva : ''}
      </p>
      <FormularioDoHorario inicial={config} />
    </main>
  );
}
