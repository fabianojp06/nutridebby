import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProvedorDaLeitura } from '@/components/mensagens/leitura';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { requirePaciente } from '@/lib/paciente-session';
import { erroDoUpload, MSG_PORTAL_MENSAGENS } from '@/modules/mensagens/constantes';
import { minhaConversa } from '@/modules/mensagens/conversa';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { ComTelefones } from '../plano/ia/texto-fixo';
import { CampoDoPortal, ID_AVISO_URGENCIA, SituacaoDoPortal } from './conversa-portal';
import { ListaDoPortal } from './lista';

export const dynamic = 'force-dynamic';
/** O título da aba do navegador. */
export const metadata: Metadata = { title: MSG_PORTAL_MENSAGENS.titulo };

const P = MSG_PORTAL_MENSAGENS;
const LINK = 'inline-flex min-h-11 items-center font-semibold text-link underline';

/**
 * Plano 25, T7 (US-443; RN-449 a RN-452, RN-463, RN-471 a RN-473; §6.2 e §7.3): a conversa no app. Tela de detalhe de Hoje
 * (CabecalhoDetalhe com "Voltar", CH-D15/CH-D48), aberta pelo link "Mensagens" da faixa ou pelo push (`?v=` do consultório:
 * requirePaciente escolhe o vínculo). Abrir lê com auditRead e avança o "lido" do paciente até a última mensagem da
 * nutricionista mostrada (CH-D72, no módulo). No topo: "Conversa com {nome profissional}, nutricionista, {crn}" e os
 * contatos do perfil (RN-471), o aviso de urgência sempre (RN-450) e o horário, quando ligado (RN-451, RN-472). Depois a
 * lista (com o socorro sob a mensagem de risco, RN-449) e o rodapé `sticky` com a região viva sempre montada e o campo.
 * Só recados (sem a conversa liberada) ou pausada: o texto no rodapé, no lugar do campo. Nunca no cache do service worker
 * (RN-473).
 */
export default async function Mensagens({ searchParams }: PageProps<'/p/mensagens'>) {
  const { ctx, tenant } = await requirePaciente('/p/mensagens');
  const sp = await searchParams;
  const antes = typeof sp.antes === 'string' ? sp.antes : undefined;
  const { estado, horario, mensagens, haAnteriores, ultimaLida, temRecado } = await minhaConversa(ctx, { antes });
  const liberada = estado.liberadaEm !== null;
  // /code-review do PR 2 (nit 3): a regra do link "Mensagens" da faixa (`mensagensNaFaixa`) — sem a conversa liberada e sem
  // recado não há o que mostrar ("só recados" seria falso)
  if (!liberada && !temRecado) redirect('/p/inicio');
  const podeEnviar = liberada && !estado.pausada && estado.titular === 'ativo';
  // §6.2 v0.3: o `?erro=` do envio sem JS (códigos fechados; fora da lista, nada) — junto ao campo ou, sem campo, na região
  const erroDaUrl = erroDoUpload('portal', sp.erro);
  const minhas = mensagens.filter((m) => m.minha).map((m) => m.id);
  const ultima = mensagens.at(-1)?.id ?? null;
  const contatos = [
    tenant.contatoEmail ? { href: `mailto:${tenant.contatoEmail}`, texto: tenant.contatoEmail } : null,
    tenant.contatoTelefoneE164 ? { href: `tel:${tenant.contatoTelefoneE164}`, texto: formatarTelefone(tenant.contatoTelefoneE164) } : null,
  ].filter((c) => c !== null);

  return (
    <>
      {/* rodada da T7: sem o selo "Offline — exibindo última versão" (aqui nada vem de cópia; sem rede, a região avisa) */}
      <CabecalhoDetalhe titulo={P.titulo} voltar={{ href: '/p/inicio', secao: 'Hoje' }} seloOffline={false} />
      <main className="flex flex-1 flex-col gap-4 p-4">
        <div className="space-y-2">
          {tenant.nomeProfissional && tenant.crn && <p className="font-semibold">{P.conversaCom(tenant.nomeProfissional, tenant.crn)}</p>}
          {contatos.length > 0 && (
            <ul className="flex flex-wrap gap-x-4">
              {contatos.map((c) => (
                <li key={c.href}>
                  <a href={c.href} className={`${LINK} wrap-anywhere`}>
                    {c.texto}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {/* RN-450: sempre, como texto (não um aviso que some); descreve o campo (rodada da T7, I1) */}
          <p id={ID_AVISO_URGENCIA} className="rounded-2xl border-2 border-erro bg-erro-fundo p-3 text-texto">
            <ComTelefones texto={P.avisoUrgencia} />
          </p>
          {/* o horário só com o envio aberto: na conversa pausada, "fica guardada e será lida…" enganaria */}
          {podeEnviar && horario.horarioAtivo && (
            <>
              {horario.faixas.length === 0 ? <p>{P.semHorario}</p> : <p>{P.horario(horario.resumo)}</p>}
              {horario.foraDoHorario && <p>{P.foraDoHorario}</p>}
            </>
          )}
        </div>

        {/* molde da rodada da T6b (C1): sem `key` — a página que refaz não remonta o campo nem a região viva */}
        <ProvedorDaLeitura minhas={minhas} ultimaLida={ultimaLida}>
          <div className="flex-1 space-y-3">
            {haAnteriores && mensagens[0] && (
              <p className="text-center">
                <Link href={`/p/mensagens?antes=${mensagens[0].id}`} prefetch={false} className={LINK}>
                  {P.verAnteriores}
                </Link>
              </p>
            )}
            {mensagens.length === 0 && podeEnviar && <p className="text-suave">{P.vazio}</p>}
            <ListaDoPortal mensagens={mensagens} fuso={tenant.fuso} />
          </div>
          <div id="rodape-da-conversa" className="sticky bottom-0 space-y-3 border-t border-borda bg-fundo pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <SituacaoDoPortal depois={ultima} consultar={antes === undefined} abrirNoFim={antes === undefined} aviso={podeEnviar ? '' : (erroDaUrl ?? '')} />
            {/* rodada da T7 (I1): só recados ou pausada — o texto no lugar do campo (a tela abre no fim, nunca o esconde) */}
            {/* /code-review do PR 2 (I2): o envio a partir de `?antes=` leva à conversa sem `?antes=` (a mensagem nova aparece) */}
            {podeEnviar ? <CampoDoPortal erroInicial={erroDaUrl} naAnterior={antes !== undefined} /> : !liberada ? <p>{P.soRecados}</p> : estado.pausada ? <p>{P.pausada}</p> : null}
          </div>
        </ProvedorDaLeitura>
      </main>
    </>
  );
}
