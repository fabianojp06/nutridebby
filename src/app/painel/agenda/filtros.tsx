import Link from 'next/link';
import { ANOS_FUTUROS_AGENDA } from '@/modules/agenda/fuso';
import { MSG_VISOES as M } from '@/modules/agenda/constantes';
import { somarAnos } from '@/modules/pacientes/datas';
import { hrefDaAgenda, MARCADOR_RETORNO_LIGADO, type AgendaDoPeriodo, type FiltrosDaAgenda } from '@/modules/agenda/visoes';

/**
 * Plano 23 (US-404, US-405, §4.1, AG-D52): os dois formulários GET da agenda, sem JavaScript — "Filtrar" (local, paciente,
 * marcadores, "Mostrar 24 horas") e "Ir para data" — cada um com os outros parâmetros em campos `hidden`. Só datas, ids de
 * local e de paciente e marcas na URL (sem dado sensível; `GET_PERMITIDOS` de formularios-post.test.ts). "Limpar filtros"
 * volta para a visão e a data, sem o resto.
 */
const CAMPO = 'min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha';

function Ocultos({ campos }: { campos: [string, string | undefined][] }) {
  return campos.filter((c): c is [string, string] => !!c[1]).map(([nome, valor]) => <input key={nome} type="hidden" name={nome} value={valor} />);
}

function Marca({ nome, valor, rotulo, marcada }: { nome: string; valor: string; rotulo: string; marcada: boolean }) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2">
      <input type="checkbox" name={nome} value={valor} defaultChecked={marcada} className="size-5" />
      {rotulo}
    </label>
  );
}

export function FiltrosDaAgendaForm({ f, opcoes, hoje }: { f: FiltrosDaAgenda; opcoes: AgendaDoPeriodo['opcoes']; hoje: string }) {
  // "Aniversários" não vale na Lista (sem marcadores); "Mostrar 24 horas", só na grade de horas (Dia e Semana)
  const comAniversario = f.visao !== 'lista';
  const com24Horas = f.visao === 'dia' || f.visao === 'semana';
  return (
    <div className="space-y-3 text-sm">
      <form method="get" action="/painel/agenda" aria-label={M.formularioFiltros} className="flex flex-wrap items-end gap-3">
        <Ocultos
          campos={[
            ['visao', f.visao],
            ['data', f.data],
            // M3 (revisão da T5): as marcas que não valem nesta visão saem da tela, mas o valor segue (volta ao trocar de visão)
            ['aniversario', !comAniversario && f.aniversario ? '1' : undefined],
            ['horas', !com24Horas && f.horas24 ? '24' : undefined],
          ]}
        />
        <div className="min-w-44 max-w-full space-y-1">
          <label htmlFor="filtro-local" className="block font-medium">{M.local}</label>
          <select id="filtro-local" name="local" defaultValue={f.local ?? ''} className={CAMPO}>
            <option value="">{M.todosOsLocais}</option>
            {opcoes.locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
        <div className="min-w-44 max-w-full space-y-1">
          <label htmlFor="filtro-paciente" className="block font-medium">{M.paciente}</label>
          <select id="filtro-paciente" name="paciente" defaultValue={f.paciente ?? ''} className={CAMPO}>
            <option value="">{M.todos}</option>
            {opcoes.pacientes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        {MARCADOR_RETORNO_LIGADO && <Marca nome="retorno" valor="1" rotulo={M.previsoesDeRetorno} marcada={f.retorno} />}
        {comAniversario && <Marca nome="aniversario" valor="1" rotulo={M.aniversarios} marcada={f.aniversario} />}
        {com24Horas && <Marca nome="horas" valor="24" rotulo={M.mostrar24Horas} marcada={f.horas24} />}
        <button className={BOTAO}>{M.filtrar}</button>
        <Link href={hrefDaAgenda({ visao: f.visao, data: f.data })} className="inline-flex min-h-11 items-center text-link underline">{M.limparFiltros}</Link>
      </form>
      <form method="get" action="/painel/agenda" aria-label={M.irParaData} className="flex flex-wrap items-end gap-3">
        <Ocultos
          campos={[
            ['visao', f.visao],
            ['local', f.local],
            ['paciente', f.paciente],
            ['horas', f.horas24 ? '24' : undefined],
            ['retorno', f.retorno && MARCADOR_RETORNO_LIGADO ? '1' : undefined],
            ['aniversario', f.aniversario ? '1' : undefined],
          ]}
        />
        <div className="space-y-1">
          <label htmlFor="ir-para-data" className="block font-medium">{M.irParaData}</label>
          <input id="ir-para-data" type="date" name="data" defaultValue={f.data} min="1900-01-01" max={somarAnos(hoje, ANOS_FUTUROS_AGENDA)} required className={CAMPO} />
        </div>
        <button className={BOTAO}>{M.irParaAData}</button>
      </form>
    </div>
  );
}
