import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { MSG_IA } from '@/modules/ia/constantes';
import { situacaoDaCotaIa } from '@/modules/ia/cota';
import { configIA, estadoIaDoTenant } from '@/modules/ia/modo';
import { aditivoIa, IA_ADITIVO_VERSAO, textoCorrido } from '@/modules/ia/textos-legais';
import type { PausaIaNutri } from '@/modules/plataforma/ia-nutri-pausa';
import { desativarIaAction } from './actions';
import { IaAtivarForm } from './ia-ativar-form';
import { IaNutriSecao, type RetornoIaNutri } from './ia-nutri-secao';
import { ModelosIa } from './modelos-ia';

/**
 * US-101 / US-102: seção "Inteligência artificial (IA)" de Configurações. Sem IA_PROVEDOR, a seção não existe.
 * `ativada`: a página recebeu `?ia=ativada` do `ativarIaAction`; a confirmação só aparece se a IA está mesmo ativa.
 * `modelosPedido`: a página recebeu `?modelos=pedido` do `pedirModelosAction` (US-123 "Gerar"); vai para `ModelosIa`.
 * Plano 15 (US-170): com a IA ativa, a subseção "IA Nutri (pacientes)" por último (depois dos modelos e de "Desativar a IA"); `iaNutriRetorno` é o `?ia-nutri=`
 * (lista fechada) e `pausa` só vem dos testes.
 */
export async function IaSecao({ tenant, ctx, ativada = false, modelosPedido = false, iaNutriRetorno = null, pausa }: { tenant: TenantRow; ctx: TenantContext; ativada?: boolean; modelosPedido?: boolean; iaNutriRetorno?: RetornoIaNutri | null; pausa?: PausaIaNutri }) {
  const { modo, destino } = configIA(getEnv());
  const estado = estadoIaDoTenant(tenant, modo);
  if (estado === 'ausente' || estado === 'suspensa' || !destino) return null;
  const texto = aditivoIa(destino); // RN-109: fornecedor, mecanismo da transferência e retenção mudam conforme o provedor em uso (§18.5)
  const aditivo = (
    <details className="rounded-2xl border border-borda p-3">
      <summary className="cursor-pointer font-semibold">{`${texto.titulo} (versão ${IA_ADITIVO_VERSAO})`}</summary>
      <div className="mt-2 space-y-2">{texto.paragrafos.map((p, i) => <p key={i}>{textoCorrido(p)}</p>)}</div>
    </details>
  );
  const cota = estado === 'ativa' ? await situacaoDaCotaIa(ctx, tenant) : null;
  return (
    <section data-guia="ia-secao" aria-labelledby="ia-titulo" className="max-w-2xl space-y-3 rounded-3xl border border-borda bg-cartao p-5">
      <h2 id="ia-titulo" className="font-titulo text-lg font-semibold">Inteligência artificial (IA)</h2>
      <p className="text-suave">Leitura de laudos, resumo do histórico, rascunho de plano alimentar e modelos sugeridos: a IA sugere e você confere antes de usar.</p>
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
          <ModelosIa ctx={ctx} fuso={tenant.fuso} pedido={modelosPedido} />
          {aditivo}
          <form action={desativarIaAction}>
            <ConfirmarBotao mensagem="Desativar a IA? As leituras na fila são canceladas e as sugestões ainda não salvas são descartadas.">Desativar a IA</ConfirmarBotao>
          </form>
          {/* a última subseção: o "Desativar a IA" acima continua sendo da IA do consultório, não da IA Nutri */}
          <IaNutriSecao tenant={tenant} ctx={ctx} retorno={iaNutriRetorno} pausa={pausa} />
        </>
      )}
    </section>
  );
}
