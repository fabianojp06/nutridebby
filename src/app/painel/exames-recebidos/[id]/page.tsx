import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnv } from '@/env';
import { signFileUrl } from '@/lib/signed-url';
import { requireNutri } from '@/lib/tenant-session';
import { motivoDoPaciente, situacaoIaDoPaciente } from '@/modules/ia/autorizacao';
import { configIA, estadoIaComPaciente } from '@/modules/ia/modo';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { abrirEnvio } from '@/modules/pacientes/exames-enviados';
import { MSG_REVISAO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { AceitarForm } from './aceitar-form';
import { RecusarForm } from './recusar-form';

export const dynamic = 'force-dynamic';

/**
 * US-162/US-163/US-164: as páginas do envio como IMAGENS ao lado das ações (D23 = a: URL assinada de 5 min; a rota serve
 * imagem inline), a observação, o PDF limpo para baixar, Aceitar e Recusar — só no envio "recebido" (fora dele, abrirEnvio não
 * devolve o conteúdo e a tela mostra só a situação). Abrir o "recebido" é auditado (abrirEnvio). "Aceitar e ler"
 * só com a IA ativa no consultório e o paciente apto (US-163 "IA indisponível").
 */
export default async function EnvioRecebido({ params }: PageProps<'/painel/exames-recebidos/[id]'>) {
  const { ctx, tenant } = await requireNutri('/painel/exames-recebidos');
  const { id } = await params;
  const envio = await abrirEnvio(ctx, id);
  if (!envio) notFound();
  // Plano 14A (D8): "Aceitar e ler" só com a IA utilizável com dado de paciente e a autorização vigente para a leitura
  const ia = configIA(getEnv());
  const comIa =
    estadoIaComPaciente(tenant, ia) === 'ativa' &&
    motivoDoPaciente(envio.paciente, await situacaoIaDoPaciente(ctx, envio.paciente.id, ia.destino), 'leitura_laudos') === null;
  const enviado = formatarDataNoFuso(envio.enviadoEm, tenant.fuso);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <p>
        <Link href="/painel/exames-recebidos" className="inline-flex min-h-11 items-center text-link underline">Voltar para Exames recebidos</Link>
      </p>
      <h1 className="font-titulo text-2xl font-semibold">{nomeDoEnvio(envio.nome, enviado)}</h1>
      <p className="text-suave">{`${envio.paciente.nome} · enviado em ${enviado} · coleta em ${formatarData(envio.dataColeta)}`}</p>
      {envio.status === 'recebido' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-label="Páginas do exame" className="space-y-3">
            {envio.paginas.map((c, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (signFileUrl), não passa pelo otimizador
              <img key={c} src={signFileUrl(c)} alt={`Página ${i + 1} de ${envio.paginas.length} do exame enviado`} className="w-full rounded border border-borda" />
            ))}
          </section>
          <section aria-labelledby="revisao" className="space-y-4">
            <h2 id="revisao" className="text-lg font-semibold">Revisão</h2>
            {envio.observacao && (
              <p className="whitespace-pre-line">
                <strong>Observação do paciente: </strong>
                {envio.observacao}
              </p>
            )}
            {envio.pdf && (
              <p>
                <a href={signFileUrl(envio.pdf)} className="inline-flex min-h-11 items-center text-link underline">Baixar PDF</a>
              </p>
            )}
            <AceitarForm id={envio.id} tituloInicial={envio.nome ?? 'Exame'} dataInicial={envio.dataColeta} hoje={hojeNoFuso(tenant.fuso)} comIa={comIa} />
            <RecusarForm id={envio.id} />
          </section>
        </div>
      ) : (
        // code review do PR #25 (P12-22 b): fora de "recebido", só a situação — nem páginas, nem PDF, nem observação
        <p role="status">{envio.status === 'cancelado' ? MSG_REVISAO.cancelado : MSG_REVISAO.jaRevisado}</p>
      )}
    </main>
  );
}
