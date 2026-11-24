import { MSG_FILTRO_LOCAL as M } from '@/modules/agenda/constantes';
import type { OpcoesDeLocal } from '@/modules/agenda/locais';

/**
 * Plano 23 (US-415, US-416, AG-D79): as `<option>` do filtro "Local" dos filtros de histórico (Pacientes, Lançamentos,
 * Relatórios e o CSV) — "Todos os locais" (valor vazio), os ativos, "Sem local" (só no Financeiro) e, à parte, no grupo
 * "Arquivados", os arquivados com histórico. Sem estado: serve à página do servidor e ao formulário cliente do CSV.
 */
export function OpcoesDoFiltroDeLocal({ opcoes, semLocal }: { opcoes: OpcoesDeLocal; semLocal?: string }) {
  return (
    <>
      <option value="">{M.todosOsLocais}</option>
      {opcoes.ativos.map((l) => (
        <option key={l.id} value={l.id}>
          {l.nome}
        </option>
      ))}
      {semLocal && <option value={semLocal}>{M.semLocal}</option>}
      {opcoes.arquivados.length > 0 && (
        <optgroup label={M.arquivados}>
          {opcoes.arquivados.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
