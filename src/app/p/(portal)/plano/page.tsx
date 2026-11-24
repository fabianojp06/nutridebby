import { headers } from 'next/headers';
import Link from 'next/link';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { daquiA } from '@/modules/portal/datas-portal';
import { rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { configIA } from '@/modules/ia/modo';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { entradaDoPaciente } from '@/modules/ia/nutri-paciente/estado';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { MSG_PLANO_PACIENTE, planoDoPaciente, versaoDaCopiaOffline } from '@/modules/portal/plano';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { CABECALHO_PEDIDO_DA_COPIA, MARCA_DA_COPIA } from '@/app/sw-regras';
import { GuardarPlano } from '../../plano-guardado';
import { molduraDaSecao } from '../../moldura';
import { AbrirRefeicaoDaUrl } from './abrir-refeicao-da-url';
import { AvisoIaNutri } from './aviso-ia-nutri';
import { RefeicaoDetalhe } from './refeicao-detalhe';

export const dynamic = 'force-dynamic';

const PILULA = 'inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4';

/**
 * Plano 16 (US-196, F-Plano): as refeições em sanfona, a próxima aberta e destacada, tudo dentro da página. Sem
 * `respostasDeHoje` aqui: /p/plano é a cópia offline guardada no aparelho e "offline só o plano (sem diário…)" (§4.8, §10,
 * §11.7) — a marca "No diário" fica no mural e na refeição aberta (que não são guardadas); na sanfona o "Comi assim"
 * aparece sempre e, se a refeição já tiver resposta hoje, o toque devolve o registro existente (idempotente).
 * Plano 15 (US-170, §4.2, §7.8): "Tirar dúvida sobre o plano" e "Perguntar sobre esta refeição" com a entrada da IA Nutri em
 * conversa, decidir, texto_mudou ou indisponível. /p/plano é a cópia offline (D6 do Plano 06): o link pode ficar na cópia
 * depois de um bloqueio até ela se renovar — o toque mostra "A IA Nutri não está disponível no momento." (US-170, "link
 * antigo"). `?ia-nutri=indisponivel` (só esse valor) = o aceite recusado pelo bloqueio, o consultório desligado ou a pausa.
 */
export default async function MeuPlano({ searchParams }: PageProps<'/p/plano'>) {
  const acesso = await requirePaciente('/p/plano');
  const { ctx, tenant, vinculo } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const [plano, entrada] = await Promise.all([planoDoPaciente(ctx, tenant.fuso), entradaDoPaciente(ctx, tenant, configIA(getEnv()))]);
  const comIaNutri = entrada === 'conversa' || entrada === 'decidir' || entrada === 'texto_mudou' || entrada === 'indisponivel';
  const { pdf, 'ia-nutri': iaNutri } = await searchParams;
  // SUS-112: a busca do service worker que grava a cópia offline (guardarPlano) leva o cabeçalho; só esse HTML ganha a marca,
  // e só ele recarrega quando a rede volta (sw-provider.tsx). A navegação do paciente nunca o leva.
  const copia = (await headers()).get(CABECALHO_PEDIDO_DA_COPIA) === '1';
  const agora = new Date();
  const minutosAgora = partesNoFuso(agora, tenant.fuso).minutos;
  const minutosAte = (horario: string) => {
    const [h, m] = horario.split(':').map(Number);
    const ate = h * 60 + m - minutosAgora;
    return ate >= 0 ? ate : ate + 24 * 60; // a "próxima" depois da última do dia é a primeira de amanhã
  };
  return (
    <>
      <Faixa {...moldura} atual="/p/plano" titulo={MSG_G.titulos.plano} />
      <main className="space-y-6 p-4">
        {/* D6: plano novo = id novo (e US-054: sugestões de receita mudaram = versão nova); o service worker só busca de
            novo se a versão ou o dono mudarem, ou 1 vez por dia */}
        <GuardarPlano dono={vinculo.patientId} versao={versaoDaCopiaOffline(plano)} />
        {copia && <span hidden {...{ [MARCA_DA_COPIA]: '' }} />}
        <AbrirRefeicaoDaUrl />
        {iaNutri === 'indisponivel' && <AvisoIaNutri texto={MSG_IA_NUTRI.naoDisponivel} />}
        {!plano ? (
          <p role="status">{MSG_PLANO_PACIENTE.semPlano}</p>
        ) : (
          <>
            <h2 className="font-portal-titulo text-xl font-bold">{plano.titulo}</h2>
            {/* RN-117 / art. 37 (A-D13): o selo nasce com o plano publicado (id novo), então a cópia offline (D6) já muda de versão */}
            {plano.seloIa && <p className="text-sm text-suave">{MSG_PLANO.seloIa}</p>}
            {plano.totalKcal && <p>{`Total do dia: ${plano.totalKcal}`}</p>}
            {pdf === 'preparando' && <p role="status">{MSG_PLANO_PACIENTE.pdfPreparando}</p>}
            <p className="flex flex-wrap gap-2">
              {plano.pdf !== 'indisponivel' && (
                <a href="/api/p/plano/pdf" className={PILULA}>Baixar PDF</a>
              )}
              {/* D3 (Plano 07): a lista de compras é derivada do plano publicado; G-D8 ★ = a: os conteúdos também moram aqui */}
              <Link href="/p/compras" className={PILULA}>Lista de compras</Link>
              <Link href="/p/conteudos" className={PILULA}>Conteúdos</Link>
              {/* Plano 15 (§4.2): a conversa mora em Plano */}
              {comIaNutri && <Link href="/p/plano/ia" className={PILULA}>{MSG_IA_NUTRI.linkPlano}</Link>}
            </p>
            <ol className="space-y-3">
              {plano.refeicoes.map((r) => {
                const proxima = r.id === plano.proximaRefeicaoId;
                return (
                  <li key={r.id}>
                    <details id={`ref-${r.id}`} open={proxima} className={proxima ? 'rounded-2xl border-2 border-p-marco bg-cartao ring-2 ring-p-marco-texto' : 'rounded-2xl border border-borda bg-cartao'}>
                      {/* sem flex/grid no summary: ele perde o display: list-item e o marcador ▶/▼ que diz que a refeição abre (molde ajuda-seguranca.tsx); h3 direto no summary (o modelo de conteúdo admite um título) */}
                      <summary className="min-h-11 cursor-pointer p-3">
                        <h3 className="inline font-portal-titulo text-lg font-bold">{rotuloDaRefeicao(r.nome, r.horario)}</h3>
                        {proxima && r.horario && <span className="ml-3 inline-block rounded-full bg-p-marco px-2 text-sm font-semibold text-p-marco-texto">{`Próxima, ${daquiA(minutosAte(r.horario))}`}</span>}
                      </summary>
                      <div className="px-3 pb-3">
                        <RefeicaoDetalhe refeicao={r} respondida={false} perguntarSobre={comIaNutri} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            {plano.orientacoes && (
              <section aria-labelledby="orientacoes-plano" className="rounded-2xl bg-p-clara p-3">
                <h2 id="orientacoes-plano" className="font-semibold">Orientações do plano</h2>
                <p className="whitespace-pre-line wrap-break-word">{plano.orientacoes}</p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
