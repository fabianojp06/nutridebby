import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { FONTES_DO_PAINEL } from '@/app/fontes-painel';
import { METADADOS_DO_PAINEL } from '@/app/manifesto-painel';
import { VigiaDeSessao } from '@/components/vigia-sessao';
import { requireNutri } from '@/lib/tenant-session';
import { contadorDeDuvidas } from '@/modules/ia/nutri-paciente/duvidas';
import { contadorDeMensagens } from '@/modules/mensagens/caixa';
import { contarEnviosRecebidos } from '@/modules/pacientes/exames-enviados';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { lerGuia } from '@/modules/plataforma/preferencias';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { CabecalhoPainel } from './cabecalho';

export const metadata: Metadata = METADADOS_DO_PAINEL;

/**
 * Visual V2 (D24): o tema (data-tema, D17) e a cor do consultório (D19) valem para todas as telas do painel. O layout
 * NÃO é barreira de segurança: cada página chama requireNutri (guarda em cabecalho.test.ts). O contêiner é bloco, não
 * flex: num flex em coluna, o `<main className="mx-auto max-w-*">` das telas ficaria com a largura do próprio conteúdo.
 */
export default async function PainelLayout({ children }: LayoutProps<'/painel'>) {
  const { data, tenant, ctx } = await requireNutri('/painel', { permitirDpaPendente: true });
  const marca = getTenantBrand(tenant);
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
  const completo = tenant.dpaVersao === DPA_VERSAO;
  // D27: o progresso do manual guiado é só o valor inicial do GuiaDoPainel (a navegação pelo cliente não refaz o layout)
  const progresso = completo ? await lerGuia(data.user.id) : null;
  // US-162 / D11: o contador do menu; o layout não refaz na navegação pelo cliente — as ações da revisão chamam
  // revalidatePath('/painel', 'layout'), e um envio novo aparece na próxima navegação completa
  const pendentes = completo ? await contarEnviosRecebidos(ctx) : 0;
  const exames = { mostrar: !!tenant.examesPacienteAtivadoEm || pendentes > 0, pendentes };
  // Plano 25 (RN-459, CH-D43): "Mensagens (n)" sempre, com n = conversas com mensagem do paciente não lida + dúvidas abertas
  // da IA Nutri (a fila do Plano 15 virou a aba "Dúvidas da IA Nutri"); revalidatePath('/painel', 'layout') nas ações da
  // fila e da conversa, e a consulta de 60 s do MenuPainel (contador-de-mensagens.tsx) entre uma navegação completa e outra
  const [naoLidas, abertas] = completo ? await Promise.all([contadorDeMensagens(ctx), contadorDeDuvidas(ctx)]) : [0, 0];
  const mensagens = { mostrar: true, pendentes: naoLidas + abertas };
  return (
    <div data-tema={tema} style={cores} className={`${FONTES_DO_PAINEL} min-h-dvh bg-fundo font-sans text-texto`}>
      <CabecalhoPainel marca={marca} nome={data.user.name} email={data.user.email} tema={tema} completo={completo} progresso={progresso} exames={exames} mensagens={mensagens} />
      {children}
      {/* P12-14: aviso de inatividade e saída automática (30 min sem uso, 8 h de limite) */}
      <VigiaDeSessao />
    </div>
  );
}
