import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { classeDoBotao } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import { getEnv } from '@/env';
import { configIA } from '@/modules/ia/modo';
import { MSG_IA_NUTRI, type Autor } from '@/modules/ia/nutri-paciente/constantes';
import { conversaNaFicha, type MensagemNaFicha } from '@/modules/ia/nutri-paciente/duvidas';
import { situacaoNaFicha, type SituacaoNaFicha } from '@/modules/ia/nutri-paciente/participacao';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';
import { MSG_BLOQUEADO, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../prontuario';
import { desativarPelaNutriAction, salvarLiberacaoIaNutriAction } from './actions';
import { LiberacaoForm } from './liberacao-form';

export const dynamic = 'force-dynamic';

const SITUACAO: Record<SituacaoNaFicha['liberacao'], string | null> = {
  nao: null,
  aguardando: MSG_IA_NUTRI.liberadaAguardando,
  em_uso: MSG_IA_NUTRI.liberadaEmUso,
  bloqueada: MSG_IA_NUTRI.bloqueada,
};
/** US-175 "Ver a conversa": o autor em texto (RNF-167: nunca só a cor ou a posição). */
const AUTOR: Record<Autor, string> = { paciente: 'Paciente', ia: MSG_IA_NUTRI.autorIa, sistema: MSG_IA_NUTRI.autorSistema };
/** O tratamento da dúvida (textos novos, desvio 5: à Debby). */
const DUVIDA: Record<NonNullable<MensagemNaFicha['duvida']>, string> = {
  aberta: `Na fila "${MSG_IA_NUTRI.fila}"`,
  vista: MSG_IA_NUTRI.vista,
  encerrada: 'Dúvida encerrada.',
};

/**
 * US-170 / US-175 / DP-17: a aba "IA Nutri" da ficha — a situação e a caixa "Liberar a IA Nutri para este paciente" (uma
 * action decide pela caixa), "Registrar desativação a pedido do paciente" (com consentimento em vigor; vale para o paciente
 * arquivado ou bloqueado, que não entra no app) e as conversas (auditadas: conversaNaFicha). O retorno das actions
 * (`?ia-nutri=`, lista fechada) fica na região `role="status"` sempre montada. Paciente bloqueado (pedido de exclusão): só
 * leitura, sem a caixa.
 */
export default async function IaNutriPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/ia-nutri'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const busca = await searchParams;
  let situacao: SituacaoNaFicha;
  try {
    situacao = await situacaoNaFicha(ctx, paciente.id, configIA(getEnv()).destino);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  const conversa = await conversaNaFicha(ctx, paciente.id);
  const textoDaSituacao = SITUACAO[situacao.liberacao];
  const retorno = busca['ia-nutri'];
  const RETORNO: Record<string, string | null> = {
    desativada: MSG_IA_NUTRI.desativadaPelaNutri,
    salvo: textoDaSituacao ?? MSG_IA_NUTRI.bloqueada,
    'peso-oculto': MSG_IA_NUTRI.pesoOculto,
    bloqueado: MSG_BLOQUEADO,
  };
  const status = typeof retorno === 'string' && Object.hasOwn(RETORNO, retorno) ? RETORNO[retorno] : null;
  const somenteLeitura = paciente.status === 'bloqueado' || !!paciente.anonimizadoEm;
  return (
    <section aria-labelledby="ia-nutri-aba" data-guia="ia-nutri-aba" className="max-w-3xl space-y-6">
      <div className="space-y-3">
        <h2 id="ia-nutri-aba" className="text-xl font-semibold">IA Nutri</h2>
        <p role="status">{status ?? ''}</p>
        {textoDaSituacao && <p className="font-semibold">{textoDaSituacao}</p>}
        {!somenteLeitura && (
          <LiberacaoForm acao={salvarLiberacaoIaNutriAction.bind(null, paciente.id)} liberado={situacao.liberacao === 'aguardando' || situacao.liberacao === 'em_uso'} pesoOculto={situacao.pesoOculto} />
        )}
        {situacao.podeRegistrarDesativacao && (
          <form action={desativarPelaNutriAction.bind(null, paciente.id)}>
            <ConfirmarBotao className={classeDoBotao('secundario')} mensagem={MSG_IA_NUTRI.confirmarDesativarPelaNutri}>
              {MSG_IA_NUTRI.desativarPelaNutri}
            </ConfirmarBotao>
          </form>
        )}
      </div>
      <section aria-labelledby="ia-nutri-conversas" className="space-y-3">
        <h3 id="ia-nutri-conversas" className="text-lg font-semibold">Conversas</h3>
        {conversa.length === 0 ? (
          <p className="text-suave">Nenhuma conversa com a IA Nutri.</p>
        ) : (
          <ol className="space-y-3">
            {conversa.map((m) => (
              <li key={m.id} className="space-y-1 rounded-2xl border border-borda bg-cartao p-3">
                <p className="text-sm text-suave">
                  <span className="font-semibold text-texto">{AUTOR[m.autor]}</span>
                  {` · ${formatarDataHora(m.criadaEm, tenant.fuso)}`}
                </p>
                <p className="wrap-break-word whitespace-pre-line">{m.texto ?? (m.textoFixo ? TEXTOS_FIXOS[m.textoFixo] : MSG_IA_NUTRI.apagada)}</p>
                {(m.categoria || m.risco || m.avaliacao === 'nao_ajudou' || m.duvida) && (
                  <p className="flex flex-wrap gap-2">
                    {m.risco && <Selo>{MSG_IA_NUTRI.seloRisco}</Selo>}
                    {m.categoria && !m.risco && <Selo>{m.categoria}</Selo>}
                    {m.avaliacao === 'nao_ajudou' && <Selo>{MSG_IA_NUTRI.naoAjudouSelo}</Selo>}
                    {m.duvida && <Selo>{DUVIDA[m.duvida]}</Selo>}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
