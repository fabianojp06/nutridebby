'use client';

import { CATEGORIAS, exigeHabilitacao, MODOS_PREPARO, MSG_PRESCRICAO, TIPOS_ITEM, UNIDADES, VIAS, type ItemPrescricao } from '@/modules/documentos/prescricao';

export type TipoItem = keyof typeof TIPOS_ITEM;
type Componente = { nome: string; quantidade: string; unidade: string };
type Composto = { nomenclatura: string; parte: string; extracao: string; padronizacao: string; quantidade: string; unidade: string };
/** O item como o formulário o guarda: os números como texto (a vírgula do pt-BR), validados só no servidor (Zod do item). */
export type ItemNoFormulario = Record<string, string | boolean | Componente[] | Composto[]> & { tipo: TipoItem };
type CampoTexto = { chave: string; rotulo: string; max: number; obrigatorio: boolean; area?: boolean };

const F = MSG_PRESCRICAO.formula;
const CLASSE = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const T = (chave: string, rotulo: string, max: number, obrigatorio = true, area = false): CampoTexto => ({ chave, rotulo, max, obrigatorio, area });
const BOTANICA = [T('nomenclatura', 'Nomenclatura botânica', 120), T('parte', 'Parte utilizada', 60)];
const FINAIS = [T('nomePopular', 'Nome popular', 60, false), T('duracao', 'Duração', 100, false)];
/** US-142: os campos de texto de cada tipo de item (rótulos e limites da tabela da spec); Plano 22: a fórmula (US-378). */
const CAMPOS: Record<TipoItem, CampoTexto[]> = {
  suplemento: [T('forma', 'Forma de apresentação', 60), T('posologia', 'Posologia', 300, true, true), T('duracao', 'Duração', 100, false)],
  planta_cha: [...BOTANICA, T('formaUso', 'Forma de utilização e preparo', 300, true, true), T('posologia', 'Posologia', 300, true, true), ...FINAIS],
  derivado_vegetal: [...BOTANICA, T('formaFarmaceutica', 'Forma farmacêutica', 60), T('dose', 'Dose', 120), T('posologia', 'Posologia', 300, true, true), T('padronizacao', 'Padronização do marcador', 120, false), T('extracao', 'Forma ou meio de extração', 120, false), ...FINAIS],
  fitoterapico: [...BOTANICA, T('extracao', 'Forma ou meio de extração', 120), T('formaFarmaceutica', 'Forma farmacêutica', 60), T('dose', 'Dose', 120), T('posologia', 'Posologia', 300, true, true), T('padronizacao', 'Padronização do marcador', 120, false), ...FINAIS],
  formula_fitoterapica: [T('formaFarmaceutica', F.formaFarmaceutica, 60), T('posologia', 'Posologia', 300, true, true), T('duracao', 'Duração', 100, false)],
};
/** Os campos de cada composto da fórmula (§6.2), na ordem da tela. */
const CAMPOS_DO_COMPOSTO: { chave: keyof Composto; rotulo: string; max?: number }[] = [
  { chave: 'nomenclatura', rotulo: F.nomenclatura, max: 120 },
  { chave: 'parte', rotulo: F.parte, max: 60 },
  { chave: 'extracao', rotulo: F.extracao, max: 120 },
  { chave: 'padronizacao', rotulo: F.padronizacao, max: 120 },
  { chave: 'quantidade', rotulo: F.quantidade },
  { chave: 'unidade', rotulo: F.unidade },
];
/** Os selects de cada tipo (o chá não tem via: RN-150, só em água). */
const SELECOES: Record<TipoItem, string[]> = {
  suplemento: ['categoria', 'via'],
  planta_cha: ['modoPreparo'],
  derivado_vegetal: ['via'],
  fitoterapico: ['via'],
  formula_fitoterapica: ['via'],
};
const COMPOSTO_VAZIO: Composto = { nomenclatura: '', parte: '', extracao: '', padronizacao: '', quantidade: '', unidade: 'mg' };
const COMPONENTE_VAZIO: Componente = { nome: '', quantidade: '', unidade: 'mg' };

