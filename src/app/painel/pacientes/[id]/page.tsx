import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { logger, nomeDoErro } from '@/lib/logger';
import { montarAdicionar } from '@/modules/ficha/adicionar';
import { cadastroIncompleto } from '@/modules/ficha/incompleto';
import { secoesDoInicio, type SecaoNoInicio } from '@/modules/ficha/inicio';
import { noAppDoPaciente, type NoApp } from '@/modules/ficha/no-app';
import { cartaoResumo, linhasDoResumo } from '@/modules/ficha/resumo';
import { MSG_FICHA } from '@/modules/ficha/textos';
import { MSG_RESUMO } from '@/modules/ia/constantes';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { iaDoAssistente } from './ia-assistente';
import { acoesDoAdicionar } from './inicio/acoes';
import { Adicionar } from './inicio/adicionar';
import { CartaoNoApp } from './inicio/cartao-no-app';
import { Secao } from './inicio/secao';
import { carregarProntuario } from './prontuario';

export const dynamic = 'force-dynamic';

/**
 * RN-279: as seções com o selo "No app" nos itens que o paciente vê — os ids que `noAppDoPaciente` achou no contexto do
 * paciente (nunca reproduzido aqui, na sessão `nutri`).
 */
async function secoesComSelo(ctx: Parameters<typeof noAppDoPaciente>[0], secoes: SecaoNoInicio[], patientId: string): Promise<{ secoes: SecaoNoInicio[]; noApp: NoApp | null }> {
  const itens = Object.fromEntries(secoes.map((s) => [s.id, s.resumo.ultimos.map((i) => i.id)]));
  let noApp: NoApp;
  try {
    noApp = await noAppDoPaciente(ctx, patientId, itens);
  } catch (err) {
    // o Início não cai pelo No app: sem o cartão e sem o selo; no log, só o tipo do erro (nunca a mensagem nem dado de saúde)
    logger.warn({ erro: nomeDoErro(err) }, 'No app do paciente indisponível no Início');
    return { secoes, noApp: null };
  }
  const comSelo = secoes.map((s) => {
    const visiveis = new Set(noApp.visiveis[s.id] ?? []);
    return { ...s, resumo: { ...s.resumo, ultimos: s.resumo.ultimos.map((i) => ({ ...i, noApp: visiveis.has(i.id) })) } };
  });
  return { secoes: comSelo, noApp };
}

/** RN-269: a nota "Cadastro incompleto" é acessória — se a leitura falhar, o Início não cai: fica sem a nota. */
async function notaDoCadastro(ctx: Parameters<typeof cadastroIncompleto>[0], patientId: string): Promise<string | null> {
  try {
    return await cadastroIncompleto(ctx, patientId);
  } catch (err) {
    // no log, só o tipo do erro (nunca a mensagem nem dado do cadastro), como o No app acima
    logger.warn({ erro: nomeDoErro(err) }, 'Nota do cadastro incompleto indisponível no Início');
    return null;
  }
}

/**
 * Aba Início (Plano 18, US-262, US-263): o aviso do paciente bloqueado, o botão Adicionar (nunca para bloqueado ou anonimizado; arquivado registra, como
 * cada aba), o cartão Resumo (RN-276), o cartão "No app do paciente" (D16, US-264), o bloco da IA (US-120) e as seções do
 * registro, na ordem dele (RN-277, RN-278), com o selo "No app" (RN-279). O cadastro e as etiquetas ficam no Perfil (D12).
 */
export default async function InicioPage({ params }: PageProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const bloqueado = paciente.status === 'bloqueado';
  // RN-269: a nota "Cadastro incompleto" só onde dá para completar (o Perfil de bloqueado ou anonimizado é só para consulta)
  const completavel = !bloqueado && !paciente.anonimizadoEm;
  const [ia, { secoes, noApp }, resumo, incompleto] = await Promise.all([
    iaDoAssistente(ctx, tenant, paciente, 'resumo_historico'),
    secoesDoInicio(ctx, tenant, paciente).then((s) => secoesComSelo(ctx, s, paciente.id)),
    cartaoResumo(ctx, tenant.fuso, paciente),
    completavel ? notaDoCadastro(ctx, paciente.id) : null,
  ]);
  const podeAdicionar = completavel;
  const pesoOculto = Boolean(paciente.pesoOcultoNoAppEm);
  const grupos = podeAdicionar ? montarAdicionar(paciente.id, secoes) : [];
  const chaves = grupos.flatMap((g) => g.itens.flatMap((i) => ('acao' in i ? [i.acao] : [])));
  return (
    <div className="space-y-6">
      {/* o aviso que o antigo Resumo mostrava (code review do PR 1 do Plano 18), o mesmo do Perfil */}
      {bloqueado && <p role="status">{MSG_BLOQUEADO}</p>}
      {podeAdicionar && <Adicionar grupos={grupos} acoes={acoesDoAdicionar(paciente.id, chaves)} />}
      <div className="grid gap-6 md:grid-cols-2">
        <Cartao id="resumo-titulo" titulo={MSG_FICHA.resumo.titulo}>
          <ul className="space-y-1">
            {linhasDoResumo(resumo).map((l) => <li key={l}>{l}</li>)}
          </ul>
          {/* RN-269: nota, não erro (aparece em quase todo paciente antigo); sem região viva. O Perfil audita a leitura: sem prefetch */}
          {incompleto && (
            <div className="mt-3">
              <Aviso tipo="aviso" papel="nenhum">
                {incompleto}{' '}
                <Link href={`/painel/pacientes/${paciente.id}/perfil`} prefetch={false} className="underline">{MSG_FICHA.incompleto.completar}</Link>
              </Aviso>
            </div>
          )}
        </Cartao>
        {noApp && <CartaoNoApp noApp={noApp} patientId={paciente.id} documentos={tenant.documentosLiberados} />}
      </div>
      {/* US-120 (Plano 14B): só com a IA da plataforma presente e o paciente ativo; sem poder pedir, o motivo (texto da aba Exames) */}
      {ia && (
        <section aria-labelledby="ia-titulo" className="space-y-2">
          <h2 id="ia-titulo" className="text-lg font-semibold">Inteligência artificial</h2>
          {ia.podePedir ? (
            <BotaoLink href={`/painel/pacientes/${paciente.id}/resumo-ia`} variante="secundario">{MSG_RESUMO.botao}</BotaoLink>
          ) : (
            <p className="text-sm text-suave">{ia.aviso}</p>
          )}
        </section>
      )}
      <section aria-labelledby="secoes-titulo" data-guia="secoes-inicio" className="rounded-3xl border border-borda bg-cartao px-5 py-2">
        <h2 id="secoes-titulo" className="sr-only">{MSG_FICHA.secoesTitulo}</h2>
        {/* RN-279, §8.3: com o peso oculto, a seção Antropometria avisa que peso e IMC não aparecem no app — pela marca do
            próprio paciente (não pelo No app, que vai neutro para arquivado e bloqueado e some se a contagem falhar) */}
        {secoes.map((s) => <Secao key={s.id} secao={s} patientId={paciente.id} nota={s.id === 'antropometria' && pesoOculto ? MSG_FICHA.pesoOcultoNaSecao : undefined} />)}
      </section>
    </div>
  );
}
