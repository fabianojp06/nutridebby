import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { EQUIPE_LIGADA, MSG_EQUIPE } from '@/modules/plataforma/equipe-textos';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { ExamesSecao } from './exames-secao';
import { IaSecao } from './ia-secao';
import { RETORNOS_IA_NUTRI } from './ia-nutri-secao';
import { TemaForm } from './tema-form';

export const dynamic = 'force-dynamic';

const CARTOES = [
  { href: '/painel/configuracoes/perfil', titulo: 'Perfil e marca', texto: 'Nome, CRN, logo, cor, regras da agenda e dados para documentos.' },
  { href: '/painel/agenda/horarios', titulo: 'Horários de atendimento', texto: 'Dias, horários e bloqueios da agenda.' },
  { href: '/painel/whatsapp', titulo: 'WhatsApp', texto: 'Conectar o número do consultório.' },
  { href: '/painel/alimentos', titulo: 'Alimentos', texto: 'Tabela TACO e os seus alimentos.' },
  { href: '/painel/planos/modelos', titulo: 'Modelos de plano', texto: 'Planos prontos para começar mais rápido.' },
  { href: '/painel/anamnese/modelos', titulo: 'Modelos de anamnese', texto: 'Perguntas da primeira consulta.' },
  { href: '/conta/seguranca', titulo: 'Segurança', texto: 'Senha e verificação em duas etapas.' },
  // Plano 22 (T3, EP-D33): no fim
  { href: '/painel/exames/catalogo', titulo: 'Exames', texto: 'Catálogo de exames, faixas do consultório e modelos de solicitação.' },
  // Plano 26 (§7.2, RE-D52): a Equipe, no fim, só com a constante ligada (T11b)
  ...(EQUIPE_LIGADA ? [{ href: '/painel/configuracoes/equipe', titulo: MSG_EQUIPE.cartao.titulo, texto: MSG_EQUIPE.cartao.texto }] : []),
];

/** D20: hub de Configurações. */
export default async function ConfiguracoesPage({ searchParams }: PageProps<'/painel/configuracoes'>) {
  const { data, tenant, ctx } = await requireNutri('/painel/configuracoes');
  const busca = await searchParams;
  const { ia, exames, modelos } = busca;
  // Plano 15 (US-170): o retorno das actions da IA Nutri — lista fechada; outro valor (inclusive o antigo `revisao`) → nada
  const iaNutri = busca['ia-nutri'];
  const iaNutriRetorno = RETORNOS_IA_NUTRI.find((r) => r === iaNutri) ?? null;
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-6 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">Configurações</h1>
      <ul data-guia="cartoes-configuracoes" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {CARTOES.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="block h-full rounded-3xl border border-borda bg-cartao p-5 hover:border-campo">
              <span className="block font-titulo text-lg font-semibold">{c.titulo}</span>
              <span className="mt-1 block text-suave">{c.texto}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section data-guia="tema-form" aria-labelledby="tema" className="max-w-lg rounded-3xl border border-borda bg-cartao p-5">
        <h2 id="tema" className="sr-only">Tema</h2>
        <TemaForm tema={ehTema(data.user.tema) ? data.user.tema : 'sistema'} />
      </section>
      <ExamesSecao ligado={!!tenant.examesPacienteAtivadoEm} salvo={exames === 'salvo'} />
      <IaSecao tenant={tenant} ctx={ctx} ativada={ia === 'ativada'} modelosPedido={modelos === 'pedido'} iaNutriRetorno={iaNutriRetorno} />
    </main>
  );
}
