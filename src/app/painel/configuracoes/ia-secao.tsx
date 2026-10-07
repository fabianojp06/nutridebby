import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { MSG_IA } from '@/modules/ia/constantes';
import { situacaoDaCotaIa } from '@/modules/ia/cota';
import { configIA, estadoIaDoTenant } from '@/modules/ia/modo';
import { IA_ADITIVO_PARAGRAFOS, IA_ADITIVO_TITULO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { desativarIaAction } from './actions';
import { IaAtivarForm } from './ia-ativar-form';

/**
 * US-101 / US-102: seção "Inteligência artificial (IA)" de Configurações. Sem IA_PROVEDOR, a seção não existe.
 * `ativada`: a página recebeu `?ia=ativada` do `ativarIaAction`; a confirmação só aparece se a IA está mesmo ativa.
 */
export async function IaSecao({ tenant, ctx, ativada = false }: { tenant: TenantRow; ctx: TenantContext; ativada?: boolean }) {
  const estado = estadoIaDoTenant(tenant, configIA(getEnv()).modo);
  if (estado === 'ausente' || estado === 'suspensa') return null;
  const aditivo = (
    <details className="rounded-2xl border border-borda p-3">
      <summary className="cursor-pointer font-semibold">{`${IA_ADITIVO_TITULO} (versão ${IA_ADITIVO_VERSAO})`}</summary>
      <div className="mt-2 space-y-2">{IA_ADITIVO_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}</div>
    </details>
  );
  const cota = estado === 'ativa' ? await situacaoDaCotaIa(ctx, tenant) : null;
  return (
    <section data-guia="ia-secao" aria-labelledby="ia-titulo" className="max-w-2xl space-y-3 rounded-3xl border border-borda bg-cartao p-5">
      <h2 id="ia-titulo" className="font-titulo text-lg font-semibold">Inteligência artificial (IA)</h2>
      <p className="text-suave">Leitura de laudos de exames: a IA sugere os valores e você confere antes de salvar.</p>
      {estado === 'emergencia' && <Aviso tipo="aviso">{MSG_IA.indisponivel}</Aviso>}
      {estado === 'nao_liberada' && <p>{MSG_IA.naoLiberada}</p>}
      {(estado === 'nao_ativada' || estado === 'aditivo_desatualizado') && (
        <>
          {estado === 'aditivo_desatualizado' && <Aviso tipo="aviso">{MSG_IA.aditivoDesatualizado}</Aviso>}
          {aditivo}
          <IaAtivarForm versao={IA_ADITIVO_VERSAO} rotulo={estado === 'nao_ativada' ? 'Ativar a IA no consultório' : 'Aceitar a versão atual'} />
        </>
      )}
      {estado === 'ativa' && cota && (
        <>
          {ativada && <Aviso tipo="ok">{MSG_IA.iaAtivada}</Aviso>}
          <p role="status">{MSG_IA.usoDoMes(cota.percentual)}</p>
          {cota.nivel === 'aviso' && <Aviso tipo="aviso">{MSG_IA.aviso80}</Aviso>}
          {cota.nivel === 'esgotada' && <Aviso tipo="aviso">{MSG_IA.cotaAcabou}</Aviso>}
          {aditivo}
          <form action={desativarIaAction}>
            <ConfirmarBotao mensagem="Desativar a IA? As leituras na fila são canceladas e as sugestões ainda não salvas são descartadas.">Desativar a IA</ConfirmarBotao>
          </form>
        </>
      )}
    </section>
  );
}