/** O item novo de cada tipo, com os padrões de hoje (a fórmula nasce com os 2 compostos mínimos). */
export function novoItem(tipo: TipoItem): ItemNoFormulario {
  switch (tipo) {
    case 'suplemento':
      return { tipo, categoria: 'nutriente', composicao: [{ ...COMPONENTE_VAZIO }], via: 'oral', manipulado: false };
    case 'planta_cha':
      return { tipo, modoPreparo: 'infusao' };
    case 'formula_fitoterapica':
      return { tipo, compostos: [{ ...COMPOSTO_VAZIO }, { ...COMPOSTO_VAZIO }], via: 'oral' };
    default:
      return { tipo, via: 'oral' };
  }
}

const comVirgula = (n: number) => String(n).replace('.', ',');
/** O item gravado vira o estado do formulário (números como texto, para a vírgula). */
export function doItem(it: ItemPrescricao): ItemNoFormulario {
  const o: Record<string, unknown> = { ...it };
  if (it.tipo === 'suplemento') o.composicao = it.composicao.map((k) => ({ nome: k.nome, quantidade: comVirgula(k.quantidade), unidade: k.unidade }));
  if (it.tipo === 'formula_fitoterapica') o.compostos = it.compostos.map((k) => ({ ...k, quantidade: comVirgula(k.quantidade) }));
  return o as ItemNoFormulario;
}

/** Trocar o tipo: o item novo daquele tipo, com o que os dois tipos têm em comum (posologia, nomenclatura, via…). */
function trocarTipo(atual: ItemNoFormulario, tipo: TipoItem): ItemNoFormulario {
  const novo = novoItem(tipo);
  const chaves = new Set([...CAMPOS[tipo].map((c) => c.chave), ...SELECOES[tipo]]);
  for (const [k, v] of Object.entries(atual)) if (chaves.has(k) && typeof v === 'string') novo[k] = v;
  return novo;
}

/**
 * As chaves de erro que os campos de um item mostram (com o prefixo do item: `itens.2` na receita). Quem usa o
 * `CamposDoItem` manda as que sobrarem ao aviso geral (nenhum erro some em silêncio, revisão da T6).
 */
export function chavesDoItem(it: ItemNoFormulario, prefixo: string): string[] {
  const p = (k: string) => `${prefixo}.${k}`;
  const chaves = [p('tipo'), ...CAMPOS[it.tipo].map((c) => p(c.chave)), ...SELECOES[it.tipo].map(p)];
  if (it.tipo === 'suplemento') {
    chaves.push(p('composicao'));
    (it.composicao as Componente[]).forEach((_, j) => chaves.push(...['nome', 'quantidade', 'unidade'].map((k) => p(`composicao.${j}.${k}`))));
  }
  if (it.tipo === 'formula_fitoterapica') {
    chaves.push(p('compostos'));
    (it.compostos as Composto[]).forEach((_, j) => chaves.push(...CAMPOS_DO_COMPOSTO.map((c) => p(`compostos.${j}.${c.chave}`))));
  }
  return chaves;
}

/**
 * Plano 22 (T9, R22-10, US-142, US-378): os campos de UM item da receita — o seletor do tipo (os cinco tipos; a ajuda da
 * §6.2 sob ele por `aria-describedby`; o fitoterápico e a fórmula desabilitados sem a habilitação, com `semHabilitacao`)
 * e os campos do tipo, inclusive a lista de compostos da fórmula com "Acrescentar composto". Extraído de
 * `receita-form.tsx` para a T10b reaproveitar no item salvo (sem cópia do formulário). Controlado: cada mudança devolve o
 * item inteiro por `aoMudar`. Os erros vêm com as chaves do Zod e o `prefixo` (padrão `itens.<indice>`); cada controle
 * com erro leva `aria-invalid` e aponta para a mensagem (`<id>-erro`, RNF-10).
 */
