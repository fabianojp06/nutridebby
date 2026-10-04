'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useReducer, useState, type ReactNode } from 'react';
import { BuscaAlimento, Selo } from '@/app/painel/alimentos/busca-alimento';
import { textoMedida } from '@/modules/alimentos/medidas-constantes';
import { MSG_RECEITA } from '@/modules/conteudo/constantes';
import type { ReceitaParaPlano } from '@/modules/conteudo/receitas';
import { diferencaKcalDoItem, kcalTexto, nutrientesDoItem, totalDoDia, totalDosItens } from '@/modules/plano-alimentar/calculo';
import { MAX_TEXTO, MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import type { ContextoPaciente } from '@/modules/plano-alimentar/meta';
import type { PlanoDoCliente } from '@/modules/plano-alimentar/tipos';
import { casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import { errosSemCampo, estadoInicial, gramasDoItem, medidaDaOpcao, opcaoDaMedida, opcoesDeMedida, paraEnvio, podeAdicionarItem, podeAdicionarRefeicao, reduzir, refeicoesParaCalculo, type Acao, type EstadoEditor, type ItemEstado, type RefeicaoEstado } from './estado';
import { PainelTotais } from './painel-totais';
import { SalvamentoContext } from './salvamento-contexto';
import { useSalvamento } from './use-salvamento';

type Props = { plano: PlanoDoCliente; contexto: ContextoPaciente | null; somenteLeitura?: boolean; acoes?: ReactNode; /** US-054: receitas publicadas para sugerir. */ receitas?: ReceitaParaPlano[] };

const novoId = () => crypto.randomUUID(); // D8: gerado no evento, nunca no render
/** Somente leitura: versão publicada ou arquivada, ou rascunho de paciente bloqueado. */
const ROTULO_STATUS = { rascunho: 'Rascunho', publicado: 'Publicado', arquivado: 'Arquivado' } as const;

/**
 * Remonta o editor (geração nova na `key`) só quando a conferência ao abrir achou o servidor adiante da página e os
 * dados recarregados (`router.refresh()`) chegaram: o estado local nasce de novo do plano atual. Outra renderização
 * da página com revisão nova (ex.: a action de "Salvar como modelo" revalida e a página vem com a revisão que este
 * editor mesmo gravou) não remonta: o editor continua com o que está na tela, a revisão dele já é a do servidor.
 */
export function EditorPlano(props: Props) {
  const router = useRouter();
  const [geracao, setGeracao] = useState(0);
  const [esperada, setEsperada] = useState<number | null>(null); // revisão do servidor que a página ainda não trouxe
  if (esperada !== null && props.plano.revisao >= esperada) {
    setEsperada(null);
    setGeracao((g) => g + 1);
  }
  const aoDesatualizar = useCallback(
    (revisao: number) => {
      setEsperada(revisao);
      router.refresh();
    },
    [router],
  );
  return <Editor key={geracao} {...props} aoDesatualizar={aoDesatualizar} />;
}

function Editor({ plano, contexto, somenteLeitura = false, acoes, receitas = [], aoDesatualizar }: Props & { aoDesatualizar: (revisao: number) => void }) {
  // `edicoes` conta as ações: é o que dispara o salvamento (D7). Contador dentro do estado do reducer, que segue puro.
  const [{ estado, edicoes }, despachar] = useReducer(
    (s: { estado: EstadoEditor; edicoes: number }, a: Acao) => {
      const novo = reduzir(s.estado, a);
      return novo === s.estado ? s : { estado: novo, edicoes: s.edicoes + 1 }; // ação recusada (limite do plano) não é edição
    },
    plano,
    (p) => ({ estado: estadoInicial(p), edicoes: 0 }),
  );
  // somente leitura não grava, então a revisão não muda: nada a conferir
  const salvamento = useSalvamento(plano.id, plano.revisao, (rev) => paraEnvio(estado, rev), somenteLeitura ? 0 : edicoes, somenteLeitura ? null : { paciente: plano.patientId, aoDesatualizar });
  const total = useMemo(() => totalDoDia(refeicoesParaCalculo(estado)), [estado]);
  const meta = (() => {
    const n = lerDecimal(estado.metaTexto);
    return n === null || Number.isNaN(n) ? null : n;
  })();
  const erro = (chave: string) => salvamento.erros[chave];
  const comPaciente = plano.patientId !== null;
  const avisos = errosSemCampo(estado, salvamento.erros);
  const podeRefeicao = podeAdicionarRefeicao(estado);
  const podeItem = podeAdicionarItem(estado);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className={`text-sm ${salvamento.status === 'salvo' ? 'text-suave' : 'font-semibold text-aviso'}`}>
          {somenteLeitura ? `Versão ${plano.versao} · ${ROTULO_STATUS[plano.status]}` : salvamento.mensagem}
          {salvamento.status === 'parado' && (
            <button type="button" onClick={() => window.location.reload()} className="ml-2 underline">Recarregar</button>
          )}
        </p>
        <SalvamentoContext value={salvamento.status}>{acoes}</SalvamentoContext>
      </div>
      {avisos.map((m) => (
        <p key={m} role="alert" className="text-sm text-erro">{m}</p>
      ))}

      <fieldset disabled={somenteLeitura} className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="titulo" className="block font-medium">Título</label>
          <input id="titulo" value={estado.titulo} onChange={(e) => despachar({ tipo: 'titulo', valor: e.target.value })} aria-invalid={erro('titulo') ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          {erro('titulo') && <p role="alert" className="text-sm text-erro">{erro('titulo')}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="meta" className="block font-medium">Meta (kcal)</label>
          <input id="meta" inputMode="numeric" value={estado.metaTexto} onChange={(e) => despachar({ tipo: 'meta', valor: e.target.value })} aria-invalid={erro('metaKcal') ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          {erro('metaKcal') && <p role="alert" className="text-sm text-erro">{erro('metaKcal')}</p>}
        </div>
        {comPaciente && contexto && contexto.calculos.length > 0 && (
          <div className="space-y-1 sm:col-span-3">
            <label htmlFor="calculo" className="block font-medium">Usar como meta do plano</label>
            <select
              id="calculo"
              value={estado.energyCalcId ?? ''}
              onChange={(e) => {
                const c = contexto.calculos.find((x) => x.id === e.target.value);
                if (c) despachar({ tipo: 'usarCalculo', id: c.id, kcal: c.kcal });
              }}
              className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
            >
              <option value="">Escolha um cálculo de gasto energético…</option>
              {contexto.calculos.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
            </select>
          </div>
        )}
        {comPaciente && (
          <label className="flex items-center gap-2 sm:col-span-3">
            <input type="checkbox" checked={estado.mostrarCalorias} onChange={(e) => despachar({ tipo: 'mostrarCalorias', valor: e.target.checked })} />
            Mostrar calorias ao paciente
          </label>
        )}
      </fieldset>

      <PainelTotais total={total} meta={meta} pesoKg={contexto?.pesoKg ?? null} mostrarGkg={comPaciente} />

      {estado.refeicoes.map((r, k) => (
        <Refeicao key={r.id} r={r} k={k} despachar={despachar} somenteLeitura={somenteLeitura} erro={erro} podeAdicionarItem={podeItem} receitas={receitas} />
      ))}

      {!somenteLeitura && (
        <div className="space-y-1">
          <button type="button" disabled={!podeRefeicao} aria-describedby={podeRefeicao ? undefined : 'limite-refeicoes'} onClick={() => despachar({ tipo: 'novaRefeicao', id: novoId() })} className="rounded-full border border-campo bg-cartao px-4 py-2 text-texto disabled:opacity-50">Adicionar refeição</button>
          {!podeRefeicao && <p id="limite-refeicoes" className="text-sm text-suave">{MSG_PLANO.limite}</p>}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="orientacoes" className="block font-medium">Orientações gerais</label>
        <textarea id="orientacoes" rows={4} maxLength={MAX_TEXTO} disabled={somenteLeitura} value={estado.orientacoes} onChange={(e) => despachar({ tipo: 'orientacoes', valor: e.target.value })} aria-invalid={erro('orientacoes') ? true : undefined} aria-describedby={erro('orientacoes') ? 'orientacoes-erro' : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {erro('orientacoes') && <p id="orientacoes-erro" role="alert" className="text-sm text-erro">{erro('orientacoes')}</p>}
      </div>
    </div>
  );
}

function Refeicao({ r, k, despachar, somenteLeitura, erro, podeAdicionarItem, receitas }: {
  r: RefeicaoEstado;
  k: number;
  despachar: (a: Acao) => void;
  somenteLeitura: boolean;
  erro: (c: string) => string | undefined;
  podeAdicionarItem: boolean;
  receitas: ReceitaParaPlano[];
}) {
  const totalRefeicao = totalDosItens(r.itens.map((i) => ({ id: i.id, quantidadeG: gramasDoItem(i), porCem: i.porCem, substituiItemId: i.substituiItemId })));
  const chave = `refeicao:${r.id}`;
  return (
    <section aria-labelledby={`${r.id}-titulo`} className="space-y-3 rounded-2xl border border-borda bg-cartao p-3">
      <h2 id={`${r.id}-titulo`} className="sr-only">{r.nome || `Refeição ${k + 1}`}</h2>
      <fieldset disabled={somenteLeitura} className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${r.id}-nome`} className="block font-medium">Refeição</label>
          <input id={`${r.id}-nome`} value={r.nome} onChange={(e) => despachar({ tipo: 'refeicao', id: r.id, campo: 'nome', valor: e.target.value })} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          {erro(`${chave}:nome`) && <p role="alert" className="text-sm text-erro">{erro(`${chave}:nome`)}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${r.id}-horario`} className="block font-medium">Horário de {r.nome || 'refeição'}</label>
          <input id={`${r.id}-horario`} type="time" value={r.horario} onChange={(e) => despachar({ tipo: 'refeicao', id: r.id, campo: 'horario', valor: e.target.value })} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          {erro(`${chave}:horario`) && <p role="alert" className="text-sm text-erro">{erro(`${chave}:horario`)}</p>}
        </div>
        <p className="self-end text-sm">Total: {kcalTexto(totalRefeicao.kcal)} kcal</p>
        <div className="space-y-1 sm:col-span-4">
          <label htmlFor={`${r.id}-receita`} className="block font-medium">{`Sugestão de receita em ${r.nome || 'refeição'}`}</label>
          <select
            id={`${r.id}-receita`}
            value={r.receita?.id ?? ''}
            onChange={(e) => {
              const x = receitas.find((y) => y.id === e.target.value);
              despachar({ tipo: 'receita', id: r.id, receita: x ? { id: x.id, titulo: x.titulo } : null });
            }}
            aria-invalid={erro(`${chave}:receita`) ? true : undefined}
            aria-describedby={erro(`${chave}:receita`) ? `${r.id}-receita-erro` : r.receita && !r.receita.disponivel ? `${r.id}-receita-aviso` : undefined}
            className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
          >
            <option value="">Nenhuma</option>
            {r.receita && !r.receita.disponivel && <option value={r.receita.id}>{r.receita.titulo || MSG_RECEITA.indisponivel}</option>}
            {receitas.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
          </select>
          {r.receita && !r.receita.disponivel && <p id={`${r.id}-receita-aviso`} className="text-sm font-semibold text-aviso">{MSG_RECEITA.indisponivel}</p>}
          {erro(`${chave}:receita`) && <p id={`${r.id}-receita-erro`} role="alert" className="text-sm text-erro">{erro(`${chave}:receita`)}</p>}
        </div>
      </fieldset>

      <ul className="space-y-2">
        {r.itens.map((i) => (
          <ItemLinha key={i.id} i={i} refeicaoId={r.id} principal={r.itens.find((x) => x.id === i.substituiItemId) ?? null} despachar={despachar} somenteLeitura={somenteLeitura} erro={erro} podeAdicionarItem={podeAdicionarItem} limiteId={`${r.id}-limite`} />
        ))}
      </ul>

      {!somenteLeitura &&
        (podeAdicionarItem ? (
          <BuscaAlimento rotulo={`Adicionar alimento em ${r.nome || 'refeição'}`} aoEscolher={(a) => despachar({ tipo: 'adicionarItem', refeicaoId: r.id, id: novoId(), alimento: a })} />
        ) : (
          <p id={`${r.id}-limite`} className="text-sm text-suave">{MSG_PLANO.limite}</p>
        ))}

      <div className="space-y-1">
        <label htmlFor={`${r.id}-obs`} className="block font-medium">Observação</label>
        <textarea id={`${r.id}-obs`} rows={2} maxLength={MAX_TEXTO} disabled={somenteLeitura} value={r.observacao} onChange={(e) => despachar({ tipo: 'refeicao', id: r.id, campo: 'observacao', valor: e.target.value })} aria-invalid={erro(`${chave}:observacao`) ? true : undefined} aria-describedby={erro(`${chave}:observacao`) ? `${r.id}-obs-erro` : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {erro(`${chave}:observacao`) && <p id={`${r.id}-obs-erro`} role="alert" className="text-sm text-erro">{erro(`${chave}:observacao`)}</p>}
      </div>
      {!somenteLeitura && (
        <button type="button" onClick={() => { if (window.confirm(`Remover ${r.nome || 'esta refeição'}?`)) despachar({ tipo: 'removerRefeicao', id: r.id }); }} className="text-sm underline">
          Remover refeição
        </button>
      )}
    </section>
  );
}

type ItemLinhaProps = {
  i: ItemEstado;
  refeicaoId: string;
  principal: ItemEstado | null;
  despachar: (a: Acao) => void;
  somenteLeitura: boolean;
  erro: (c: string) => string | undefined;
  podeAdicionarItem: boolean;
  /** Id do aviso de limite da refeição: o botão de substituição desabilitado aponta para ele. */
  limiteId: string;
};

function ItemLinha({ i, refeicaoId, principal, despachar, somenteLeitura, erro, podeAdicionarItem, limiteId }: ItemLinhaProps) {
  const [substituindo, setSubstituindo] = useState(false);
  const g = gramasDoItem(i);
  const n = g === null ? null : nutrientesDoItem(i.porCem, g);
  const gp = principal ? gramasDoItem(principal) : null;
  const np = principal && gp !== null ? nutrientesDoItem(principal.porCem, gp) : null;
  const dif = n && np ? diferencaKcalDoItem(n, np) : null; // sem kcal na TACO de um dos lados: nenhuma, como no PDF
  const errQ = erro(`item:${i.id}:quantidadeG`) ?? erro(`item:${i.id}:medida`) ?? (g === null ? MSG_PLANO.quantidade : undefined);
  const q = lerDecimal(i.qtdTexto);
  return (
    <li className={`flex flex-wrap items-end gap-3 ${principal ? 'ml-6 border-l-2 pl-3' : ''}`}>
      <div className="min-w-48 flex-1">
        <p className="font-medium">{principal && <span className="text-sm text-suave">ou </span>}{i.nome} <Selo origem={i.origem} /></p>
        {i.medidas.length === 0 && !somenteLeitura && (
          <Link href={`/painel/alimentos/${i.foodId}`} target="_blank" className="text-sm underline">Cadastrar medida caseira</Link>
        )}
      </div>
      <fieldset disabled={somenteLeitura} className="flex flex-wrap items-end gap-2">
        {/* com a medida gravada fora da lista (medida própria excluída), o select aparece mesmo sem outras medidas */}
        {(i.medidas.length > 0 || (i.medida && !somenteLeitura)) && (
          <div className="space-y-1">
            <label htmlFor={`${i.id}-medida`} className="block text-sm">Medida de {i.nome}</label>
            <select
              id={`${i.id}-medida`}
              value={opcaoDaMedida(i)}
              onChange={(e) => despachar({ tipo: 'medida', itemId: i.id, medida: medidaDaOpcao(i, e.target.value) })}
              className="rounded-xl border border-campo bg-cartao p-2 text-texto"
            >
              <option value="">gramas</option>
              {opcoesDeMedida(i).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </div>
        )}
        {i.medida ? (
          <div className="space-y-1">
            <label htmlFor={`${i.id}-qtd`} className="block text-sm">Quantidade de {i.nome}</label>
            <input id={`${i.id}-qtd`} inputMode="decimal" value={i.qtdTexto} onChange={(e) => despachar({ tipo: 'qtdMedida', itemId: i.id, valor: e.target.value })} aria-invalid={errQ ? true : undefined} aria-describedby={errQ ? `${i.id}-erro` : undefined} className="w-20 rounded-xl border border-campo bg-cartao p-2 text-texto" />
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor={`${i.id}-g`} className="block text-sm">Gramas de {i.nome}</label>
            <input id={`${i.id}-g`} inputMode="decimal" value={i.quantidadeTexto} onChange={(e) => despachar({ tipo: 'quantidade', itemId: i.id, valor: e.target.value })} aria-invalid={errQ ? true : undefined} aria-describedby={errQ ? `${i.id}-erro` : undefined} className="w-24 rounded-xl border border-campo bg-cartao p-2 text-texto" />
          </div>
        )}
      </fieldset>
      <p className="text-sm" data-testid={`kcal-${i.id}`}>
        {i.medida && q !== null && Number.isFinite(q) && q > 0 && g !== null && <span>{textoMedida(q, i.medida)} · {formatarDecimal(g, casasDecimais(g))} g · </span>}
        {n === null ? '—' : n.semValor.includes('kcal') ? MSG_PLANO.semValor : `${kcalTexto(n.kcal)} kcal`}
        {dif && <span className="text-suave"> ({dif})</span>}
      </p>
      {errQ && <p id={`${i.id}-erro`} role="alert" className="w-full text-sm text-erro">{errQ}</p>}
      {erro(`item:${i.id}:foodId`) && <p role="alert" className="w-full text-sm text-erro">{erro(`item:${i.id}:foodId`)}</p>}
      {!somenteLeitura && (
        <div className="flex gap-2 text-sm">
          <button type="button" aria-label={`Subir ${i.nome}`} onClick={() => despachar({ tipo: 'moverItem', itemId: i.id, direcao: -1 })}>↑</button>
          <button type="button" aria-label={`Descer ${i.nome}`} onClick={() => despachar({ tipo: 'moverItem', itemId: i.id, direcao: 1 })}>↓</button>
          <button type="button" className="text-link underline" onClick={() => despachar({ tipo: 'removerItem', itemId: i.id })}>Remover {i.nome}</button>
        </div>
      )}
      {!somenteLeitura && i.substituiItemId === null && (
        <div className="w-full space-y-1">
          <button
            type="button"
            className="text-sm underline disabled:opacity-50"
            aria-expanded={substituindo && podeAdicionarItem}
            disabled={!podeAdicionarItem}
            aria-describedby={podeAdicionarItem ? undefined : limiteId}
            onClick={() => setSubstituindo((v) => !v)}
          >
            Adicionar substituição para {i.nome}
          </button>
          {substituindo && podeAdicionarItem && (
            <BuscaAlimento
              rotulo={`Substituição para ${i.nome}`}
              aoEscolher={(a) => {
                despachar({ tipo: 'adicionarItem', refeicaoId, id: novoId(), alimento: a, substituiItemId: i.id });
                setSubstituindo(false);
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}
