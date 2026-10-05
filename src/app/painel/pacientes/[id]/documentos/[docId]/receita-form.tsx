'use client';

import { useActionState, useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { CATEGORIAS, MODOS_PREPARO, MSG_PRESCRICAO, TIPOS_ITEM, UNIDADES, VIAS, type ConteudoReceita } from '@/modules/documentos/prescricao';
import { salvarRascunhoAction, type EstadoForm } from '../actions';

type TipoItem = keyof typeof TIPOS_ITEM;
type Componente = { nome: string; quantidade: string; unidade: string };
type ItemForm = Record<string, string | boolean | Componente[]> & { tipo: TipoItem };
type CampoTexto = { chave: string; rotulo: string; max: number; obrigatorio: boolean; area?: boolean };

const T = (chave: string, rotulo: string, max: number, obrigatorio = true, area = false): CampoTexto => ({ chave, rotulo, max, obrigatorio, area });
const BOTANICA = [T('nomenclatura', 'Nomenclatura botânica', 120), T('parte', 'Parte utilizada', 60)];
const FINAIS = [T('nomePopular', 'Nome popular', 60, false), T('duracao', 'Duração', 100, false)];
/** US-142: os campos de cada tipo de item (rótulos e limites da tabela da spec). */
const CAMPOS: Record<TipoItem, CampoTexto[]> = {
  suplemento: [T('forma', 'Forma de apresentação', 60), T('posologia', 'Posologia', 300, true, true), T('duracao', 'Duração', 100, false)],
  planta_cha: [...BOTANICA, T('formaUso', 'Forma de utilização e preparo', 300, true, true), T('posologia', 'Posologia', 300, true, true), ...FINAIS],
  derivado_vegetal: [...BOTANICA, T('formaFarmaceutica', 'Forma farmacêutica', 60), T('dose', 'Dose', 120), T('posologia', 'Posologia', 300, true, true), T('padronizacao', 'Padronização do marcador', 120, false), T('extracao', 'Forma ou meio de extração', 120, false), ...FINAIS],
  fitoterapico: [...BOTANICA, T('extracao', 'Forma ou meio de extração', 120), T('formaFarmaceutica', 'Forma farmacêutica', 60), T('dose', 'Dose', 120), T('posologia', 'Posologia', 300, true, true), T('padronizacao', 'Padronização do marcador', 120, false), ...FINAIS],
};
const novoItem = (tipo: TipoItem): ItemForm =>
  tipo === 'suplemento' ? { tipo, categoria: 'nutriente', composicao: [{ nome: '', quantidade: '', unidade: 'mg' }], via: 'oral', manipulado: false } : tipo === 'planta_cha' ? { tipo, modoPreparo: 'infusao' } : { tipo, via: 'oral' };

/** O conteúdo salvo vira o estado do formulário (números como texto, para a vírgula). */
function doConteudo(c: ConteudoReceita): ItemForm[] {
  return c.itens.map((it) => {
    const o: Record<string, unknown> = { ...it };
    if (it.tipo === 'suplemento') o.composicao = it.composicao.map((k) => ({ nome: k.nome, quantidade: String(k.quantidade).replace('.', ','), unidade: k.unidade }));
    return o as ItemForm;
  });
}

export function ReceitaForm({ patientId, docId, conteudo, justificativa, habilitada }: { patientId: string; docId: string; conteudo: ConteudoReceita; justificativa: string; habilitada: boolean }) {
  const [s, action, pendente] = useActionState<EstadoForm, FormData>(salvarRascunhoAction.bind(null, patientId, docId), {});
  const [itens, setItens] = useState<ItemForm[]>(() => doConteudo(conteudo));
  const [orientacoes, setOrientacoes] = useState(conteudo.orientacoes);
  const [tipoNovo, setTipoNovo] = useState<TipoItem>('suplemento');
  const e = s.erros ?? {};
  const mudar = (i: number, chave: string, v: unknown) => setItens((xs) => xs.map((x, j) => (j === i ? { ...x, [chave]: v as string } : x)));
  const erroDe = (k: string) => e[k];
  const idDe = (k: string) => k.replace(/\./g, '-');
  const campo = (i: number, c: CampoTexto, it: ItemForm) => {
    const k = `itens.${i}.${c.chave}`;
    const Tag = c.area ? 'textarea' : 'input';
    return (
      <div key={c.chave} className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{`${c.rotulo}${c.obrigatorio ? '' : ' (opcional)'}`}</label>
        <Tag id={idDe(k)} maxLength={c.max} value={String(it[c.chave] ?? '')} onChange={(ev) => mudar(i, c.chave, ev.target.value)} aria-invalid={erroDe(k) ? true : undefined} aria-describedby={erroDe(k) ? `${idDe(k)}-erro` : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {erroDe(k) && <p id={`${idDe(k)}-erro`} role="alert" className="text-sm text-erro">{erroDe(k)}</p>}
      </div>
    );
  };
  const selecao = (i: number, chave: string, rotulo: string, opcoes: Record<string, string>, it: ItemForm) => {
    const k = `itens.${i}.${chave}`;
    return (
      <div className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{rotulo}</label>
        <select id={idDe(k)} value={String(it[chave] ?? '')} onChange={(ev) => mudar(i, chave, ev.target.value)} aria-invalid={erroDe(k) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
          {Object.entries(opcoes).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        {erroDe(k) && <p role="alert" className="text-sm text-erro">{erroDe(k)}</p>}
      </div>
    );
  };
  return (
    <form action={action} className="space-y-6" data-guia="editor-receita">
      <input type="hidden" name="conteudo" value={JSON.stringify({ itens, orientacoes })} />
      <h3 className="font-semibold">Itens da receita</h3>
      {e.itens && <p role="alert" className="text-erro">{e.itens}</p>}
      {itens.map((it, i) => (
        <fieldset key={i} className="space-y-3 rounded-2xl border border-borda p-4">
          <legend className="px-1 font-semibold">{`Item ${i + 1}: ${TIPOS_ITEM[it.tipo]}`}</legend>
          {erroDe(`itens.${i}.tipo`) && <p role="alert" className="text-sm text-erro">{erroDe(`itens.${i}.tipo`)}</p>}
          {it.tipo === 'suplemento' && (
            <>
              {selecao(i, 'categoria', 'Categoria', CATEGORIAS, it)}
              {/* Minor 11 da revisão de normas: extrato vegetal não entra como "Outro" (art. 12, I, da Res. 680) */}
              {it.categoria === 'outro' && <p className="text-sm text-suave">{MSG_PRESCRICAO.dicaOutro}</p>}
              <fieldset className="space-y-2">
                <legend className="font-medium">Composição</legend>
                {(it.composicao as Componente[]).map((k, j) => {
                  const base = `itens.${i}.composicao.${j}`;
                  const set = (campoK: keyof Componente, v: string) => mudar(i, 'composicao', (it.composicao as Componente[]).map((x, m) => (m === j ? { ...x, [campoK]: v } : x)));
                  return (
                    <div key={j} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                      <div><label htmlFor={idDe(`${base}.nome`)} className="block text-sm">{`Componente ${j + 1}`}</label><input id={idDe(`${base}.nome`)} value={k.nome} maxLength={120} onChange={(ev) => set('nome', ev.target.value)} aria-invalid={erroDe(`${base}.nome`) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" /></div>
                      <div><label htmlFor={idDe(`${base}.quantidade`)} className="block text-sm">Quantidade</label><input id={idDe(`${base}.quantidade`)} inputMode="decimal" value={k.quantidade} onChange={(ev) => set('quantidade', ev.target.value)} aria-invalid={erroDe(`${base}.quantidade`) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" /></div>
                      <div><label htmlFor={idDe(`${base}.unidade`)} className="block text-sm">Unidade</label><select id={idDe(`${base}.unidade`)} value={k.unidade} onChange={(ev) => set('unidade', ev.target.value)} aria-invalid={erroDe(`${base}.unidade`) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></div>
                      <button type="button" className="min-h-11 self-end underline" onClick={() => mudar(i, 'composicao', (it.composicao as Componente[]).filter((_, m) => m !== j))}>{`Remover componente ${j + 1}`}</button>
                      {[`${base}.nome`, `${base}.quantidade`, `${base}.unidade`].map((x) => erroDe(x) && <p key={x} role="alert" className="text-sm text-erro sm:col-span-4">{erroDe(x)}</p>)}
                    </div>
                  );
                })}
                {(it.composicao as Componente[]).length < 10 && (
                  <button type="button" className="min-h-11 underline" onClick={() => mudar(i, 'composicao', [...(it.composicao as Componente[]), { nome: '', quantidade: '', unidade: 'mg' }])}>Adicionar componente</button>
                )}
              </fieldset>
            </>
          )}
          {it.tipo === 'planta_cha' && selecao(i, 'modoPreparo', 'Modo de preparo', MODOS_PREPARO, it)}
          {CAMPOS[it.tipo].map((c) => campo(i, c, it))}
          {it.tipo !== 'planta_cha' && selecao(i, 'via', 'Via', VIAS, it)}
          {it.tipo === 'suplemento' && (
            <div className="flex items-center gap-2">
              <input id={`item-${i}-manipulado`} type="checkbox" checked={it.manipulado === true} onChange={(ev) => mudar(i, 'manipulado', ev.target.checked)} className="size-5" />
              <label htmlFor={`item-${i}-manipulado`}>Manipulado</label>
            </div>
          )}
          <button type="button" className="min-h-11 underline" onClick={() => setItens((xs) => xs.filter((_, j) => j !== i))}>{`Remover item ${i + 1}`}</button>
        </fieldset>
      ))}
      {itens.length < 20 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="tipo-novo" className="block font-medium">Tipo do item</label>
            <select id="tipo-novo" value={tipoNovo} onChange={(ev) => setTipoNovo(ev.target.value as TipoItem)} aria-describedby={habilitada ? undefined : 'fito-dica'} className="rounded-xl border border-campo bg-cartao p-2 text-texto">
              {(Object.keys(TIPOS_ITEM) as TipoItem[]).map((t) => (
                <option key={t} value={t} disabled={t === 'fitoterapico' && !habilitada}>{TIPOS_ITEM[t]}</option>
              ))}
            </select>
          </div>
          <Botao type="button" variante="secundario" onClick={() => setItens((xs) => [...xs, novoItem(tipoNovo)])}>Adicionar item</Botao>
          {!habilitada && <p id="fito-dica" className="w-full text-sm text-suave">{MSG_PRESCRICAO.semHabilitacao}</p>}
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="orientacoes" className="block font-medium">Orientações gerais (opcional)</label>
        <textarea id="orientacoes" maxLength={2000} value={orientacoes} onChange={(ev) => setOrientacoes(ev.target.value)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {e.orientacoes && <p role="alert" className="text-sm text-erro">{e.orientacoes}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="justificativa" className="block font-medium">Justificativa de uso</label>
        <textarea id="justificativa" name="justificativa" maxLength={2000} defaultValue={justificativa} aria-describedby="justificativa-dica" aria-invalid={e.justificativa ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <p id="justificativa-dica" className="text-sm text-suave">Fica no prontuário, não vai na receita.</p>
        {e.justificativa && <p role="alert" className="text-sm text-erro">{e.justificativa}</p>}
      </div>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {s.ok && <p role="status">Rascunho salvo.</p>}
      <Botao disabled={pendente}>Salvar rascunho</Botao>
    </form>
  );
}
