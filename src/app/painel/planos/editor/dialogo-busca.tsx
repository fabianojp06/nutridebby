'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { kcalPorCemTexto, NomeDoAlimento, Selo } from '@/app/painel/alimentos/busca-alimento';
import { formatarDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import type { Equivalente, Equivalentes, PorNutriente, RespostaDaBusca } from '@/modules/alimentos/busca-avancada';
import { formatarCriterio, MSG_BUSCA, OPCOES_DO_CRITERIO, valorPorCem, type ChaveDoCriterio, type Direcao } from '@/modules/alimentos/busca-avancada-constantes';
import { MSG_FONTES, semValorNa, type Fonte } from '@/modules/alimentos/fontes';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';

export type AbaDaBusca = 'lista' | 'nutrientes' | 'equivalentes';
/** O item do plano que abriu "Equivalentes de {item}" (US-234): o escolhido entra como substituição dele. */
export type ReferenciaDaBusca = { itemId: string; nomeItem: string; foodId: string; quantidadeG: number; texto: string };
/** Para onde vai o que for adicionado (RN-242, §4.3): a refeição, e o item quando aberto pelos equivalentes. */
export type DestinoDaBusca = { refeicaoId: string; refeicao: string; referencia: ReferenciaDaBusca | null; aba: AbaDaBusca };

const ABAS: AbaDaBusca[] = ['lista', 'nutrientes', 'equivalentes'];
/** Filtro de fonte (§4.3): Todas · TACO · USDA (EUA) · Meus alimentos. A TBCA nunca aparece (RN-232). */
const FONTES_DO_FILTRO: { valor: '' | Fonte; rotulo: string }[] = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'taco', rotulo: 'TACO' },
  { valor: 'usda', rotulo: 'USDA (EUA)' },
  { valor: 'propria', rotulo: 'Meus alimentos' },
];
const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-4 text-texto hover:bg-linha disabled:opacity-50';
const contagem = (n: number) => (n === 0 ? 'Nenhum alimento encontrado.' : `${n} ${n === 1 ? 'alimento encontrado' : 'alimentos encontrados'}.`);

/**
 * Consulta com espera de digitação (250 ms). `url` nulo = nada a buscar. A resposta guarda a url que a pediu: a tela só
 * mostra a resposta da url atual (sem estado zerado dentro do efeito).
 */
