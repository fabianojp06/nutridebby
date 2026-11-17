'use client';

import { useMemo } from 'react';
import { MSG_NUTRIENTES, NUTRIENTES } from '@/modules/alimentos/nutrientes';
import { MAX_NUTRIENTES_EXIBIDOS, type ReferenciaParaPlano } from '@/modules/alimentos/referencias-constantes';
import { MSG_DIAS } from '@/modules/plano-alimentar/constantes';
import { podeEscolherNutriente, resumoDeNutrientes, textoDaLinha, type Acao, type EstadoEditor, type FiltroDia, type LinhaDoNutriente, type ResumoDeNutrientes } from './estado';

const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const TODAS = NUTRIENTES.map((n) => n.chave);

type Props = {
  estado: EstadoEditor;
  filtro: FiltroDia;
  /** Rascunho e modelo: os perfis do consultório para escolher. */
  perfis: readonly ReferenciaParaPlano[];
  /** Publicado ou arquivado: a cópia do perfil feita na publicação (RN-238); `undefined` no rascunho e no modelo. */
  congelado?: ReferenciaParaPlano | null;
  /** O PDF só existe no plano do paciente (o modelo não tem a caixa "Mostrar calorias ao paciente"). */
  comPaciente: boolean;
  somenteLeitura: boolean;
  despachar: (a: Acao) => void;
  /** Erro do servidor em `nutrientesExibidos` ("Escolha até 12 nutrientes."). */
  erro?: string;
};

/**
 * US-233 (RN-239): "Nutrientes do paciente" no editor do plano calculado (o editor não mostra a seção no modo livre,
 * RN-243). O perfil de referência, até 12 nutrientes com o total do dia escolhido no filtro de dias e, com perfil, a
 * meta e o máximo; "Ver todos os nutrientes" com o catálogo inteiro; e a caixa do PDF, que depende de "Mostrar calorias
 * ao paciente" (D12). Os micros e o perfil nunca vão ao app do paciente (RN-240).
 */
export function NutrientesDoPaciente({ estado, filtro, perfis, congelado, comPaciente, somenteLeitura, despachar, erro }: Props) {
  const publicado = congelado !== undefined;
  // RN-238 (D30): o rascunho aponta para um perfil do consultório; sem ele (excluído ou nenhum) → "Sem perfil"
  const perfil = publicado ? congelado : (perfis.find((p) => p.id === estado.referenciaId) ?? null);
  const resumo = useMemo(() => resumoDeNutrientes(estado, filtro, estado.nutrientesExibidos, perfil), [estado, filtro, perfil]);
  const todos = useMemo(() => resumoDeNutrientes(estado, filtro, TODAS, perfil), [estado, filtro, perfil]);
  const podeMais = podeEscolherNutriente(estado);
  const semCalorias = !estado.mostrarCalorias;

  return (
    <section aria-labelledby="nutrientes-titulo" className="space-y-3 rounded-2xl border border-borda bg-cartao p-3">
      <h2 id="nutrientes-titulo" className="text-lg font-semibold">{MSG_NUTRIENTES.doPaciente}</h2>

      {publicado ? (
        <p>
          {MSG_NUTRIENTES.perfil}: {perfil ? `${perfil.nome} — ${perfil.fonte}` : MSG_NUTRIENTES.semPerfil}
        </p>
      ) : (
        <div className="space-y-1">
          <label htmlFor="referencia" className="block font-medium">{MSG_NUTRIENTES.perfil}</label>
          <select id="referencia" disabled={somenteLeitura} value={perfil?.id ?? ''} onChange={(e) => despachar({ tipo: 'referencia', id: e.target.value || null })} aria-describedby={perfil ? 'referencia-fonte' : undefined} className={CAMPO}>
            <option value="">{MSG_NUTRIENTES.semPerfil}</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          {perfil && <p id="referencia-fonte" className="text-sm text-suave">Fonte: {perfil.fonte}</p>}
        </div>
      )}

      <Resumo resumo={resumo} />

      {!somenteLeitura && (
        <details className="rounded-xl border border-borda p-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Escolher nutrientes ({estado.nutrientesExibidos.length} de {MAX_NUTRIENTES_EXIBIDOS})</summary>
          <fieldset aria-describedby={erro ? 'nutrientes-limite nutrientes-erro' : 'nutrientes-limite'} className="mt-2 space-y-2">
            <legend className="sr-only">Nutrientes do resumo</legend>
            <p id="nutrientes-limite" className="text-sm text-suave">{MSG_NUTRIENTES.limite}</p>
            <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              {NUTRIENTES.map((n) => {
                const marcado = estado.nutrientesExibidos.includes(n.chave);
                return (
                  <label key={n.chave} className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={marcado} disabled={!marcado && !podeMais} onChange={(e) => despachar({ tipo: 'nutriente', chave: n.chave, marcado: e.target.checked })} />
                    {n.nome}
                  </label>
                );
              })}
            </div>
            {erro && <p id="nutrientes-erro" role="alert" className="text-sm text-erro">{erro}</p>}
          </fieldset>
        </details>
      )}

      <details className="rounded-xl border border-borda p-2">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">{MSG_NUTRIENTES.verTodos}</summary>
        <TodosOsNutrientes resumo={todos} comPerfil={perfil !== null} />
      </details>

      {comPaciente && (
        <div className="space-y-1">
          <label className="flex min-h-11 items-center gap-2">
            {/* D12: só vale com "Mostrar calorias ao paciente"; desligada, a caixa fica desabilitada e diz por quê */}
            <input
              type="checkbox"
              checked={estado.mostrarMicrosPdf && !semCalorias}
              disabled={somenteLeitura || semCalorias}
              aria-describedby={semCalorias ? 'micros-pdf-dica' : undefined}
              onChange={(e) => despachar({ tipo: 'mostrarMicrosPdf', valor: e.target.checked })}
            />
            {MSG_NUTRIENTES.mostrarNoPdf}
          </label>
          {semCalorias && <p id="micros-pdf-dica" className="text-sm text-suave">{MSG_NUTRIENTES.ligueCalorias}</p>}
        </div>
      )}
    </section>
  );
}

