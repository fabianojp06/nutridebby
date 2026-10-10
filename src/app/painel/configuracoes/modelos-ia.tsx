import { EstadoTarefa } from '@/app/painel/ia/estado-tarefa';
import type { TenantContext } from '@/db/tenant';
import { AREA_ROTULO, AREAS_MODELOS_IA, MSG_MODELOS_IA } from '@/modules/ia/constantes';
import { situacaoDasAreas } from '@/modules/ia/modelos-sugeridos';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { ModelosIaForm } from './modelos-ia-form';

/**
 * US-123 "Onde fica": as áreas, "Gerado em {data}" por área e o pacote em andamento (acompanhado só pela situação, sem
 * auditoria). Renderizado por `IaSecao` só com a IA ativa no consultório.
 */
export async function ModelosIa({ ctx, fuso }: { ctx: TenantContext; fuso: string }) {
  const s = await situacaoDasAreas(ctx);
  const andamento = AREAS_MODELOS_IA.find((a) => s[a].emAndamento);
  const falhou = AREAS_MODELOS_IA.some((a) => s[a].falhou && !s[a].emAndamento);
  return (
    <section aria-labelledby="modelos-ia-titulo" data-guia="modelos-ia" className="space-y-2 border-t border-borda pt-3">
      <h3 id="modelos-ia-titulo" className="font-semibold">{MSG_MODELOS_IA.titulo}</h3>
      <p className="text-suave">{MSG_MODELOS_IA.explicacao}</p>
      <ul className="space-y-1">
        {AREAS_MODELOS_IA.map((a) => {
          const geradoEm = s[a].geradoEm;
          return (
            <li key={a}>
              {AREA_ROTULO[a]}
              {geradoEm && <span className="text-suave">{` — ${MSG_MODELOS_IA.geradoEm(formatarDataNoFuso(geradoEm, fuso))}`}</span>}
            </li>
          );
        })}
      </ul>
      {andamento ? (
        <p role="status">
          {MSG_MODELOS_IA.gerando(AREA_ROTULO[andamento])}
          <EstadoTarefa url={`/api/painel/ia/geracoes/${s[andamento].emAndamento!.id}`} />
        </p>
      ) : (
        <ModelosIaForm falhou={falhou ? MSG_MODELOS_IA.falha : null} />
      )}
    </section>
  );
}
