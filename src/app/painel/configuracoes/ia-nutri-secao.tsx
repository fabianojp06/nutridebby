import type { ReactNode } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import { classeDoBotao } from '@/components/ui/botao';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { situacaoDaCotaIa } from '@/modules/ia/cota';
import { configIA } from '@/modules/ia/modo';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { estadoIaNutriDoTenant } from '@/modules/ia/nutri-paciente/estado';
import { TEXTOS_FIXOS, type CodigoTextoFixo } from '@/modules/ia/nutri-paciente/textos';
import { IA_ADITIVO_VERSAO, IA_NUTRI_TERMO_VERSAO, responsavelDoTenant, textoDoConsentimentoIaNutri } from '@/modules/ia/textos-legais';
import { lerPausa, type PausaIaNutri } from '@/modules/plataforma/ia-nutri-pausa';
import { ativarIaNutriAction, desativarIaNutriAction } from './actions';
import { IaAtivarForm } from './ia-ativar-form';

/** O retorno das actions (`?ia-nutri=`), lista fechada (a página descarta qualquer outro valor). */
export type RetornoIaNutri = 'ativada' | 'desativada' | 'indisponivel';
export const RETORNOS_IA_NUTRI: readonly RetornoIaNutri[] = ['ativada', 'desativada', 'indisponivel'];
const MSG_RETORNO: Record<RetornoIaNutri, string> = { ativada: MSG_IA_NUTRI.ativada, desativada: MSG_IA_NUTRI.desativadaConsultorio, indisponivel: MSG_IA_NUTRI.naoDisponivel };

