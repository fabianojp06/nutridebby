'use client';
import { useActionState, useState } from 'react';
import type { OpcoesDeAudiencia } from '@/modules/conteudo/audiencia';
import { CORPO_MAX, MSG_CONTEUDO, RESUMO_MAX, ROTULO_VISIBILIDADE, TITULO_MAX, VISIBILIDADES, type TipoConteudo } from '@/modules/conteudo/constantes';
import type { ConteudoState, ValoresDoForm } from './actions';

type Props = {
  tipo: TipoConteudo;
  inicial: ValoresDoForm;
  opcoes: OpcoesDeAudiencia;
  acao: (s: ConteudoState, fd: FormData) => Promise<ConteudoState>;
  botao: 'Criar' | 'Salvar';
};

/** A mensagem de erro do campo `c` (o `id` é o que o `aria-describedby` do campo aponta). */
function Erro({ c, msg }: { c: string; msg?: string }) {
  return msg ? <p id={`${c}-erro`} role="alert" className="text-sm text-erro">{msg}</p> : null;
}

/** US-050/051/052/053: campos comuns, o do tipo (link ou texto) e "Quem vê". */
export function ConteudoForm({ tipo, inicial, opcoes, acao, botao }: Props) {
  const [s, enviar, enviando] = useActionState<ConteudoState, FormData>(acao, {});
  const v = s.valores ?? inicial;
  const [visibilidade, setVisibilidade] = useState(v.visibilidade || 'todos');
  const erro = (c: string) => s.erros?.[c];
  const aria = (c: string) => ({ 'aria-invalid': erro(c) ? true : undefined, 'aria-describedby': erro(c) ? `${c}-erro` : undefined });
  return (
    <form action={enviar} className="space-y-4">
      {erro('geral') && <p role="alert" className="text-erro">{erro('geral')}</p>}
      <div className="space-y-1">
        <label htmlFor="titulo" className="block font-medium">Título</label>
        <input id="titulo" name="titulo" defaultValue={v.titulo} maxLength={TITULO_MAX} {...aria('titulo')} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <Erro c="titulo" msg={erro('titulo')} />
      </div>
      <div className="space-y-1">
        <label htmlFor="resumo" className="block font-medium">Resumo</label>
        <textarea id="resumo" name="resumo" rows={2} defaultValue={v.resumo} maxLength={RESUMO_MAX} {...aria('resumo')} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <Erro c="resumo" msg={erro('resumo')} />
      </div>
      {tipo !== 'orientacao' && (
        <div className="space-y-1">
          <label htmlFor="link" className="block font-medium">Link do vídeo</label>
          {/* type="text" (não "url"): o navegador barraria "youtu.be/…" sem esquema, que lerLinkDeVideo aceita (US-050) */}
          <input id="link" name="link" type="text" inputMode="url" autoComplete="off" spellCheck={false} defaultValue={v.link} aria-invalid={erro('link') ? true : undefined} aria-describedby={`link-aviso${erro('link') ? ' link-erro' : ''}`} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          <p id="link-aviso" className="text-sm text-suave">{MSG_CONTEUDO.videoAviso}</p>
          <Erro c="link" msg={erro('link')} />
        </div>
      )}
      {tipo === 'orientacao' && (
        <div className="space-y-1">
          <label htmlFor="corpo" className="block font-medium">Texto</label>
          <textarea id="corpo" name="corpo" rows={12} defaultValue={v.corpo} maxLength={CORPO_MAX} aria-invalid={erro('corpo') ? true : undefined} aria-describedby={`corpo-ajuda${erro('corpo') ? ' corpo-erro' : ''}`} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto font-mono text-sm" />
          <p id="corpo-ajuda" className="text-sm text-suave">Use **negrito**, *itálico*, listas com - e títulos com ##.</p>
          <Erro c="corpo" msg={erro('corpo')} />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="etiquetas" className="block font-medium">Etiquetas do conteúdo</label>
        <input id="etiquetas" name="etiquetas" defaultValue={v.etiquetas} aria-invalid={erro('etiquetas') ? true : undefined} aria-describedby={`etiquetas-ajuda${erro('etiquetas') ? ' etiquetas-erro' : ''}`} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <p id="etiquetas-ajuda" className="text-sm text-suave">Separe por vírgula. Ex.: sem lactose, café da manhã</p>
        <Erro c="etiquetas" msg={erro('etiquetas')} />
      </div>
      <fieldset className="space-y-2" aria-describedby={erro('visibilidade') ? 'visibilidade-erro' : undefined}>
        <legend className="font-medium">Quem vê</legend>
        {VISIBILIDADES.map((x) => (
          <label key={x} className="flex items-center gap-2">
            <input type="radio" name="visibilidade" value={x} checked={visibilidade === x} onChange={() => setVisibilidade(x)} />
            {ROTULO_VISIBILIDADE[x]}
          </label>
        ))}
        {visibilidade === 'etiquetas' && (
          <fieldset className="ml-6 space-y-1">
            <legend className="text-sm font-medium">Etiquetas</legend>
            {opcoes.etiquetas.length === 0 && <p className="text-sm">Nenhuma etiqueta cadastrada.</p>}
            {opcoes.etiquetas.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="tags" value={e.id} defaultChecked={v.tags.includes(e.id)} />
                {e.nome}
              </label>
            ))}
          </fieldset>
        )}
        {visibilidade === 'pacientes' && (
          <fieldset className="ml-6 max-h-64 space-y-1 overflow-y-auto p-2">
            <legend className="text-sm font-medium">Pacientes</legend>
            {/* D15: a lista que esta tela mostrou — o salvamento só tira da audiência quem estava nela e foi desmarcado */}
            <input type="hidden" name="exibidos" value={opcoes.pacientes.map((p) => p.id).join(',')} />
            {opcoes.pacientes.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="pacientes" value={p.id} defaultChecked={v.pacientes.includes(p.id)} />
                {p.nome}
              </label>
            ))}
          </fieldset>
        )}
        <Erro c="visibilidade" msg={erro('visibilidade')} />
      </fieldset>
      <p role="status">{s.ok}</p>
      <button disabled={enviando} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95 disabled:opacity-50">{botao}</button>
    </form>
  );
}
