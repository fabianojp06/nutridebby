import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { FONTES_DO_PAINEL } from '@/app/fontes-painel';
import { METADADOS_DO_PAINEL } from '@/app/manifesto-painel';
import { VigiaDeSessao } from '@/components/vigia-sessao';
import { requireEquipe } from '@/lib/tenant-session';
import { contadorDeDuvidas } from '@/modules/ia/nutri-paciente/duvidas';
import { contarEnviosRecebidos } from '@/modules/pacientes/exames-enviados';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { lerGuia } from '@/modules/plataforma/preferencias';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { CabecalhoPainel } from './cabecalho';

export const metadata: Metadata = METADADOS_DO_PAINEL;

/**
 * Visual V2 (D24): o tema (data-tema, D17) e a cor do consultório (D19) valem para todas as telas do painel. O layout
 * NÃO é barreira de segurança: cada página chama requireNutri, ou requireEquipe nas de ROTAS_DA_RECEPCAO (guardas em
 * cabecalho.test.ts e rotas-da-recepcao.test.ts). O contêiner é bloco, não flex: num flex em coluna, o
 * `<main className="mx-auto max-w-*">` das telas ficaria com a largura do próprio conteúdo.
 *
 * Plano 26 (T6, T8 — RN-514): o layout abre também para a recepção — "Sem permissão" e "Contrato pendente" ficam dentro do
 * painel, e com requireNutri aqui a recepção voltaria a "Sem permissão" sem fim. Com o DPA em dia, o cabeçalho completo do
 * papel: o menu dela (`itensDoMenu`, com o Financeiro só com a permissão), o menu da conta e o manual guiado dela (RE-D42).
 * Os contadores clínicos (`contarEnviosRecebidos`, `contadorDeDuvidas` e os de outros planos) são SÓ da nutricionista: a
 * recepção nem chega a chamá-los (espião de leituras negadas em layout.test.ts, R-482). Contador novo de outro plano fica
 * dentro do ramo `nutri` por padrão.
 */
export default async function PainelLayout({ children }: LayoutProps<'/painel'>) {
  const { data, tenant, ctx, papel, financeiro } = await requireEquipe('/painel', { permitirDpaPendente: true });
  const marca = getTenantBrand(tenant);
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
  const completo = tenant.dpaVersao === DPA_VERSAO;
  const nutri = completo && papel === 'nutri';
  // D27: o progresso do manual guiado é só o valor inicial do GuiaDoPainel (a navegação pelo cliente não refaz o layout)
  const progresso = completo ? await lerGuia(data.user.id) : null;
  // US-162 / D11: o contador do menu; o layout não refaz na navegação pelo cliente — as ações da revisão chamam
  // revalidatePath('/painel', 'layout'), e um envio novo aparece na próxima navegação completa
  const pendentes = nutri ? await contarEnviosRecebidos(ctx) : 0;
  const exames = { mostrar: nutri && (!!tenant.examesPacienteAtivadoEm || pendentes > 0), pendentes };
  // Plano 15 (US-175): "Dúvidas dos pacientes (n)" com a IA Nutri ativada ou com dúvida aberta (a fila continua depois de
  // desativar); revalidatePath('/painel', 'layout') nas ações da fila e da ativação
  const abertas = nutri ? await contadorDeDuvidas(ctx) : 0;
  const duvidas = { mostrar: nutri && (!!tenant.iaNutriAtivadaEm || abertas > 0), pendentes: abertas };
  return (
    <div data-tema={tema} style={cores} className={`${FONTES_DO_PAINEL} min-h-dvh bg-fundo font-sans text-texto`}>
      <CabecalhoPainel marca={marca} nome={data.user.name} email={data.user.email} tema={tema} completo={completo} progresso={progresso} exames={exames} duvidas={duvidas} papel={papel} financeiro={financeiro} />
      {children}
      {/* P12-14: aviso de inatividade e saída automática (30 min sem uso, 8 h de limite) */}
      <VigiaDeSessao />
    </div>
  );
}
