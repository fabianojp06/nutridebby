import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getEnv } from '@/env';
import { carregarPaginaPublica } from '@/modules/agenda/agendamento-publico';
import { MSG_AGENDA, MSG_PUBLICO } from '@/modules/agenda/constantes';
import { somarDias } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_ROTULO, TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { AgendarForm } from './agendar-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendar consulta' };

/**
 * US-032 / RN-16: página pública de agendamento (sem login). Só o nome da nutricionista e os horários livres da semana
 * (D11); `?semana` fica presa à janela do paciente (12 h a 60 dias). Conta suspensa ou página desligada não mostram horário.
 */
export default async function PaginaPublica({ params, searchParams }: PageProps<'/n/[slug]'>) {
  const { slug } = await params;
  const sp = await searchParams;
  const p = await carregarPaginaPublica(slug, { semana: sp.semana });
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
  // o slug da URL é o do tenant encontrado (formato [a-z0-9-]): seguro para montar os links das semanas
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{MSG_PUBLICO.titulo(p.nome)}</h1>
      <AgendarForm
        slug={slug}
        siteKey={getEnv().TURNSTILE_SITE_KEY}
        modalidadeInicial={sp.modalidade === 'online' && p.temOnline ? 'online' : 'presencial'}
        temOnline={p.temOnline}
        semana={{
          rotulo: `${formatarData(p.semana)} a ${formatarData(somarDias(p.semana, 6))}`,
          anterior: p.semana > p.primeira ? somarDias(p.semana, -7) : null,
          proxima: p.semana < p.ultima ? somarDias(p.semana, 7) : null,
        }}
        horarios={p.horarios}
        termo={{ titulo: TERMO_PACIENTE_TITULO, paragrafos: [...TERMO_PACIENTE_PARAGRAFOS], rotulo: TERMO_PACIENTE_ROTULO }}
      />
    </main>
  );
}
