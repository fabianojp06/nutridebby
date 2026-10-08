'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import { CATEGORIAS, MODOS_PREPARO, MSG_PRESCRICAO, TIPOS_ITEM, UNIDADES, VIAS, type ConteudoReceita } from '@/modules/documentos/prescricao';
import { prepararAction, salvarRascunhoAction, type EstadoForm } from '../actions';
import { MotivoRetificacao } from './motivo-retificacao';
import { Preparar } from './preparar';

type TipoItem = keyof typeof TIPOS_ITEM;
type Componente = { nome: string; quantidade: string; unidade: string };
type ItemForm = Record<string, string | boolean | Componente[]> & { tipo: TipoItem };
type Estado = EstadoForm & { intencao?: 'salvar' | 'preparar' };
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

/**
 * US-142 + US-143: o editor e o preparo são UM formulário (revisão da T6). "Preparar para assinatura" manda o que está na
 * tela (a ação grava e prepara), e os erros dos dois botões voltam aos campos. Tudo controlado: o React 19 reseta campos
 * não controlados depois de cada action, e a justificativa e a declaração voltariam ao valor salvo depois de um erro.
 */
export function ReceitaForm({ patientId, docId, conteudo, justificativa: justificativaSalva, habilitada, declaracao, motivo = null }: { patientId: string; docId: string; conteudo: ConteudoReceita; justificativa: string; habilitada: boolean; declaracao: string; motivo?: string | null }) {
  const [s, action, pendente] = useActionState<Estado, FormData>(async (prev, f) => {
    // o botão que enviou vem no FormData (submitter); Enter num campo envia pelo primeiro, "Salvar rascunho"
    const intencao = f.get('intencao') === 'preparar' ? 'preparar' : 'salvar';
    return { ...(await (intencao === 'preparar' ? prepararAction : salvarRascunhoAction)(patientId, docId, prev, f)), intencao };
  }, {});
  const [itens, setItens] = useState<ItemForm[]>(() => doConteudo(conteudo));
  const [orientacoes, setOrientacoes] = useState(conteudo.orientacoes);
  const [justificativa, setJustificativa] = useState(justificativaSalva);
  const [declarada, setDeclarada] = useState(false);
  // Q13-1 ★: null = não é retificação (o campo não aparece nem vai no formulário)
  const [motivoRet, setMotivoRet] = useState(motivo ?? '');
  const [tipoNovo, setTipoNovo] = useState<TipoItem>('suplemento');
  const e = s.erros ?? {};
  const mudar = (i: number, chave: string, v: unknown) => setItens((xs) => xs.map((x, j) => (j === i ? { ...x, [chave]: v as string } : x)));
  const idDe = (k: string) => k.replace(/\./g, '-');
  /** Cada chave de erro que um campo mostra; as que sobrarem vão para o aviso geral (nenhum erro some em silêncio). */
  const mostradas = new Set<string>(['geral']);
  const erroDe = (k: string) => {
    mostradas.add(k);
    return e[k];
  };
  /** RNF-10: o controle com erro leva aria-invalid e aponta para a mensagem (`<id>-erro`). */
  const aria = (k: string, dica?: string) => {
    const descr = [dica, erroDe(k) ? `${idDe(k)}-erro` : undefined].filter(Boolean).join(' ');
    return { 'aria-invalid': erroDe(k) ? (true as const) : undefined, 'aria-describedby': descr || undefined };
  };
  const msg = (k: string, className = 'text-sm text-erro') => erroDe(k) && <p id={`${idDe(k)}-erro`} role="alert" className={className}>{erroDe(k)}</p>;
  const campo = (i: number, c: CampoTexto, it: ItemForm) => {
    const k = `itens.${i}.${c.chave}`;
    const Tag = c.area ? 'textarea' : 'input';
    return (
      <div key={c.chave} className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{`${c.rotulo}${c.obrigatorio ? '' : ' (opcional)'}`}</label>
        <Tag id={idDe(k)} maxLength={c.max} value={String(it[c.chave] ?? '')} onChange={(ev) => mudar(i, c.chave, ev.target.value)} {...aria(k)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {msg(k)}
      </div>
    );
  };
  const selecao = (i: number, chave: string, rotulo: string, opcoes: Record<string, string>, it: ItemForm) => {
    const k = `itens.${i}.${chave}`;
    return (
      <div className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{rotulo}</label>
        <select id={idDe(k)} value={String(it[chave] ?? '')} onChange={(ev) => mudar(i, chave, ev.target.value)} {...aria(k)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
          {Object.entries(opcoes).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        {msg(k)}
      </div>
    );
  };
  // o editor primeiro: as chaves que ele mostra ficam em `mostradas` antes de calcular as que sobraram
  const editor = (
    <>
      {motivo !== null && <MotivoRetificacao valor={motivoRet} aoMudar={setMotivoRet} erro={erroDe('motivoRetificacao')} />}
      <h3 className="font-semibold">Itens da receita</h3>
      {msg('itens', 'text-erro')}
      {itens.map((it, i) => {
        const composicao = it.composicao as Componente[];
        return (
          <fieldset key={i} className="space-y-3 rounded-2xl border border-borda p-4">
            <legend className="px-1 font-semibold">{`Item ${i + 1}: ${TIPOS_ITEM[it.tipo]}`}</legend>
            {msg(`itens.${i}.tipo`)}
            {it.tipo === 'suplemento' && (
              <>
                {selecao(i, 'categoria', 'Categoria', CATEGORIAS, it)}
                {/* Minor 11 da revisão de normas: extrato vegetal não entra como "Outro" (art. 12, I, da Res. 680) */}
                {it.categoria === 'outro' && <p className="text-sm text-suave">{MSG_PRESCRICAO.dicaOutro}</p>}
                {/* só aria-describedby: aria-invalid não vale num grupo (fieldset) */}
                <fieldset id={idDe(`itens.${i}.composicao`)} className="space-y-2" aria-describedby={erroDe(`itens.${i}.composicao`) ? `${idDe(`itens.${i}.composicao`)}-erro` : undefined}>
                  <legend className="font-medium">Composição</legend>
                  {/* "Informe de 1 a 10 componentes." (revisão da T6: antes, nenhum campo mostrava esta chave) */}
                  {msg(`itens.${i}.composicao`)}
                  {composicao.map((k, j) => {
                    const base = `itens.${i}.composicao.${j}`;
                    const set = (campoK: keyof Componente, v: string) => mudar(i, 'composicao', composicao.map((x, m) => (m === j ? { ...x, [campoK]: v } : x)));
                    return (
                      <div key={j} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                        <div><label htmlFor={idDe(`${base}.nome`)} className="block text-sm">{`Componente ${j + 1}`}</label><input id={idDe(`${base}.nome`)} value={k.nome} maxLength={120} onChange={(ev) => set('nome', ev.target.value)} {...aria(`${base}.nome`)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" /></div>
                        <div><label htmlFor={idDe(`${base}.quantidade`)} className="block text-sm">Quantidade</label><input id={idDe(`${base}.quantidade`)} inputMode="decimal" value={k.quantidade} onChange={(ev) => set('quantidade', ev.target.value)} {...aria(`${base}.quantidade`)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" /></div>
                        <div><label htmlFor={idDe(`${base}.unidade`)} className="block text-sm">Unidade</label><select id={idDe(`${base}.unidade`)} value={k.unidade} onChange={(ev) => set('unidade', ev.target.value)} {...aria(`${base}.unidade`)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></div>
                        {/* o suplemento tem ao menos um componente: com um só, nada a remover */}
                        {composicao.length > 1 && (
                          <button type="button" className="min-h-11 self-end underline" onClick={() => mudar(i, 'composicao', composicao.filter((_, m) => m !== j))}>{`Remover componente ${j + 1}`}</button>
                        )}
                        {[`${base}.nome`, `${base}.quantidade`, `${base}.unidade`].map((x) => erroDe(x) && <p key={x} id={`${idDe(x)}-erro`} role="alert" className="text-sm text-erro sm:col-span-4">{erroDe(x)}</p>)}
                      </div>
                    );
                  })}
                  {composicao.length < 10 && (
                    <button type="button" className="min-h-11 underline" onClick={() => mudar(i, 'composicao', [...composicao, { nome: '', quantidade: '', unidade: 'mg' }])}>Adicionar componente</button>
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
        );
      })}
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
        <textarea id="orientacoes" maxLength={2000} value={orientacoes} onChange={(ev) => setOrientacoes(ev.target.value)} {...aria('orientacoes')} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {msg('orientacoes')}
      </div>
      <div className="space-y-1">
        <label htmlFor="justificativa" className="block font-medium">Justificativa de uso</label>
        <textarea id="justificativa" name="justificativa" maxLength={2000} value={justificativa} onChange={(ev) => setJustificativa(ev.target.value)} {...aria('justificativa', 'justificativa-dica')} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <p id="justificativa-dica" className="text-sm text-suave">Fica no prontuário, não vai na receita.</p>
        {msg('justificativa')}
      </div>
    </>
  );
  const erroDeclaracao = erroDe('declaracao');
  const sobras = [...new Set(Object.keys(e).filter((k) => !mostradas.has(k)).map((k) => e[k]))];
  // o aviso geral (e as chaves sem campo) aparece junto do botão que foi usado
  const aviso: ReactNode = (e.geral || sobras.length > 0) && (
    <div role="alert" className="space-y-1 text-erro">
      {e.geral && (
        <p>
          {e.geral} {s.perfilIncompleto && <Link href="/painel/configuracoes/perfil#documentos" className="underline">Completar perfil</Link>}
        </p>
      )}
      {sobras.map((m) => <p key={m}>{m}</p>)}
    </div>
  );
  return (
    <form action={action} className="space-y-6" data-guia="editor-receita">
      <input type="hidden" name="conteudo" value={JSON.stringify({ itens, orientacoes })} />
      {editor}
      {s.intencao !== 'preparar' && aviso}
      {s.ok && s.intencao === 'salvar' && <p role="status">Rascunho salvo.</p>}
      <Botao disabled={pendente}>Salvar rascunho</Botao>
      <Preparar declaracao={declaracao} marcada={declarada} aoMarcar={setDeclarada} erro={erroDeclaracao} aviso={s.intencao === 'preparar' ? aviso : null} pendente={pendente} />
    </form>
  );
}
