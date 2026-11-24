import Link from 'next/link';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { Cartao } from '@/components/ui/cartao';
import type { Consulta } from '@/modules/agenda/consultas';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { MSG_INICIO, MSG_INICIO_RECEPCAO, TITULOS_DAS_NOVIDADES } from '@/modules/agenda/inicio';
import { inicioDaRecepcao } from '@/modules/agenda/inicio-recepcao';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';
import { selosDaConsulta } from './agenda/periodo';

const LINK = 'inline-flex min-h-11 items-center text-link underline';
const ITEM = 'flex min-h-11 flex-wrap items-center gap-x-3 rounded-xl px-2 hover:bg-linha';

/**
 * Plano 26 (RN-514, RE-D63, spec §7.4): o Início da recepção — o trabalho do dia: "Agenda de hoje", "Presença a registrar"
 * (para ela, só "Faltou"), "Solicitações" (pedidos de paciente cadastrado, Plano 23; os de pessoa nova ficam com a
 * nutricionista, RE-D59) e "O que os pacientes fizeram na agenda". Nada do Início da nutricionista: indicadores do mês
 * (ficam em Relatórios › Agenda), armazenamento, WhatsApp, IA, exames, dúvidas, diários e documentos. Os links levam às
 * telas da agenda, que no PR 2 ainda dão "Sem permissão" (a T10 as abre; a Equipe nasce desligada até lá, RE-D52).
 */
export async function InicioDaRecepcao({ nome, ctx, tenant }: { nome: string; ctx: TenantContext; tenant: Pick<TenantRow, 'fuso' | 'antecedenciaMinH'> }) {
  const { agendaDeHoje, presenca, solicitacoes, novidades } = await inicioDaRecepcao(ctx, tenant, new Date());
  const hora = (d: Date) => partesNoFuso(d, tenant.fuso).hora;
  const listas = (Object.keys(TITULOS_DAS_NOVIDADES) as (keyof typeof TITULOS_DAS_NOVIDADES)[]).map((k): [string, Consulta[]] => [TITULOS_DAS_NOVIDADES[k], novidades[k]]);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-3xl font-extrabold">{`Seu dia, ${primeiroNome(nome)}`}</h1>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <Cartao id="agenda-hoje" titulo={`Agenda de hoje (${agendaDeHoje.length})`} className="md:col-span-2" data-guia="agenda-hoje" acao={<Link href="/painel/agenda" aria-label={MSG_INICIO_RECEPCAO.verAgendaRotulo} className={LINK}>{MSG_INICIO_RECEPCAO.verAgenda}</Link>}>
          {agendaDeHoje.length ? (
            <ul className="space-y-1">
              {agendaDeHoje.map((c) => (
                <li key={c.id}>
                  <Link href={`/painel/agenda/consultas/${c.id}`} className={ITEM}>
                    <span className="font-semibold">{hora(c.inicio)}</span>
                    <span>{c.paciente}</span>
                    <span className="text-sm text-suave">{selosDaConsulta(c, false).join(' · ')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-suave">{MSG_INICIO.semConsultaHoje}</p>
          )}
        </Cartao>

        <Cartao id="presenca" titulo={`Presença a registrar (${presenca.total})`} data-guia="presenca">
          {presenca.consultas.length ? (
            <ul className="space-y-1">
              {presenca.consultas.map((c) => (
                <li key={c.id}>
                  <Link href={`/painel/agenda/consultas/${c.id}`} className={ITEM}>
                    <span className="font-semibold">{formatarQuando(c.inicio, tenant.fuso)}</span>
                    <span>{c.paciente}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-suave">{MSG_INICIO_RECEPCAO.semPresenca}</p>
          )}
          {presenca.total > presenca.consultas.length && <p><Link href="/painel/agenda/pendencias" className={LINK}>{MSG_INICIO_RECEPCAO.verPendencias}</Link></p>}
          <p className="mt-2 text-sm text-suave">{MSG_RECEPCAO.presenca}</p>
        </Cartao>

        <Cartao id="solicitacoes" titulo={`Solicitações (${solicitacoes})`} acao={solicitacoes > 0 ? <Link href="/painel/agenda/solicitacoes" aria-label={MSG_INICIO_RECEPCAO.responderRotulo} className={LINK}>{MSG_INICIO_RECEPCAO.responder}</Link> : undefined}>
          <p className="text-sm text-suave">{MSG_RECEPCAO.pedidosPessoaNova}</p>
        </Cartao>

        <Cartao id="novidades" titulo="O que os pacientes fizeram na agenda" className="md:col-span-2">
          {listas.some(([, l]) => l.length) ? (
            listas.map(([titulo, lista]) =>
              lista.length ? (
                <div key={titulo} className="mt-2 first:mt-0">
                  <h3 className="font-medium">{titulo}</h3>
                  <ul className="space-y-1">
                    {lista.map((c) => (
                      <li key={c.id}>
                        <Link href={`/painel/agenda/consultas/${c.id}`} className={ITEM}>{`${c.paciente} — ${formatarQuando(c.inicio, tenant.fuso)}`}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )
          ) : (
            <p className="text-suave">{MSG_INICIO_RECEPCAO.semNovidades}</p>
          )}
        </Cartao>
      </div>
    </main>
  );
}