function Resumo({ resumo }: { resumo: ResumoDeNutrientes }) {
  if (resumo.tipo === 'naoRegistrados') return <p>{MSG_NUTRIENTES.naoRegistrados}</p>;
  if (resumo.tipo === 'escolhaUmDia') return <p className="text-suave">{MSG_DIAS.escolhaUmDia}</p>;
  if (!resumo.linhas.length) return null;
  return (
    <ul className="space-y-1" aria-label="Resumo dos nutrientes do dia">
      {resumo.linhas.map((l) => (
        <li key={l.chave}>
          <span>{textoDaLinha(l)}</span>
          {l.acimaDoMaximo && <strong className="ml-1 rounded bg-erro-fundo px-1 text-erro">{MSG_NUTRIENTES.acimaDoMaximo(l.maximo!)}</strong>}
          {l.semValor > 0 && <span className="block text-sm text-suave">{MSG_NUTRIENTES.semValorDe(l.semValor, l.nome)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** "Ver todos os nutrientes": o catálogo inteiro com o total do dia e, quando o perfil tem, a meta e o máximo. */
function TodosOsNutrientes({ resumo, comPerfil }: { resumo: ResumoDeNutrientes; comPerfil: boolean }) {
  if (resumo.tipo !== 'linhas') return <div className="mt-2"><Resumo resumo={resumo} /></div>;
  const celula = (l: LinhaDoNutriente) => (l.acimaDoMaximo ? `${l.total} — ${MSG_NUTRIENTES.acimaDoMaximo(l.maximo!)}` : l.total);
  return (
    // a tabela pode passar da largura no celular: a faixa rola e recebe o foco do teclado, com o contorno para dentro (D25)
    <div role="region" aria-labelledby="todos-nutrientes-legenda" tabIndex={0} className="mt-2 overflow-x-auto p-2 focus-visible:outline-offset-[-3px]">
      <table className="text-sm">
        <caption id="todos-nutrientes-legenda" className="sr-only">Todos os nutrientes do dia</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3 text-left">Nutriente</th>
            <th scope="col" className="pr-3 text-left">Total do dia</th>
            {comPerfil && <th scope="col" className="pr-3 text-left">Meta</th>}
            {comPerfil && <th scope="col" className="text-left">Máximo</th>}
          </tr>
        </thead>
        <tbody>
          {resumo.linhas.map((l) => (
            <tr key={l.chave}>
              <th scope="row" className="pr-3 text-left font-normal">{l.nome}</th>
              <td className="pr-3">{celula(l)}</td>
              {comPerfil && <td className="pr-3">{l.meta === null ? '—' : `${l.meta}${l.porcentagem === null ? '' : ` (${l.porcentagem})`}`}</td>}
              {comPerfil && <td>{l.maximo ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