export function CamposDoItem({ item, indice, habilitada, aoMudar, erros = {}, prefixo = `itens.${indice}` }: {
  item: ItemNoFormulario;
  indice: number;
  habilitada: boolean;
  aoMudar: (item: ItemNoFormulario) => void;
  erros?: Record<string, string>;
  prefixo?: string;
}) {
  const it = item;
  const idDe = (k: string) => k.replace(/\./g, '-');
  const chave = (k: string) => `${prefixo}.${k}`;
  const mudar = (k: string, v: unknown) => aoMudar({ ...it, [k]: v as string });
  const aria = (k: string, ...dicas: (string | null)[]) => {
    const descr = [...dicas, erros[k] ? `${idDe(k)}-erro` : null].filter(Boolean).join(' ');
    return { 'aria-invalid': erros[k] ? (true as const) : undefined, 'aria-describedby': descr || undefined };
  };
  const msg = (k: string, className = 'text-sm text-erro') => erros[k] && <p id={`${idDe(k)}-erro`} role="alert" className={className}>{erros[k]}</p>;
  const campo = (c: CampoTexto) => {
    const k = chave(c.chave);
    const Tag = c.area ? 'textarea' : 'input';
    return (
      <div key={c.chave} className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{`${c.rotulo}${c.obrigatorio ? '' : ' (opcional)'}`}</label>
        <Tag id={idDe(k)} maxLength={c.max} value={String(it[c.chave] ?? '')} onChange={(ev) => mudar(c.chave, ev.target.value)} {...aria(k)} className={CLASSE} />
        {msg(k)}
      </div>
    );
  };
  const selecao = (k0: string, rotulo: string, opcoes: Record<string, string>) => {
    const k = chave(k0);
    return (
      <div className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{rotulo}</label>
        <select id={idDe(k)} value={String(it[k0] ?? '')} onChange={(ev) => mudar(k0, ev.target.value)} {...aria(k)} className={CLASSE}>
          {Object.entries(opcoes).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        {msg(k)}
      </div>
    );
  };
  /** Um grupo (fieldset) com o erro da lista: só aria-describedby (aria-invalid não vale num grupo). */
  const grupo = (k: string) => ({ id: idDe(k), 'aria-describedby': erros[k] ? `${idDe(k)}-erro` : undefined });

  const kTipo = chave('tipo');
  const idTipo = idDe(kTipo);
  const tipo = (
    <div className="space-y-1">
      <label htmlFor={idTipo} className="block font-medium">Tipo do item</label>
      <select id={idTipo} value={it.tipo} onChange={(ev) => aoMudar(trocarTipo(it, ev.target.value as TipoItem))} {...aria(kTipo, `${idTipo}-ajuda`, habilitada ? null : `${idTipo}-sem-habilitacao`)} className={CLASSE}>
        {(Object.keys(TIPOS_ITEM) as TipoItem[]).map((t) => (
          <option key={t} value={t} disabled={exigeHabilitacao(t) && !habilitada}>{TIPOS_ITEM[t]}</option>
        ))}
      </select>
      <p id={`${idTipo}-ajuda`} className="text-sm text-suave">{MSG_PRESCRICAO.ajudaTipo}</p>
      {!habilitada && <p id={`${idTipo}-sem-habilitacao`} className="text-sm text-suave">{MSG_PRESCRICAO.semHabilitacao}</p>}
      {msg(kTipo)}
    </div>
  );

  const composicao = it.tipo === 'suplemento' ? (it.composicao as Componente[]) : [];
  const compostos = it.tipo === 'formula_fitoterapica' ? (it.compostos as Composto[]) : [];
  return (
    <>
      {tipo}
      {it.tipo === 'suplemento' && (
        <>
          {selecao('categoria', 'Categoria', CATEGORIAS)}
          {/* Minor 11 da revisão de normas: extrato vegetal não entra como "Outro" (art. 12, I, da Res. 680) */}
          {it.categoria === 'outro' && <p className="text-sm text-suave">{MSG_PRESCRICAO.dicaOutro}</p>}
          <fieldset className="space-y-2" {...grupo(chave('composicao'))}>
            <legend className="font-medium">Composição</legend>
            {/* "Informe de 1 a 10 componentes." (revisão da T6: antes, nenhum campo mostrava esta chave) */}
            {msg(chave('composicao'))}
            {composicao.map((k, j) => {
              const base = chave(`composicao.${j}`);
              const set = (campoK: keyof Componente, v: string) => mudar('composicao', composicao.map((x, m) => (m === j ? { ...x, [campoK]: v } : x)));
              return (
                <div key={j} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <div><label htmlFor={idDe(`${base}.nome`)} className="block text-sm">{`Componente ${j + 1}`}</label><input id={idDe(`${base}.nome`)} value={k.nome} maxLength={120} onChange={(ev) => set('nome', ev.target.value)} {...aria(`${base}.nome`)} className={CLASSE} /></div>
                  <div><label htmlFor={idDe(`${base}.quantidade`)} className="block text-sm">Quantidade</label><input id={idDe(`${base}.quantidade`)} inputMode="decimal" value={k.quantidade} onChange={(ev) => set('quantidade', ev.target.value)} {...aria(`${base}.quantidade`)} className={CLASSE} /></div>
                  <div><label htmlFor={idDe(`${base}.unidade`)} className="block text-sm">Unidade</label><select id={idDe(`${base}.unidade`)} value={k.unidade} onChange={(ev) => set('unidade', ev.target.value)} {...aria(`${base}.unidade`)} className={CLASSE}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></div>
                  {/* o suplemento tem ao menos um componente: com um só, nada a remover */}
                  {composicao.length > 1 && (
                    <button type="button" className="min-h-11 self-end underline" onClick={() => mudar('composicao', composicao.filter((_, m) => m !== j))}>{`Remover componente ${j + 1}`}</button>
                  )}
                  {[`${base}.nome`, `${base}.quantidade`, `${base}.unidade`].map((x) => erros[x] && <p key={x} id={`${idDe(x)}-erro`} role="alert" className="text-sm text-erro sm:col-span-4">{erros[x]}</p>)}
                </div>
              );
            })}
            {composicao.length < 10 && (
              <button type="button" className="min-h-11 underline" onClick={() => mudar('composicao', [...composicao, { ...COMPONENTE_VAZIO }])}>Adicionar componente</button>
            )}
          </fieldset>
        </>
      )}
      {it.tipo === 'formula_fitoterapica' && (
        <fieldset className="space-y-3" {...grupo(chave('compostos'))}>
          <legend className="font-medium">{F.compostos}</legend>
          {/* "Informe de 2 a 10 compostos vegetais." (RN-392) */}
          {msg(chave('compostos'))}
          {compostos.map((k, j) => {
            const base = chave(`compostos.${j}`);
            const set = (campoK: keyof Composto, v: string) => mudar('compostos', compostos.map((x, m) => (m === j ? { ...x, [campoK]: v } : x)));
            return (
              <fieldset key={j} className="space-y-2 rounded-xl border border-borda p-3">
                <legend className="px-1 text-sm font-semibold">{F.composto(j + 1)}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CAMPOS_DO_COMPOSTO.map((c) => {
                    const k2 = `${base}.${c.chave}`;
                    return (
                      <div key={c.chave} className="space-y-1">
                        <label htmlFor={idDe(k2)} className="block text-sm">{c.rotulo}</label>
                        {c.chave === 'unidade' ? (
                          <select id={idDe(k2)} value={k.unidade} onChange={(ev) => set('unidade', ev.target.value)} {...aria(k2)} className={CLASSE}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select>
                        ) : (
                          <input id={idDe(k2)} value={k[c.chave]} maxLength={c.max} inputMode={c.chave === 'quantidade' ? 'decimal' : undefined} onChange={(ev) => set(c.chave, ev.target.value)} {...aria(k2)} className={CLASSE} />
                        )}
                        {msg(k2)}
                      </div>
                    );
                  })}
                </div>
                {/* a fórmula tem ao menos 2 compostos (RN-392): com 2, nada a remover */}
                {compostos.length > 2 && (
                  <button type="button" className="min-h-11 underline" onClick={() => mudar('compostos', compostos.filter((_, m) => m !== j))}>{F.remover(j + 1)}</button>
                )}
              </fieldset>
            );
          })}
          {compostos.length < 10 && (
            <button type="button" className="min-h-11 underline" onClick={() => mudar('compostos', [...compostos, { ...COMPOSTO_VAZIO }])}>{F.acrescentar}</button>
          )}
        </fieldset>
      )}
      {it.tipo === 'planta_cha' && selecao('modoPreparo', 'Modo de preparo', MODOS_PREPARO)}
      {CAMPOS[it.tipo].map((c) => campo(c))}
      {SELECOES[it.tipo].includes('via') && selecao('via', 'Via', VIAS)}
      {it.tipo === 'suplemento' && (
        <div className="flex items-center gap-2">
          <input id={`${idDe(prefixo)}-manipulado`} type="checkbox" checked={it.manipulado === true} onChange={(ev) => mudar('manipulado', ev.target.checked)} className="size-5" />
          <label htmlFor={`${idDe(prefixo)}-manipulado`}>Manipulado</label>
        </div>
      )}
    </>
  );
}
