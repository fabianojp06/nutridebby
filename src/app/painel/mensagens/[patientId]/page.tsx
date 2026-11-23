import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Selo } from '@/components/ui/selo';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_MENSAGENS, ROTULO_FORMA_TCLE } from '@/modules/mensagens/constantes';
import { conversaNoPainel } from '@/modules/mensagens/conversa';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { retomarAction } from './actions';
import { CampoDaConversa } from './campo';
import { LiberarDialogo } from './liberar-dialogo';
import { ComLinkDoPerfil } from './link-do-perfil';
import { ListaDeMensagens } from './lista-de-mensagens';
import { PausarDialogo } from './pausar-dialogo';
import { ProvedorDaLeitura, SituacaoDaConversa } from './situacao';

export const dynamic = 'force-dynamic';
/** §7.1: o título da aba do navegador é sempre "Mensagens", nunca o nome do paciente. */
export const metadata: Metadata = { title: MSG_MENSAGENS.caixa.titulo };

const M = MSG_MENSAGENS;
/** Os retornos `?ok=` dos atos (códigos fechados; fora da lista, nada). A resposta à dúvida (`respondida`) entra na T9. */
const RETORNOS: Record<string, string> = { liberada: M.liberacao.sucesso, pausada: M.pausa.sucesso, retomada: M.pausa.retomada };
const BOTAO_SECUNDARIO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha';

/**
 * US-440, US-441 e US-450 (§6.2, §7.2): a conversa com o paciente. Abrir lê com auditRead e avança o "lido" do consultório
 * até a última mensagem do paciente mostrada (CH-D72, no módulo). Cabeçalho com o nome de registro, "Abrir ficha", o estado
 * ("Liberada em…", "Conversa pausada") e "Pausar conversa"/"Retomar conversa"; a lista; o rodapé `sticky` com a região viva
 * sempre montada e o campo. Estados: não liberada ("Liberar conversa", ou o texto com o link ao Perfil sem o carimbo), sem
 * acesso ao app, pausada, arquivado e bloqueado (só leitura), anonimizado (a conversa saiu). Paciente inexistente ou de
 * outro consultório → `notFound()`.
 */
export default async function Conversa({ params, searchParams }: PageProps<'/painel/mensagens/[patientId]'>) {
  const { ctx, tenant } = await requireNutri('/painel/mensagens');
  const { patientId } = await params;
  const sp = await searchParams;
  const antes = typeof sp.antes === 'string' ? sp.antes : undefined;
  let c: Awaited<ReturnType<typeof conversaNoPainel>>;
  try {
    c = await conversaNoPainel(ctx, patientId, { antes });
  } catch (err) {
    if (err instanceof PacienteNaoEncontradoError) notFound();
    throw err;
  }
  const { estado, mensagens, nome } = c;
  const primeiroNome = nome.split(/\s+/)[0] ?? nome;
  const aviso = typeof sp.ok === 'string' && Object.hasOwn(RETORNOS, sp.ok) ? RETORNOS[sp.ok] : '';
  const ativo = estado.titular === 'ativo';
  const liberada = estado.liberadaEm !== null;
  const podeEnviar = ativo && liberada && !estado.pausada && estado.carimbo;
  const minhas = mensagens.filter((m) => m.minha).map((m) => m.id);
  const ultima = mensagens.at(-1)?.id ?? null;

  if (estado.titular === 'anonimizado')
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <h1 className="font-titulo text-2xl font-semibold">{nome}</h1>
        <p>{M.estados.anonimizado}</p>
      </main>
    );

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-titulo text-2xl font-semibold">{nome}</h1>
          <Link href={`/painel/pacientes/${patientId}`} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
            {M.conversa.abrirFicha}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {estado.liberadaEm && estado.formaDoTcle && (
            <p className="text-sm text-suave">{M.estados.liberadaEm(formatarDataNoFuso(estado.liberadaEm, tenant.fuso), ROTULO_FORMA_TCLE[estado.formaDoTcle])}</p>
          )}
          {estado.pausada && <Selo>{M.estados.seloPausada}</Selo>}
          {ativo && liberada && !estado.pausada && <PausarDialogo patientId={patientId} nome={nome} />}
          {ativo && estado.pausada && (
            <form action={retomarAction.bind(null, patientId)}>
              <button className={BOTAO_SECUNDARIO}>{M.pausa.retomar}</button>
            </form>
          )}
        </div>
        {estado.titular === 'arquivado' && <p>{M.estados.arquivado}</p>}
        {estado.titular === 'bloqueado' && <p>{M.estados.bloqueado}</p>}
        {ativo && !liberada && (
          <div className="space-y-2">
            <p>{M.estados.naoLiberada(nome)}</p>
            {estado.carimbo ? <LiberarDialogo patientId={patientId} nome={nome} /> : <p><ComLinkDoPerfil texto={M.liberacao.semCarimbo} /></p>}
          </div>
        )}
        {ativo && liberada && !estado.temConta && <p>{M.estados.semAcesso(nome)}</p>}
      </div>

      <ProvedorDaLeitura key={`${ultima}:${c.ultimaLida}`} minhas={minhas} ultimaLida={c.ultimaLida}>
        <div className="flex-1 space-y-3">
          {c.haAnteriores && mensagens[0] && (
            <p className="text-center">
              <Link href={`/painel/mensagens/${patientId}?antes=${mensagens[0].id}`} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
                {M.conversa.verAnteriores}
              </Link>
            </p>
          )}
          <ListaDeMensagens mensagens={mensagens} fuso={tenant.fuso} primeiroNome={primeiroNome} />
          <div id="fim-da-conversa" />
        </div>
        <div className="sticky bottom-0 space-y-3 border-t border-borda bg-fundo pt-3 pb-2">
          <SituacaoDaConversa patientId={patientId} depois={ultima} primeiroNome={primeiroNome} aviso={aviso} focarAviso={aviso !== ''} consultar={antes === undefined && ativo} />
          {podeEnviar && <CampoDaConversa patientId={patientId} />}
          {ativo && liberada && !estado.pausada && !estado.carimbo && (
            <p>
              <ComLinkDoPerfil texto={M.erros.semCarimbo} />
            </p>
          )}
        </div>
      </ProvedorDaLeitura>
    </main>
  );
}