function useConsulta<T>(url: string | null): { dados: T | null; erro: boolean; carregando: boolean } {
  const [resposta, setResposta] = useState<{ url: string; dados: T | null; erro: boolean } | null>(null);
  const pedido = useRef(0);
  useEffect(() => {
    const n = ++pedido.current;
    if (url === null) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as T;
        if (n === pedido.current) setResposta({ url, dados, erro: false });
      } catch {
        if (n === pedido.current) setResposta({ url, dados: null, erro: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [url]);
  const atual = resposta && resposta.url === url ? resposta : null;
  return { dados: atual?.dados ?? null, erro: atual?.erro ?? false, carregando: url !== null && atual === null };
}

const comFiltros = (base: string, params: [string, string][]) => `${base}?${new URLSearchParams(params.filter(([, v]) => v !== ''))}`;

/**
 * US-234 (§4.3, RNF-232): o diálogo "Buscar alimento" com as abas Lista, Nutrientes e Equivalentes. `<dialog>` nativo
 * (foco preso, Esc); o foco vai ao campo da aba ao abrir e volta ao botão que abriu ao fechar (o editor guarda). O diálogo
 * continua aberto depois de adicionar, para mais itens. Montado a cada abertura (`key` no editor).
 */
export function DialogoBuscaAlimento({ destino, podeAdicionar, aoAdicionar, aoFechar }: {
  destino: DestinoDaBusca;
  /** Limite do plano (400 itens, RN-249): "Adicionar" fica desabilitado com o aviso. */
  podeAdicionar: boolean;
  /** Na aba Equivalentes, `quantidadeG` é a sugerida e o item entra como substituição da referência. */
  aoAdicionar: (a: AlimentoEncontrado, opcoes?: { substituiItemId: string; quantidadeG: number }) => void;
  aoFechar: () => void;
}) {
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const campos = useRef<Partial<Record<AbaDaBusca, HTMLElement | null>>>({});
  const abasRef = useRef<Partial<Record<AbaDaBusca, HTMLButtonElement | null>>>({});
  const semReferencia = destino.referencia === null;
  const [aba, setAba] = useState<AbaDaBusca>(semReferencia && destino.aba === 'equivalentes' ? 'lista' : destino.aba);
  const [anuncio, setAnuncio] = useState('');
  const ativas = ABAS.filter((a) => a !== 'equivalentes' || !semReferencia);

  useLayoutEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
    campos.current[aba]?.focus(); // RNF-232: foco no campo de busca ao abrir
    // só ao abrir: trocar de aba leva o foco à aba (padrão das abas), não ao campo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fechar = () => dialogo.current?.close(); // o onClose avisa o editor, que devolve o foco
  const adicionar = (a: AlimentoEncontrado, opcoes?: { substituiItemId: string; quantidadeG: number }) => {
    aoAdicionar(a, opcoes);
    // a mesma frase seguida não seria lida de novo: limpa e escreve no quadro seguinte
    setAnuncio('');
    requestAnimationFrame(() => setAnuncio(MSG_BUSCA.adicionado(destino.refeicao)));
  };

  const irPara = (a: AbaDaBusca) => {
    setAba(a);
    abasRef.current[a]?.focus();
  };
  const teclaNasAbas = (e: KeyboardEvent) => {
    const k = ativas.indexOf(aba);
    const alvo = e.key === 'ArrowRight' ? ativas[(k + 1) % ativas.length] : e.key === 'ArrowLeft' ? ativas[(k - 1 + ativas.length) % ativas.length] : e.key === 'Home' ? ativas[0] : e.key === 'End' ? ativas[ativas.length - 1] : null;
    if (!alvo) return;
    e.preventDefault();
    irPara(alvo);
  };

  const limiteId = `${id}-limite`;
  const acaoAdicionar = (a: AlimentoEncontrado) => (
    <button type="button" disabled={!podeAdicionar} aria-describedby={podeAdicionar ? undefined : limiteId} aria-label={`${MSG_BUSCA.adicionar} ${a.nome} a ${destino.refeicao}`} onClick={() => adicionar(a)} className={BOTAO}>
      {MSG_BUSCA.adicionar}
    </button>
  );

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={`${id}-titulo`}
      onClose={aoFechar}
      className="m-auto max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-borda bg-cartao p-4 text-texto backdrop:bg-black/50"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${id}-titulo`} className="font-titulo text-xl font-semibold">{MSG_BUSCA.titulo}</h2>
        <button type="button" onClick={fechar} className="inline-flex min-h-11 items-center px-2 text-link underline">Fechar</button>
      </div>
      <p role="status" className="min-h-6 text-sm font-semibold text-ok">{anuncio}</p>
      {!podeAdicionar && <p id={limiteId} className="text-sm text-suave">{MSG_PLANO.limite}</p>}

      <div role="tablist" aria-labelledby={`${id}-titulo`} onKeyDown={teclaNasAbas} className="mt-2 flex flex-wrap gap-2 border-b border-borda">
        {ABAS.map((a) => {
          const desabilitada = a === 'equivalentes' && semReferencia;
          return (
            <button
              key={a}
              ref={(el) => { abasRef.current[a] = el; }}
              type="button"
              role="tab"
              id={`${id}-aba-${a}`}
              aria-selected={aba === a}
              aria-controls={`${id}-painel-${a}`}
              aria-disabled={desabilitada || undefined}
              aria-describedby={desabilitada ? `${id}-sem-item` : undefined}
              tabIndex={aba === a ? 0 : -1}
              onClick={() => { if (!desabilitada) setAba(a); }}
              className={`inline-flex min-h-11 items-center px-3 ${aba === a ? 'border-b-2 border-destaque font-semibold' : 'text-suave'} ${desabilitada ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              {MSG_BUSCA.abas[a]}
            </button>
          );
        })}
      </div>
      {semReferencia && <p id={`${id}-sem-item`} className="mt-1 text-sm text-suave">{MSG_BUSCA.semItem}</p>}

      <Painel id={id} aba="lista" ativa={aba}>
        <AbaLista id={id} campo={(el) => { campos.current.lista = el; }} acao={acaoAdicionar} />
      </Painel>
      <Painel id={id} aba="nutrientes" ativa={aba}>
        <AbaNutrientes id={id} campo={(el) => { campos.current.nutrientes = el; }} acao={acaoAdicionar} />
      </Painel>
      {destino.referencia && (
        <Painel id={id} aba="equivalentes" ativa={aba}>
          <AbaEquivalentes
            id={id}
            referencia={destino.referencia}
            campo={(el) => { campos.current.equivalentes = el; }}
            acao={(a) => (
              <button
                type="button"
                disabled={!podeAdicionar}
                aria-describedby={podeAdicionar ? undefined : limiteId}
                aria-label={`${MSG_BUSCA.comoSubstituicao}: ${a.nome} no lugar de ${destino.referencia!.nomeItem}`}
                onClick={() => adicionar(a, { substituiItemId: destino.referencia!.itemId, quantidadeG: a.quantidadeG })}
                className={BOTAO}
              >
                {MSG_BUSCA.comoSubstituicao}
              </button>
            )}
          />
        </Painel>
      )}

      <p className="mt-4 border-t border-borda pt-3">
        {/* §4.3: em outra aba; o editor salva sozinho (D7) e o alimento novo aparece na busca seguinte */}
        <a href="/painel/alimentos/novo" target="_blank" rel="noopener" className="text-link underline">
          {MSG_BUSCA.cadastrar} {MSG_BUSCA.outraAba}
        </a>
      </p>
    </dialog>
  );
}

