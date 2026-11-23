import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { formatarBytes } from '@/lib/format';
import { formatarDecimal } from '@/lib/numero';
import { CINZA_SOBRE_DESTAQUE } from '@/lib/tema/marca-tema';
import { requireNutri } from '@/lib/tenant-session';
import type { Consulta } from '@/modules/agenda/consultas';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { lerInicio, MSG_INICIO, textoSemProxima } from '@/modules/agenda/inicio';
import { MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import { MSG_PRESENCA, textoTaxa } from '@/modules/agenda/presenca';
import { provedorDoApp } from '@/modules/notificacoes/whatsapp/conexao';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { MSG_COTA } from '@/modules/notificacoes/whatsapp/cota';
import { formatarData } from '@/modules/pacientes/datas';
import { COTA_BYTES, MSG_COTA_ESGOTADA, nivelDeUso } from '@/modules/plataforma/armazenamento';
import { DIAS_CS01 } from '@/modules/plataforma/metricas-sucesso';

export const dynamic = 'force-dynamic';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
// links do cartão de destaque: branco sobre a cor do consultório (o foco é branco ali, data-sobre-marca do Cartao)
const LINK_CLARO = 'inline-flex min-h-11 items-center rounded-full bg-white px-5 font-semibold text-[#14211d]';
const LINK_PILULA = 'inline-flex min-h-11 items-center rounded-full border border-current px-4';

export default async function PainelHome() {
  const { data, tenant, ctx } = await requireNutri('/painel');
  const agora = new Date();
  // tudo numa transação só: com leituras em paralelo, o Início de duas nutricionistas ocupava o pool (achado 3)
  const { whatsapp, cota, indicadores: ind, pendentes, novidades: nov, pedidos, dia, naoVistos, metricas: cs, documentosAguardando, solicitacoes } = await lerInicio(ctx, tenant, agora, { whatsappLigado: provedorDoApp() !== null });
  const hora = (d: Date) => partesNoFuso(d, tenant.fuso).hora;
  const novidades: [string, Consulta[]][] = [
    ['Pedidos de remarcação', nov.pedidosRemarcacao],
    ['Marcadas pelo paciente (últimos 7 dias)', nov.marcadasPeloPaciente],
    ['Canceladas pelo paciente (últimos 7 dias)', nov.canceladasPeloPaciente],
  ];
  const uso = nivelDeUso(tenant.armazenamentoBytes);
  const p = dia.proxima;
  const maxBarra = Math.max(1, ...cs.cs02.porDia.map((d) => d.n));
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-3xl font-extrabold">{`Seu dia, ${primeiroNome(data.user.name)}`}</h1>
        <div className="flex flex-wrap gap-2" data-guia="atalhos-topo">
          <BotaoLink href="/painel/pacientes/novo" variante="secundario">Novo paciente</BotaoLink>
          <BotaoLink href="/painel/agenda/nova">Agendar</BotaoLink>
        </div>
      </div>

      {uso.nivel === 'esgotado' && <Aviso tipo="erro">{MSG_COTA_ESGOTADA}</Aviso>}
      {uso.nivel === 'aviso' && (
        <Aviso tipo="aviso">{`Você já usou ${uso.percentual}% do espaço de armazenamento (${formatarBytes(tenant.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)}).`}</Aviso>
      )}
      {whatsapp.ligado && whatsapp.conectadaAntes && whatsapp.estado === 'desconectada' && (
        <Aviso tipo="aviso" papel="alert">
          WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. <Link href="/painel/whatsapp" className="underline">Conectar de novo</Link>
        </Aviso>
      )}
      {cota?.nivel === 'aviso' && <Aviso tipo="aviso">{MSG_COTA.aviso}</Aviso>}
      {cota?.nivel === 'esgotada' && <Aviso tipo="erro">{MSG_COTA.esgotada}</Aviso>}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <Cartao id="proxima" titulo="Próxima consulta" destaque className="md:col-span-2 md:row-span-2" data-guia="proxima-consulta">
          {p ? (
            <div className="space-y-4">
              <p className="font-titulo text-5xl font-extrabold">{hora(p.consulta.inicio)}</p>
              <p className="text-xl font-semibold">{p.consulta.paciente}</p>
              <p>
                {[p.consulta.modalidade === 'online' ? 'Online' : 'Presencial', `${p.numero}ª consulta`, p.consulta.confirmadaVia === 'link' ? 'Confirmada pelo link' : p.consulta.confirmadaVia === 'whatsapp' ? 'Confirmada pelo WhatsApp' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                <li className="rounded-2xl p-3" style={{ background: CINZA_SOBRE_DESTAQUE }}>{p.diario7d === 1 ? 'Diário: 1 registro em 7 dias' : `Diário: ${p.diario7d} registros em 7 dias`}</li>
                <li className="rounded-2xl p-3" style={{ background: CINZA_SOBRE_DESTAQUE }}>{`Portal: ${p.portal7d} de 7 dias`}</li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <Link href={`/painel/pacientes/${p.consulta.patientId}`} className={LINK_CLARO}>Abrir prontuário</Link>
                {p.consulta.modalidade === 'online' && p.consulta.linkOnline && (
                  <a href={p.consulta.linkOnline} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-white px-5 font-semibold text-white">Entrar na chamada</a>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p>{textoSemProxima(dia.hoje)}</p>
              <Link href="/painel/agenda/nova" className={LINK_CLARO}>Agendar</Link>
            </div>
          )}
        </Cartao>

        <Cartao id="hoje" titulo="Hoje">
          <p className="font-titulo text-4xl font-extrabold">{plural(dia.hoje.total, 'consulta', 'consultas')}</p>
          <p className="text-suave">{`${plural(dia.hoje.confirmadas, 'confirmada', 'confirmadas')} · ${plural(dia.hoje.pedidosRemarcacao, 'pedido de remarcação', 'pedidos de remarcação')}`}</p>
        </Cartao>

        {/* cores fixas do design (9,15:1 nos dois modos); o foco segue o texto do cartão (na cor da marca, some sobre o âmbar) */}
        <Cartao id="diarios" titulo="Diários para ver" className="border-transparent! bg-[#f3b660]! text-[#2c1c05]! [--nd-foco:#2c1c05]">
          <p className="font-titulo text-4xl font-extrabold">{plural(naoVistos, 'registro novo', 'registros novos')}</p>
          <Link href="/painel/diarios" className="underline">Abrir Diários</Link>
        </Cartao>

        <Cartao id="agenda-dia" titulo="Agenda do dia">
          {dia.agenda.length ? (
            <ul className="space-y-1">
              {dia.agenda.map((c) => (
                <li key={c.id}>
                  <Link href={`/painel/agenda/consultas/${c.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-linha">
                    <span className="font-semibold">{hora(c.inicio)}</span>
                    <span>{c.paciente}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-suave">{MSG_INICIO.semConsultaHoje}</p>
          )}
        </Cartao>

        <Cartao id="app-semana" titulo="Pacientes no app esta semana">
          <p>{`${cs.cs02.abriram} de ${cs.cs02.comConta} pacientes abriram o app nos últimos 7 dias`}</p>
          <div aria-hidden="true" className="mt-3 flex h-20 items-end gap-1">
            {cs.cs02.porDia.map((d) => (
              <span key={d.dia} className="flex-1 rounded-t bg-marca" style={{ height: `${Math.max(4, (d.n / maxBarra) * 100)}%` }} />
            ))}
          </div>
        </Cartao>

        <Cartao id="agenda-resumo" titulo="Agenda">
          <p>{`Consultas do mês: ${ind.consultasMes}`}</p>
          <p>{`Taxa de faltas do mês: ${textoTaxa(ind.taxaMes, ind.faltasMes, ind.iniciadasMes)}`}</p>
          <p>{`Mês anterior: ${textoTaxa(ind.taxaMesAnterior)}`}</p>
          {pendentes > 0 && <p><Link href="/painel/agenda/pendencias" className="underline">{MSG_PRESENCA.pendencias(pendentes)}</Link></p>}
          {novidades.map(([titulo, lista]) =>
            lista.length ? (
              <div key={titulo} className="mt-2">
                <h3 className="font-medium">{titulo}</h3>
                <ul className="list-disc pl-5 text-sm">
                  {lista.map((c) => <li key={c.id}><Link href={`/painel/agenda/consultas/${c.id}`} className="underline">{`${c.paciente} — ${formatarQuando(c.inicio, tenant.fuso)}`}</Link></li>)}
                </ul>
              </div>
            ) : null,
          )}
        </Cartao>

        <Cartao id="criterios" titulo="Critérios de sucesso">
          <ul className="space-y-1">
            <li>{`Atendimentos registrados: ${cs.cs01.comAtendimento} de ${cs.cs01.realizadas} consultas realizadas (${pct(cs.cs01.comAtendimento, cs.cs01.realizadas)})`}</li>
            {cs.cs01.desde && <li>{`Dias desde o início: ${Math.min(cs.cs01.dias, DIAS_CS01)} de ${DIAS_CS01}`}</li>}
            {cs.cs03.base !== null && <li>{`Taxa de faltas antes do sistema: ${formatarDecimal(cs.cs03.base, 1)}%`}</li>}
          </ul>
        </Cartao>

        {/* Plano 23 (US-409, §4.1): só quando há pedido no prazo de resposta */}
        {solicitacoes > 0 && (
          <Cartao id="solicitacoes" titulo={MSG_SOLICITACOES.aba(solicitacoes)} className="border-aviso!">
            <p><Link href="/painel/agenda/solicitacoes" className="inline-flex min-h-11 items-center underline">Responder em Solicitações</Link></p>
          </Cartao>
        )}

        {pedidos.length > 0 && (
          <Cartao id="pedidos-titular" titulo="Pedidos do titular" className="border-aviso!">
            <ul className="list-disc pl-5 text-sm">
              {pedidos.map((x) => (
                <li key={`${x.patientId}-${x.tipo}`}>
                  <Link href={`/painel/pacientes/${x.patientId}/privacidade`} className="underline">
                    {x.tipo === 'exclusao' ? `Pedido de exclusão de ${x.nome}` : `Pedido de dados de ${x.nome}`}
                  </Link>
                  {` · prazo ${formatarData(x.prazo)}`}
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        {/* P-B8 (Plano 10A): só com os documentos liberados (D20) e algo a assinar */}
        {!!documentosAguardando && (
          <Cartao id="documentos-aguardando" titulo="Documentos aguardando assinatura" data-guia="documentos-aguardando">
            <p>{documentosAguardando === 1 ? '1 documento aguardando assinatura' : `${documentosAguardando} documentos aguardando assinatura`}</p>
            <p className="text-sm text-suave">{'Abra o prontuário do paciente, aba "Documentos", para assinar e enviar.'}</p>
          </Cartao>
        )}

        {/* bg-botao: escuro no claro e claro no escuro; o foco segue o texto do cartão (a cor da marca some sobre ele) */}
        <Cartao id="atalhos" titulo="Atalhos" className="border-transparent! bg-botao! text-botao-texto! [--nd-foco:var(--nd-botao-texto)]">
          <ul className="flex flex-wrap gap-2" data-guia="atalhos">
            <li><Link href="/painel/pacientes/novo" className={LINK_PILULA}>Novo paciente</Link></li>
            <li><Link href="/painel/agenda/nova" className={LINK_PILULA}>Agendar</Link></li>
            <li><Link href="/painel/conteudos/novo?tipo=video" className={LINK_PILULA}>Novo conteúdo</Link></li>
          </ul>
        </Cartao>
      </div>
    </main>
  );
}
