import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_REVISAO } from '@/modules/pacientes/exames-enviados-constantes';
import { definirRecebimentoAction } from './actions';

/** D18 = a (Plano 12): "Receber exames enviados pelos pacientes pelo app" — nasce desligado. */
export function ExamesSecao({ ligado, salvo }: { ligado: boolean; salvo: boolean }) {
  return (
    <section data-guia="exames-app" aria-labelledby="exames-app" className="max-w-lg space-y-3 rounded-3xl border border-borda bg-cartao p-5">
      <h2 id="exames-app" className="font-titulo text-lg font-semibold">Exames enviados pelos pacientes</h2>
      {salvo && <Aviso tipo="ok">{MSG_REVISAO.configuracaoSalva}</Aviso>}
      <form action={definirRecebimentoAction} className="space-y-3">
        <div className="flex min-h-11 items-center gap-3">
          <input id="receberExames" name="receberExames" type="checkbox" value="on" defaultChecked={ligado} className="h-5 w-5" />
          <label htmlFor="receberExames">{MSG_REVISAO.configuracao}</label>
        </div>
        <Botao variante="secundario">Salvar</Botao>
      </form>
    </section>
  );
}
