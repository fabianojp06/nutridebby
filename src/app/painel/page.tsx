import Link from 'next/link';
import { formatarBytes } from '@/lib/format';
import { requireNutri } from '@/lib/tenant-session';
import type { Consulta } from '@/modules/agenda/consultas';
import { formatarQuando } from '@/modules/agenda/fuso';
import { contarPendenciasDePresenca, indicadoresDaAgenda, MSG_PRESENCA, novidadesDaAgenda, textoTaxa } from '@/modules/agenda/presenca';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { MSG_COTA, situacaoDaCota } from '@/modules/notificacoes/whatsapp/cota';
import { COTA_BYTES, MSG_COTA_ESGOTADA, nivelDeUso } from '@/modules/plataforma/armazenamento';
import { Cabecalho } from './cabecalho';

export const dynamic = 'force-dynamic';

export default async function PainelHome() {
  const { data, tenant, ctx } = await requireNutri('/painel');
  const whatsapp = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  const cota = whatsapp.ligado ? await situacaoDaCota(ctx, tenant) : null; // RN-09: só com o WhatsApp ligado
  // US-037 / CS-03 / D18: quadro "Agenda" (cada leitura é uma transação; nenhuma dentro de outra)
  const agora = new Date();
  const [ind, pendentes, nov] = await Promise.all([indicadoresDaAgenda(ctx, tenant.fuso, agora), contarPendenciasDePresenca(ctx, agora), novidadesDaAgenda(ctx, agora)]);
  const novidades: [string, Consulta[]][] = [
    ['Pedidos de remarcação', nov.pedidosRemarcacao],
    ['Marcadas pelo paciente (últimos 7 dias)', nov.marcadasPeloPaciente],
    ['Canceladas pelo paciente (últimos 7 dias)', nov.canceladasPeloPaciente],
  ];
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Painel da nutricionista</h1>
        {(() => {
          const uso = nivelDeUso(tenant.armazenamentoBytes);
          if (uso.nivel === 'esgotado') return <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA_ESGOTADA}</p>;
          if (uso.nivel === 'aviso') {
            return (
              <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
                {`Você já usou ${uso.percentual}% do espaço de armazenamento (${formatarBytes(tenant.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)}).`}
              </p>
            );
          }
          return null;
        })()}
        {whatsapp.ligado && whatsapp.conectadaAntes && whatsapp.estado === 'desconectada' && (
          <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">
            WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. <Link href="/painel/whatsapp" className="underline">Conectar de novo</Link>
          </p>
        )}
        {cota?.nivel === 'aviso' && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">{MSG_COTA.aviso}</p>}
        {cota?.nivel === 'esgotada' && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA.esgotada}</p>}
        <section aria-labelledby="agenda-resumo" className="my-4 space-y-2">
          <h2 id="agenda-resumo" className="text-lg font-semibold">Agenda</h2>
          <p>{`Consultas do mês: ${ind.consultasMes}`}</p>
          <p>{`Taxa de faltas do mês: ${textoTaxa(ind.taxaMes, ind.faltasMes, ind.iniciadasMes)}`}</p>
          <p>{`Mês anterior: ${textoTaxa(ind.taxaMesAnterior)}`}</p>
          {pendentes > 0 && <p><Link href="/painel/agenda/pendencias" className="underline">{MSG_PRESENCA.pendencias(pendentes)}</Link></p>}
          {novidades.map(([titulo, lista]) =>
            lista.length ? (
              <div key={titulo}>
                <h3 className="font-medium">{titulo}</h3>
                <ul className="list-disc pl-5 text-sm">
                  {lista.map((c) => <li key={c.id}><Link href={`/painel/agenda/consultas/${c.id}`} className="underline">{`${c.paciente} — ${formatarQuando(c.inicio, tenant.fuso)}`}</Link></li>)}
                </ul>
              </div>
            ) : null,
          )}
        </section>
        <p>Conectado como {data.user.email}.</p>
      </main>
    </>
  );
}
