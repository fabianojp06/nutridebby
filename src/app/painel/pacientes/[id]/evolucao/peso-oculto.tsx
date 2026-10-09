import { Botao } from '@/components/ui/botao';
import type { PatientRow } from '@/db/schema';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { MSG_PESO_OCULTO } from '@/modules/pacientes/peso-oculto';
import { pesoOcultoAction } from './actions';

/** Plano 16 (§4.9, US-195): a caixa "Não mostrar peso no app" na aba Evolução. Funciona sem JavaScript (formulário com ação). */
export function PesoOcultoNoApp({ paciente, fuso }: { paciente: PatientRow; fuso: string }) {
  const somenteLeitura = paciente.status === 'bloqueado' || Boolean(paciente.anonimizadoEm);
  return (
    <section aria-labelledby="peso-no-app" className="space-y-2">
      <h2 id="peso-no-app" className="text-lg font-semibold">{MSG_PESO_OCULTO.titulo}</h2>
      {paciente.pesoOcultoNoAppEm && <p>{MSG_PESO_OCULTO.desde(formatarDataNoFuso(paciente.pesoOcultoNoAppEm, fuso))}</p>}
      <form action={pesoOcultoAction.bind(null, paciente.id)} className="space-y-2">
        <p className="flex min-h-11 items-center gap-2">
          <input id="ocultar" name="ocultar" type="checkbox" defaultChecked={Boolean(paciente.pesoOcultoNoAppEm)} disabled={somenteLeitura} aria-describedby="ocultar-ajuda" className="size-5" />
          <label htmlFor="ocultar">{MSG_PESO_OCULTO.rotulo}</label>
        </p>
        <p id="ocultar-ajuda" className="max-w-2xl text-sm text-suave">{MSG_PESO_OCULTO.ajuda}</p>
        {!somenteLeitura && <Botao variante="secundario">{MSG_PESO_OCULTO.salvar}</Botao>}
      </form>
    </section>
  );
}
