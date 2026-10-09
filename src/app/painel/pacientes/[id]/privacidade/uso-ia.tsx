import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import type { PatientRow } from '@/db/schema';
import type { PainelAutorizacao } from '@/modules/ia/autorizacao';
import { CANAL_ROTULO, DESTINO_ROTULO, MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import type { TextoLegal } from '@/modules/ia/textos-legais';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { enviarPedidoIaAction, retiradaIaAction } from './actions';
import { PedidoIaForm } from './pedido-ia-form';

const LINK = 'inline-flex min-h-11 items-center text-link underline';
const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha';

/**
 * US-105 / US-108 / US-109 (Plano 14A): a seção "Uso de IA" da aba Privacidade. `podePedir` (D10): IA ativa no consultório
 * e perfil completo — sem isso, só a situação, os registros e a retirada (que vale sempre). `aviso`: o retorno do termo
 * em papel (?ia=papel), numa região role="status" que já existe na página. `texto`: a variante do link, para "Ver o texto".
 */
export function UsoDeIa(p: { paciente: PatientRow; painel: PainelAutorizacao; podePedir: boolean; motivoSemPedido: string | null; texto: TextoLegal | null; fuso: string; aviso: string | null }) {
  const { paciente, painel, fuso } = p;
  const data = (d: Date) => formatarDataNoFuso(d, fuso);
  const s = painel.situacao;
  const somenteLeitura = paciente.status === 'bloqueado' || Boolean(paciente.anonimizadoEm);
  const semPedidos = somenteLeitura || paciente.status !== 'ativo' || s.tipo === 'vigente';
  const aRetirar = s.tipo === 'vigente' || s.tipo === 'versao_antiga' || s.tipo === 'outro_destino';
  return (
    <section aria-labelledby="uso-ia" className="space-y-3">
      <h2 id="uso-ia" className="text-lg font-semibold">
        Uso de IA
      </h2>
      <p role="status">{p.aviso ?? ''}</p>
      {s.tipo === 'nunca' && (
        <>
          <p>{MSG_AUTORIZACAO.naoAutorizou}</p>
          <p className="text-suave">{MSG_AUTORIZACAO.explicacao}</p>
        </>
      )}
      {s.tipo === 'vigente' && (
        <p>
          {MSG_AUTORIZACAO.autorizou(data(s.em), CANAL_ROTULO[s.canal], s.versao)}{' '}
          {s.canal === 'papel' && (
            <a href={`/api/painel/pacientes/${paciente.id}/autorizacao-ia/${s.id}/termo`} target="_blank" rel="noreferrer" className={LINK}>
              {MSG_AUTORIZACAO.verTermo}
            </a>
          )}
        </p>
      )}
      {s.tipo === 'retirada' && <p>{MSG_AUTORIZACAO.retirou(data(s.em))}</p>}
      {s.tipo === 'versao_antiga' && <p>{MSG_AUTORIZACAO.versaoAntiga(s.versao)}</p>}
      {s.tipo === 'outro_destino' && <p>{MSG_AUTORIZACAO.destinoTrocado(DESTINO_ROTULO[s.destino])}</p>}
      {painel.alertaEmailTrocado && <Aviso tipo="aviso">{MSG_AUTORIZACAO.emailTrocado}</Aviso>}

      {!semPedidos && p.podePedir && (
        <div className="space-y-2">
          {!paciente.email ? (
            <p>{MSG_AUTORIZACAO.semEmail}</p>
          ) : (
            // o formulário fica montado também com o pedido aberto: o "Pedido enviado…" sobrevive ao revalidatePath
            <PedidoIaForm
              acao={enviarPedidoIaAction.bind(null, paciente.id)}
              aberto={painel.pedidoAbertoAte ? MSG_AUTORIZACAO.pedidoAberto(data(painel.pedidoAbertoAte)) : null}
            />
          )}
          <p>
            <Link href={`/painel/pacientes/${paciente.id}/privacidade/termo-ia`} className={LINK}>
              {MSG_AUTORIZACAO.registrarPapel}
            </Link>
          </p>
          {paciente.userId && <p className="text-suave">{MSG_AUTORIZACAO.dicaApp}</p>}
        </div>
      )}
      {!semPedidos && !p.podePedir && p.motivoSemPedido && <p className="text-suave">{p.motivoSemPedido}</p>}
      {p.texto && (
        <details className="rounded-2xl border border-borda p-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-link underline">{MSG_AUTORIZACAO.verTexto}</summary>
          <div className="mt-2">
            <TextoLegalView texto={p.texto} id="texto-autorizacao-ia" nivel="h3" classeTitulo="font-semibold" />
          </div>
        </details>
      )}
      {!somenteLeitura && aRetirar && (
        <form action={retiradaIaAction.bind(null, paciente.id)}>
          <ConfirmarBotao mensagem={MSG_AUTORIZACAO.confirmarRetiradaNutri} className={BOTAO}>
            {MSG_AUTORIZACAO.registrarRetirada}
          </ConfirmarBotao>
        </form>
      )}
      {painel.eventos.length > 0 && (
        <>
          <h3 className="font-semibold">{MSG_AUTORIZACAO.registros}</h3>
          <ul className="space-y-1 text-sm">
            {painel.eventos.map((e) => (
              <li key={e.id}>
                {e.evento === 'autorizou'
                  ? MSG_AUTORIZACAO.registroAutorizou(data(e.em), CANAL_ROTULO[e.canal], e.versao ?? '')
                  : e.evento === 'retirou'
                    ? MSG_AUTORIZACAO.registroRetirou(data(e.em), CANAL_ROTULO[e.canal])
                    : MSG_AUTORIZACAO.registroPedido(data(e.em))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
