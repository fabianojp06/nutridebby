import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import type { PatientRow } from '@/db/schema';
import { situacaoDaCiencia } from '@/modules/ia/ciencia-paciente';
import { MSG_IA } from '@/modules/ia/constantes';
import { AVISO_IA_VERSAO, avisoDaVersao } from '@/modules/ia/textos-legais';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { enviarAvisoIaAction, recusaIaAction, registrarEntregaIaAction } from './actions';

const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha';

/** US-103 / US-104: seção "Uso de IA" da aba Privacidade. */
export function UsoDeIa({ paciente, fuso, enviado }: { paciente: PatientRow; fuso: string; enviado: boolean }) {
  const c = situacaoDaCiencia(paciente);
  const aviso = avisoDaVersao(AVISO_IA_VERSAO);
  const somenteLeitura = paciente.status === 'bloqueado' || Boolean(paciente.anonimizadoEm);
  return (
    <section aria-labelledby="uso-ia" className="space-y-2">
      <h2 id="uso-ia" className="text-lg font-semibold">Uso de IA</h2>
      {enviado && <Aviso tipo="ok">{MSG_IA.avisoEnviado}</Aviso>}
      {c.tipo === 'informado' && <p>{MSG_IA.informado(formatarDataNoFuso(c.em, fuso), c.canal === 'email' ? 'e-mail' : 'em mãos', c.versao)}</p>}
      {c.tipo === 'aguardando_email' && <p>{MSG_IA.aguardandoEnvio(formatarDataNoFuso(c.enviadoEm, fuso))}</p>}
      {c.tipo === 'nao_informado' && <p>{MSG_IA.naoInformado}</p>}
      {!somenteLeitura && c.tipo !== 'informado' && (
        <div className="space-y-2">
          <form action={enviarAvisoIaAction.bind(null, paciente.id)}>
            <button className={BOTAO}>Enviar aviso por e-mail</button>
          </form>
          <details className="rounded-2xl border border-borda p-3">
            <summary className="cursor-pointer">Registrar entrega em mãos</summary>
            <details className="mt-2">
              <summary className="cursor-pointer text-link underline">Ver aviso para imprimir</summary>
              <article className="mt-2 space-y-2">
                <h3 className="font-semibold">{aviso.titulo}</h3>
                {aviso.paragrafos.map((p) => <p key={p}>{p}</p>)}
              </article>
            </details>
            <form action={registrarEntregaIaAction.bind(null, paciente.id)} className="mt-2">
              <button className={BOTAO}>Entreguei o aviso ao paciente</button>
            </form>
          </details>
        </div>
      )}
      {!somenteLeitura &&
        (paciente.iaRecusadaEm ? (
          <>
            <p>{MSG_IA.recusou}</p>
            <form action={recusaIaAction.bind(null, paciente.id, false)}>
              <button className={BOTAO}>Voltar a usar IA com este paciente</button>
            </form>
          </>
        ) : (
          <form action={recusaIaAction.bind(null, paciente.id, true)}>
            <ConfirmarBotao mensagem="Não usar IA com os dados deste paciente? As leituras na fila e as sugestões ainda não salvas dele são canceladas.">
              Não usar IA com os dados deste paciente
            </ConfirmarBotao>
          </form>
        ))}
    </section>
  );
}
