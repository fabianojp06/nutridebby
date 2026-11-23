import { Botao } from '@/components/ui/botao';
import { MSG_RELATORIOS, type RankingPor, type Secao } from '@/modules/relatorios/constantes';
import { mesPorExtenso, textoMostrando, type ErroDoPeriodo, type Periodo } from '@/modules/relatorios/periodo';
import { FocoNoAviso } from './foco';
import { ROTA_DA_SECAO } from './url';

const F = MSG_RELATORIOS.filtros;
const ID_MOSTRANDO = 'periodo-mostrando';
const CAMPO = 'min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto';

type Campo = 'de' | 'ate';

function SelecaoDeMes({ id, rotulo, opcoes, valor, erro }: { id: Campo; rotulo: string; opcoes: string[]; valor: string; erro: string | null }) {
  const idErro = `${id}-erro`;
  return (
    <div className="min-w-48 space-y-1">
      <label htmlFor={id} className="block font-medium">
        {rotulo}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={valor}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${idErro} ${ID_MOSTRANDO}` : undefined}
        className={CAMPO}
      >
        {opcoes.map((m) => (
          <option key={m} value={m}>
            {mesPorExtenso(m)}
          </option>
        ))}
      </select>
      {erro && (
        // sem role="alert": numa página renderizada no servidor ele não é anunciado; o foco vem por script (FocoNoAviso)
        <p id={idErro} tabIndex={-1} className="text-sm text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * §4.1 / RN-481: o formulário GET do período (funciona sem JavaScript): "De" e "Até" como `<select>` de meses (o Firefox
 * desktop não tem `<input type="month">`) e "Aplicar", de volta à própria seção. Os `<select>` mostram o que veio na URL
 * quando o mês está nas opções; senão, o período dos números. Período inválido: o erro da §6.2 junto do campo
 * (`aria-invalid` + `aria-describedby`, com o "Mostrando …"), e o foco vai ao aviso. No Ranking, o critério segue num
 * campo oculto. Sem o filtro de local até o Plano 23 (T11a).
 */
export function FiltrosDoPeriodo({
  secao,
  opcoes,
  periodo,
  escolhido,
  erro,
  por,
}: {
  secao: Secao;
  opcoes: string[];
  periodo: Periodo;
  escolhido: { de: string | null; ate: string | null };
  erro: ErroDoPeriodo | null;
  por: RankingPor;
}) {
  const valor = (c: Campo) => {
    const v = escolhido[c];
    return v !== null && opcoes.includes(v) ? v : periodo[c];
  };
  // o erro fica junto do "Até" só quando o "De" que veio é um mês da lista e o "Até" não é; senão, junto do "De"
  const campoDoErro: Campo = erro === 'invalido' && escolhido.de !== null && opcoes.includes(escolhido.de) && (escolhido.ate === null || !opcoes.includes(escolhido.ate)) ? 'ate' : 'de';
  const texto = erro ? MSG_RELATORIOS.erros[erro] : null;
  return (
    <div className="space-y-2">
      <form method="get" action={ROTA_DA_SECAO[secao]} data-guia="filtro-periodo" className="flex flex-wrap items-start gap-3">
        {secao === 'ranking' && por !== 'consultas' && <input type="hidden" name="por" value={por} />}
        <SelecaoDeMes id="de" rotulo={F.de} opcoes={opcoes} valor={valor('de')} erro={campoDoErro === 'de' ? texto : null} />
        <SelecaoDeMes id="ate" rotulo={F.ate} opcoes={opcoes} valor={valor('ate')} erro={campoDoErro === 'ate' ? texto : null} />
        <Botao variante="secundario" className="mt-7">
          {F.aplicar}
        </Botao>
      </form>
      {erro && (
        <>
          <p id={ID_MOSTRANDO} className="text-sm">
            {textoMostrando(periodo)}
          </p>
          <FocoNoAviso key={`${erro}-${escolhido.de}-${escolhido.ate}`} id={`${campoDoErro}-erro`} />
        </>
      )}
    </div>
  );
}