/** US-170 "Veja o que o paciente lê": os textos fixos de risco e de recusa (a ordem da spec: risco primeiro). */
const TEXTOS_QUE_O_PACIENTE_LE: readonly CodigoTextoFixo[] = ['risco_emergencia', 'sintoma_agudo', 'risco_transtorno', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva'];

/**
 * US-170: a subseção "IA Nutri (pacientes)" dentro da IA do consultório (só com a IA ativa). Aditivo < 1.2 → o aviso e
 * "Aceitar a versão atual" (a leitura de laudos continua); antes de ativar, o que a ativação liga (a aba "IA Nutri" na
 * ficha, a fila e o que se espera dela — D7) e o protocolo do "Sinal de risco" (D11, texto final — DP-18); "Veja o que o
 * paciente lê" com o consentimento 1.0 e os textos fixos de risco e de recusa. Sem trava de texto: a nutricionista ativa
 * quando quiser (★ DO-1 = não, D37). Na pausa de EMERGÊNCIA da plataforma (ou sem a retenção aceita), num consultório que
 * NUNCA ativou → nada (a subseção volta quando o suporte retoma; o mesmo erro corrigido na 14B-2). O retorno das actions
 * (`?ia-nutri=`) aparece aqui dentro, na região `role="status"` sempre montada logo abaixo do título (o `#ia-nutri-titulo` da
 * URL leva a ela). `pausa` só vem dos testes (a linha do banco comum nunca é pausada, T1).
 */
export async function IaNutriSecao({ tenant, ctx, retorno = null, pausa }: { tenant: TenantRow; ctx: TenantContext; retorno?: RetornoIaNutri | null; pausa?: PausaIaNutri }) {
  const ia = configIA(getEnv());
  const estado = estadoIaNutriDoTenant(tenant, ia, pausa ?? (await lerPausa(getDb())));
  const ativada = !!tenant.iaNutriAtivadaEm;
  if ((estado === 'pausada' || estado === 'sem_ia') && !ativada) return null;
  const cota = estado === 'ativa' || ativada ? await situacaoDaCotaIa(ctx, tenant, new Date(), getDb(), 'paciente') : null;
  const resp = responsavelDoTenant(tenant);
  const texto = resp && ia.destino ? textoDoConsentimentoIaNutri(IA_NUTRI_TERMO_VERSAO, { ...resp, destino: ia.destino }) : null;
  const protocolo = (
    <div className="space-y-1 rounded-2xl border border-borda p-3">
      {MSG_IA_NUTRI.protocoloRisco.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
  const oQueLe = (
    <details className="rounded-2xl border border-borda p-3">
      <summary className="cursor-pointer font-semibold">{MSG_IA_NUTRI.vejaOQueOPacienteLe}</summary>
      <div className="mt-2 space-y-3">
        {texto && <TextoLegalView texto={texto} id="consentimento-ia-nutri" nivel="h4" classeTitulo="font-semibold" />}
        <ul className="list-disc space-y-1 pl-5">
          {TEXTOS_QUE_O_PACIENTE_LE.map((c) => (
            <li key={c}>{TEXTOS_FIXOS[c]}</li>
          ))}
        </ul>
      </div>
    </details>
  );
  return (
    <section id="ia-nutri" aria-labelledby="ia-nutri-titulo" data-guia="ia-nutri-secao" className="scroll-mt-24 space-y-3 border-t border-borda pt-3">
      <h3 id="ia-nutri-titulo" className="font-semibold">IA Nutri (pacientes)</h3>
      <p role="status">{retorno ? MSG_RETORNO[retorno] : ''}</p>
      {(estado === 'pausada' || estado === 'sem_ia') && <Aviso tipo="aviso" papel="nenhum">{estado === 'pausada' ? MSG_IA_NUTRI.pausada : MSG_IA_NUTRI.naoDisponivel}</Aviso>}
      {estado === 'aditivo_desatualizado' && (
        <>
          <Aviso tipo="aviso" papel="nenhum">{MSG_IA_NUTRI.aditivoNovo}</Aviso>
          <IaAtivarForm versao={IA_ADITIVO_VERSAO} rotulo="Aceitar a versão atual" />
        </>
      )}
      {estado === 'desativada' && (
        <>
          <p>{MSG_IA_NUTRI.avisoAtivar}</p>
          <p>{MSG_IA_NUTRI.avisoAtivacaoFila}</p>
          {protocolo}
          {oQueLe}
          <form action={ativarIaNutriAction}>
            <ConfirmarBotao className={classeDoBotao()} mensagem={`${MSG_IA_NUTRI.avisoAtivar} ${MSG_IA_NUTRI.avisoAtivacaoFila}`}>{MSG_IA_NUTRI.ativar}</ConfirmarBotao>
          </form>
        </>
      )}
      {cota && (estado === 'ativa' || ativada) && estado !== 'aditivo_desatualizado' && (
        <UsoEAcoes cota={cota} protocolo={protocolo} oQueLe={oQueLe} />
      )}
    </section>
  );
}

/** US-170 / US-176: o uso do mês (só a porcentagem, como a IA da nutricionista), os avisos de 80% e de esgotada e "Desativar". */
function UsoEAcoes({ cota, protocolo, oQueLe }: { cota: { percentual: number; nivel: 'ok' | 'aviso' | 'esgotada' }; protocolo: ReactNode; oQueLe: ReactNode }) {
  return (
    <>
      <p>{MSG_IA_NUTRI.usoDoMes(cota.percentual)}</p>
      {cota.nivel === 'aviso' && <Aviso tipo="aviso" papel="nenhum">{MSG_IA_NUTRI.aviso80}</Aviso>}
      {cota.nivel === 'esgotada' && <Aviso tipo="aviso" papel="nenhum">{MSG_IA_NUTRI.cotaAcabou}</Aviso>}
      {protocolo}
      {oQueLe}
      <form action={desativarIaNutriAction}>
        <ConfirmarBotao className={classeDoBotao('secundario')} mensagem={MSG_IA_NUTRI.confirmarDesativarConsultorio}>{MSG_IA_NUTRI.desativarConsultorio}</ConfirmarBotao>
      </form>
    </>
  );
}
