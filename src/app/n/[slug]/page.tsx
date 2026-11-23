import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnv } from '@/env';
import { carregarPaginaPublica } from '@/modules/agenda/agendamento-publico';
import { MSG_AGENDA, MSG_PUBLICO } from '@/modules/agenda/constantes';
import { somarDias } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { telaDoPortal } from '@/modules/portal/link-portal';
import { TERMO_PACIENTE_ROTULO, TERMO_PACIENTE_TITULO, TERMO_PACIENTE_VERSAO } from '@/modules/pacientes/termo-paciente';
import { TERMO_PACIENTE_PARAGRAFOS } from '@/modules/pacientes/termo-paciente-textos';
import { AgendarForm } from './agendar-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendar consulta' };

/**
 * US-032 / RN-16: página pública de agendamento (sem login). Só o nome da nutricionista e os horários livres da semana
 * (D11); `?semana` fica presa à janela do paciente (12 h a 60 dias). Conta suspensa ou página desligada não mostram horário.
 * Plano 23 (US-403, I-13): o cabeçalho com o CRN e a escolha do local (só com mais de um); `?local=` é só o valor inicial.
 * Nada de ocupação, bloqueio, sala, preço ou local arquivado.
 */
export default async function PaginaPublica({ params, searchParams }: PageProps<'/n/[slug]'>) {
  const { slug } = await params;
  const sp = await searchParams;
  const p = await carregarPaginaPublica(slug, { semana: sp.semana, local: sp.local });
  if (p.estado === 'nao_encontrada') notFound();
  if (p.estado === 'suspensa') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p role="alert">{MSG_AGENDA.contaIndisponivel}</p>
      </main>
    );
  }
  if (p.estado === 'desativada') {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-2xl font-semibold">{p.nome}</h1>
        <p role="status">{MSG_PUBLICO.indisponivel}</p>
      </main>
    );
  }
  // `?v=` = o consultório desta página (com 2+ vínculos, o cookie pode estar em outro; só vale se for vínculo ativo da conta)
  // o slug da URL é o do tenant encontrado (formato [a-z0-9-]): seguro para montar os links das semanas
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{MSG_PUBLICO.titulo(p.nome)}</h1>
      <p>{MSG_PUBLICO.cabecalho(p.cabecalho.nome, p.cabecalho.crn)}</p>
      <p>
        <Link href={telaDoPortal('/p/agenda', p.tenantId)} className="underline">
          Entrar (já sou paciente)
        </Link>
      </p>
      <AgendarForm
        slug={slug}
        siteKey={getEnv().TURNSTILE_SITE_KEY}
        locais={p.locais}
        localInicial={p.localInicial}
        semana={{
          rotulo: `${formatarData(p.semana)} a ${formatarData(somarDias(p.semana, 6))}`,
          anterior: p.semana > p.primeira ? somarDias(p.semana, -7) : null,
          proxima: p.semana < p.ultima ? somarDias(p.semana, 7) : null,
        }}
        horarios={p.horarios}
        termo={{ titulo: TERMO_PACIENTE_TITULO, paragrafos: [...TERMO_PACIENTE_PARAGRAFOS], rotulo: TERMO_PACIENTE_ROTULO, versao: TERMO_PACIENTE_VERSAO }}
      />
    </main>
  );
}