function Painel({ id, aba, ativa, children }: { id: string; aba: AbaDaBusca; ativa: AbaDaBusca; children: ReactNode }) {
  // todos ficam montados (o que foi digitado numa aba continua lá ao voltar); o inativo fica escondido
  return (
    <div role="tabpanel" id={`${id}-painel-${aba}`} aria-labelledby={`${id}-aba-${aba}`} hidden={aba !== ativa} className="mt-3 space-y-3">
      {children}
    </div>
  );
}

function Filtros({ id, fonte, setFonte, grupo, setGrupo }: { id: string; fonte: string; setFonte: (v: string) => void; grupo?: string; setGrupo?: (v: string) => void }) {
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={`${id}-fonte`} className="block text-sm font-medium">Fonte</label>
        <select id={`${id}-fonte`} value={fonte} onChange={(e) => setFonte(e.target.value)} className={CAMPO}>
          {FONTES_DO_FILTRO.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
      </div>
      {setGrupo && (
        <div className="space-y-1">
          <label htmlFor={`${id}-grupo`} className="block text-sm font-medium">Grupo</label>
          <select id={`${id}-grupo`} value={grupo} onChange={(e) => setGrupo(e.target.value)} className={CAMPO}>
            <option value="">Todos</option>
            {GRUPOS_TACO.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function AbaLista({ id, campo, acao }: { id: string; campo: (el: HTMLInputElement | null) => void; acao: (a: AlimentoEncontrado) => ReactNode }) {
  const [termo, setTermo] = useState('');
  const [fonte, setFonte] = useState('');
  const [grupo, setGrupo] = useState('');
  const url = termo.trim().length >= 2 ? comFiltros('/api/painel/alimentos', [['q', termo], ['fonte', fonte], ['grupo', grupo]]) : null;
  const { dados, erro } = useConsulta<{ resultados: AlimentoEncontrado[] }>(url);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-q`} className="block text-sm font-medium">Nome do alimento</label>
          <input id={`${id}-q`} ref={campo} type="search" autoComplete="off" value={termo} onChange={(e) => setTermo(e.target.value)} className={CAMPO} />
        </div>
        <Filtros id={`${id}-lista`} fonte={fonte} setFonte={setFonte} grupo={grupo} setGrupo={setGrupo} />
      </div>
      <Resultados id={`${id}-lista`} erro={erro} lista={url === null ? null : (dados?.resultados ?? null)} rotulo={(a) => <NomeDoAlimento a={a} />} detalhe={kcalPorCemTexto} acao={acao} />
    </>
  );
}

function AbaNutrientes({ id, campo, acao }: { id: string; campo: (el: HTMLSelectElement | null) => void; acao: (a: AlimentoEncontrado) => ReactNode }) {
  const [chave, setChave] = useState<ChaveDoCriterio | ''>('');
  const [direcao, setDirecao] = useState<Direcao>('rico');
  const [fonte, setFonte] = useState('');
  const [grupo, setGrupo] = useState('');
  const url = chave === '' ? null : comFiltros('/api/painel/alimentos', [['nutriente', chave], ['direcao', direcao], ['fonte', fonte], ['grupo', grupo]]);
  const { dados, erro } = useConsulta<RespostaDaBusca<PorNutriente>>(url);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-nutriente`} className="block text-sm font-medium">Nutriente</label>
          <select id={`${id}-nutriente`} ref={campo} value={chave} onChange={(e) => setChave(e.target.value as ChaveDoCriterio | '')} className={CAMPO}>
            <option value="">Escolha um nutriente…</option>
            {OPCOES_DO_CRITERIO.map((o) => <option key={o.chave} value={o.chave}>{o.nome}</option>)}
          </select>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Ordem</legend>
          <div className="flex flex-wrap gap-x-4">
            {(['rico', 'pobre'] as const).map((d) => (
              <label key={d} className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name={`${id}-direcao`} checked={direcao === d} onChange={() => setDirecao(d)} />
                {d === 'rico' ? MSG_BUSCA.rico : MSG_BUSCA.pobre}
              </label>
            ))}
          </div>
        </fieldset>
        <Filtros id={`${id}-nut`} fonte={fonte} setFonte={setFonte} grupo={grupo} setGrupo={setGrupo} />
      </div>
      {dados && <Criterio texto={dados.criterio} />}
      <Resultados
        id={`${id}-nut`}
        erro={erro}
        lista={url === null ? null : (dados?.resultados ?? null)}
        vazio={MSG_BUSCA.nenhum}
        rotulo={(a) => <NomeDoAlimento a={a} />}
        detalhe={(a) => `${formatarCriterio(chave as ChaveDoCriterio, a.valor)} em 100 g`}
        acao={acao}
      />
    </>
  );
}

function AbaEquivalentes({ id, referencia, campo, acao }: { id: string; referencia: ReferenciaDaBusca; campo: (el: HTMLSelectElement | null) => void; acao: (a: Equivalente) => ReactNode }) {
  const [igualarPor, setIgualarPor] = useState<ChaveDoCriterio>('kcal');
  const [fonte, setFonte] = useState('');
  const url = comFiltros('/api/painel/alimentos/equivalentes', [['foodId', referencia.foodId], ['quantidadeG', String(referencia.quantidadeG)], ['igualarPor', igualarPor], ['fonte', fonte]]);
  const { dados, erro } = useConsulta<Equivalentes>(url);
  return (
    <>
      <p><span className="font-medium">Referência: </span>{referencia.texto}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-igualar`} className="block text-sm font-medium">{MSG_BUSCA.igualarPor}</label>
          <select id={`${id}-igualar`} ref={campo} value={igualarPor} onChange={(e) => setIgualarPor(e.target.value as ChaveDoCriterio)} className={CAMPO}>
            {OPCOES_DO_CRITERIO.map((o) => <option key={o.chave} value={o.chave}>{o.nome}</option>)}
          </select>
        </div>
        <Filtros id={`${id}-eq`} fonte={fonte} setFonte={setFonte} />
      </div>
      {dados && <Criterio texto={dados.criterio} />}
      <Resultados
        id={`${id}-eq`}
        erro={erro}
        lista={dados?.resultados ?? null}
        vazio={MSG_BUSCA.nenhum}
        rotulo={(a) => <span>{MSG_BUSCA.sugerido(a.nome, formatarDecimal(a.quantidadeG, 0))}{a.nomeOriginal && <span lang="en" className="block text-sm text-suave">{a.nomeOriginal}</span>}</span>}
        detalhe={(a) => {
          const v = valorPorCem(a, igualarPor);
          return igualarPor === 'kcal' || v === null ? kcalNaQuantidade(a) : `${formatarCriterio(igualarPor, (v * a.quantidadeG) / 100)} · ${kcalNaQuantidade(a)}`;
        }}
        acao={acao}
      />
    </>
  );
}

const kcalNaQuantidade = (a: Equivalente) => (a.porCem.kcal === null ? semValorNa(a.fonte) : `${formatarDecimal((a.porCem.kcal * a.quantidadeG) / 100, 0)} kcal`);

/** RN-241/RN-242: o critério escrito na tela e o aviso fixo. */
function Criterio({ texto }: { texto: string }) {
  return (
    <div className="space-y-0.5 text-sm">
      <p>{texto}</p>
      <p className="font-semibold text-aviso">{MSG_BUSCA.sugestao}</p>
    </div>
  );
}

function Resultados<T extends AlimentoEncontrado>({ id, erro, lista, vazio, rotulo, detalhe, acao }: {
  id: string;
  erro: boolean;
  /** null: nada pedido ainda ou carregando. */
  lista: T[] | null;
  vazio?: string;
  rotulo: (a: T) => ReactNode;
  detalhe: (a: T) => string;
  acao: (a: T) => ReactNode;
}) {
  return (
    <>
      {erro && <p role="alert" className="text-sm text-erro">Não foi possível buscar agora. Tente de novo.</p>}
      {/* RNF-232: contagem anunciada; a região fica na tela para a mudança ser lida */}
      <p role="status" className="text-sm text-suave">{lista === null ? '' : lista.length === 0 && vazio ? vazio : contagem(lista.length)}</p>
      <ul aria-label="Resultados" className="divide-y divide-linha rounded-2xl border border-borda empty:hidden">
        {(lista ?? []).map((a) => (
          <Resultado key={a.id} id={`${id}-${a.id}`} a={a} rotulo={rotulo(a)} detalhe={detalhe(a)} acao={acao(a)} />
        ))}
      </ul>
    </>
  );
}

function Resultado({ id, a, rotulo, detalhe, acao }: { id: string; a: AlimentoEncontrado; rotulo: ReactNode; detalhe: string; acao: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <li className="space-y-2 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-48 flex-1">
          {/* rótulo e detalhe em linhas próprias: dois spans seguidos saíam colados ("cozido128 kcal…") */}
          <div>{rotulo}</div>
          <div className="text-sm text-suave">{detalhe} · <Selo fonte={a.fonte} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-expanded={aberto} aria-controls={`${id}-nutrientes`} aria-label={`${MSG_BUSCA.verNutrientes} de ${a.nome}`} onClick={() => setAberto((v) => !v)} className={BOTAO}>
            {MSG_BUSCA.verNutrientes}
          </button>
          {acao}
        </div>
      </div>
      <div id={`${id}-nutrientes`} hidden={!aberto}>
        {aberto && <NutrientesEm100g a={a} />}
      </div>
    </li>
  );
}

/** US-234 "Ver nutrientes": os valores em 100 g, todos os do catálogo, sem sair do diálogo (sem valor = "Sem valor na {sigla}"). */
function NutrientesEm100g({ a }: { a: AlimentoEncontrado }) {
  return (
    <div className="rounded-xl border border-borda p-2 text-sm">
      <p className="font-medium">Valores em 100 g</p>
      {a.fonte === 'usda' && <p className="text-xs text-suave">{MSG_FONTES.traduzido}</p>}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
      {OPCOES_DO_CRITERIO.map((o) => {
        const v = valorPorCem(a, o.chave);
        return (
          <div key={o.chave} className="flex justify-between gap-2">
            <dt>{o.nome}</dt>
            <dd className={v === null ? 'text-suave' : ''}>{v === null ? semValorNa(a.fonte) : formatarCriterio(o.chave, v)}</dd>
          </div>
        );
      })}
      </dl>
    </div>
  );
}
