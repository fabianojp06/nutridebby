import Link from 'next/link';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { configIA } from '@/modules/ia/modo';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { entradaDoPaciente } from '@/modules/ia/nutri-paciente/estado';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { MSG_PLANO_PACIENTE, planoDoPaciente, versaoDaCopiaOffline, type PlanoDoPaciente } from '@/modules/portal/plano';
import { agoraNoFuso, MSG_PLANO_DIAS } from '@/modules/portal/plano-regras';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { GuardarPlano } from '../../plano-guardado';
import { molduraDaSecao } from '../../moldura';
import { AbrirRefeicaoDaUrl } from './abrir-refeicao-da-url';
import { AvisoIaNutri } from './aviso-ia-nutri';
import { DiaDeHoje } from './dia-de-hoje';

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
 * Plano 19 (RN-247 c, RN-252, RN-253): os dias ("Hoje ({dia})" e "Ver outros dias", decididos no aparelho por `DiaDeHoje`)
 * e "Ligado ao seu plano" — a lista de substituição inline (legível na cópia offline) e as receitas e materiais, que abrem
 * pelo plano (`?de=plano`) e precisam de internet (só /p/plano é guardada).
 */
export default async function MeuPlano({ searchParams }: PageProps<'/p/plano'>) {
  const acesso = await requirePaciente('/p/plano');
  const { ctx, tenant, vinculo } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const agora = new Date();
  const [plano, entrada] = await Promise.all([planoDoPaciente(ctx, tenant.fuso, { agora }), entradaDoPaciente(ctx, tenant, configIA(getEnv()))]);
  const comIaNutri = entrada === 'conversa' || entrada === 'decidir' || entrada === 'texto_mudou' || entrada === 'indisponivel';
  const { pdf, 'ia-nutri': iaNutri } = await searchParams;
  return (
    <>
      <Faixa {...moldura} atual="/p/plano" titulo={MSG_G.titulos.plano} />
      <main className="space-y-6 p-4">
        {/* D6: plano novo = id novo (e US-054/RN-253: sugestões de receita ou conteúdos ligados mudaram = versão nova); o
            service worker só busca de novo se a versão ou o dono mudarem, ou 1 vez por dia */}
        <GuardarPlano dono={vinculo.patientId} versao={versaoDaCopiaOffline(plano)} />
        <AbrirRefeicaoDaUrl />
        {iaNutri === 'indisponivel' && <AvisoIaNutri texto={MSG_IA_NUTRI.naoDisponivel} />}
        {!plano ? (
          <p role="status">{MSG_PLANO_PACIENTE.semPlano}</p>
        ) : (
          <>
            <h2 className="font-portal-titulo text-xl font-bold">{plano.titulo}</h2>
            {/* RN-117 / art. 37 (A-D13): o selo nasce com o plano publicado (id novo), então a cópia offline (D6) já muda de versão */}
            {plano.seloIa && <p className="text-sm text-suave">{MSG_PLANO.seloIa}</p>}
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
            <DiaDeHoje refeicoes={plano.refeicoes} perfis={plano.perfis} fuso={tenant.fuso} agoraDoServidor={agoraNoFuso(agora, tenant.fuso)} perguntarSobre={comIaNutri} />
            {plano.orientacoes && (
              <section aria-labelledby="orientacoes-plano" className="rounded-2xl bg-p-clara p-3">
                <h2 id="orientacoes-plano" className="font-semibold">Orientações do plano</h2>
                <p className="whitespace-pre-line wrap-break-word">{plano.orientacoes}</p>
              </section>
            )}
            <LigadoAoPlano plano={plano} />
          </>
        )}
      </main>
    </>
  );
}

/**
 * RN-252/RN-253 (US-239): "Ligado ao seu plano" — as listas de substituição (cópia do plano publicado, energia só com
 * "mostrar calorias") e as receitas e materiais publicados ligados. Os textos da nutricionista (orientação da lista) com a
 * voz dela (RN-254) e a quebra de linha da página (um link longo não faz a página rolar na horizontal).
 */
function LigadoAoPlano({ plano }: { plano: PlanoDoPaciente }) {
  if (!plano.listas.length && !plano.conteudos.length) return null;
  return (
    <section aria-labelledby="ligado-ao-plano" className="space-y-4">
      <h2 id="ligado-ao-plano" className="font-portal-titulo text-xl font-bold">{MSG_PLANO_DIAS.ligado}</h2>
      {plano.listas.length > 0 && (
        <section aria-labelledby="ligado-listas" className="space-y-3">
          <h3 id="ligado-listas" className="font-semibold">{MSG_PLANO_DIAS.lista}</h3>
          {plano.listas.map((l, li) => (
            <details key={li} className="rounded-2xl border border-borda bg-cartao">
              <summary className="min-h-11 cursor-pointer p-3">
                <h4 className="inline font-semibold wrap-break-word">{l.nome}</h4>
              </summary>
              <div className="space-y-3 px-3 pb-3">
                {l.orientacao && (
                  <div className="rounded-2xl bg-p-clara p-3">
                    <p className="text-sm font-semibold">{MSG_PLANO_DIAS.suaNutricionista}</p>
                    <p className="whitespace-pre-line wrap-break-word">{l.orientacao}</p>
                  </div>
                )}
                {l.grupos.map((g, gi) => (
                  <div key={gi} className="space-y-1">
                    <h5 className="font-semibold wrap-break-word">{g.nome}</h5>
                    <ul className="divide-y divide-borda">
                      {g.itens.map((i, ii) => (
                        <li key={ii} className="flex justify-between gap-3 py-2">
                          <span className="wrap-break-word">{i.nome}</span>
                          <span className="text-right font-semibold">{`${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}
      {plano.conteudos.length > 0 && (
        <section aria-labelledby="ligado-conteudos" className="space-y-2">
          <h3 id="ligado-conteudos" className="font-semibold">{MSG_PLANO_DIAS.conteudos}</h3>
          <p className="text-sm text-suave">{MSG_PLANO_DIAS.precisaInternet}</p>
          <ul className="space-y-1">
            {plano.conteudos.map((c) => (
              <li key={c.id}>
                {/* ?de=plano: o conteúdo fora da audiência só abre por aqui (RN-12, exceção ampliada — RN-253) */}
                <Link href={`/p/conteudos/${c.id}?de=plano`} className="inline-flex min-h-11 items-center gap-2 text-link underline">
                  <span className="wrap-break-word">{c.titulo}</span>
                  <span className="text-sm text-suave">{`(${ROTULO_TIPO_CONTEUDO[c.tipo]})`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
