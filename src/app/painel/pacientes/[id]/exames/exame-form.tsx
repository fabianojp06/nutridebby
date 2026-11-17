'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { focarPrimeiroErro } from '@/components/focar-primeiro-erro';
import type { ItemDoCatalogo } from '@/app/painel/exames/escolher-do-catalogo';
import { EXAME_MAX_BYTES, MSG_EXAME } from '@/modules/pacientes/exames-constantes';
import { acrescentarLinhas, linhaParaEnvio, linhaVazia, LinhasDoExame, type LinhaDoForm, type ModeloParaCarregar } from './linhas-do-exame';

/** O que a T8 ("Lançar resultados" de uma solicitação) preenche: o título e as linhas (nome e unidade), valor vazio. */
export type InicialDoExame = { titulo: string; linhas: { nome: string; unidade: string | null }[] };

/** O primeiro desenho (servidor e hidratação): chaves pelo índice, para os ids dos campos baterem. */
function linhasIniciais(inicial?: InicialDoExame): LinhaDoForm[] {
  let i = 0;
  return inicial?.linhas.length ? acrescentarLinhas([], inicial.linhas, () => i++) : [linhaVazia(0)];
}

/**
 * "Novo exame" (US-015; Plano 22, T4, US-371): envia por fetch (multipart) para o Route Handler — laudo de até 20 MB não
 * cabe no limite das Server Actions. As linhas (com a faixa do laudo) vêm de `LinhasDoExame`; "Adicionar do catálogo" e
 * "Carregar modelo de solicitação" montam as linhas a partir das bibliotecas do consultório.
 */
export function ExameForm({
  patientId,
  hoje,
  catalogo,
  modelos,
  inicial,
}: {
  patientId: string;
  hoje: string;
  catalogo: ItemDoCatalogo[];
  modelos: ModeloParaCarregar[];
  inicial?: InicialDoExame;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [linhas, setLinhas] = useState<LinhaDoForm[]>(() => linhasIniciais(inicial));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  const comErros = (e: Record<string, string>) => {
    setErros(e);
    // depois de desenhar os erros: o foco vai ao primeiro (formulário longo, o botão fica longe do topo)
    window.setTimeout(() => focarPrimeiroErro(form.current), 0);
  };

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setOk(false);
    const fd = new FormData(ev.currentTarget);
    const arquivo = fd.get('arquivo');
    if (arquivo instanceof File && arquivo.size > EXAME_MAX_BYTES) return comErros({ arquivo: MSG_EXAME.arquivo });
    // no lançamento toda linha é nova: sem origem (e o servidor ignora qualquer iaTarefaId)
    fd.set(
      'valores',
      JSON.stringify(
        linhas.map((l) => {
          const { nome, valor, unidade, referencia, refMin, refMax } = linhaParaEnvio(l);
          return { nome, valor, unidade, referencia, refMin, refMax };
        }),
      ),
    );
    setEnviando(true);
    try {
      const r = await fetch(`/api/painel/pacientes/${patientId}/exames`, { method: 'POST', body: fd });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Record<string, string> };
      if (!r.ok) return comErros(corpo.erros ?? { geral: 'Não foi possível salvar o exame. Tente de novo.' });
      setErros({});
      setLinhas([linhaVazia()]);
      form.current?.reset();
      setOk(true);
      router.refresh();
    } catch {
      comErros({ geral: 'Não foi possível salvar o exame. Tente de novo.' });
    } finally {
      setEnviando(false);
    }
  }

  const aria = (k: string) => (erros[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) =>
    erros[k] && (
      <p id={`${k}-erro`} role="alert" className="text-sm text-erro">
        {erros[k]}
      </p>
    );
  return (
    <form method="post" ref={form} onSubmit={enviar} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="titulo" className="block font-medium">
            Título do exame
          </label>
          <input id="titulo" name="titulo" maxLength={120} defaultValue={inicial?.titulo} className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('titulo')} />
          {erro('titulo')}
        </div>
        <div className="space-y-1">
          <label htmlFor="data" className="block font-medium">
            Data do exame
          </label>
          <input id="data" name="data" type="date" max={hoje} defaultValue={hoje} className="min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('data')} />
          {erro('data')}
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="arquivo" className="block font-medium">
          Laudo (opcional)
        </label>
        <input id="arquivo" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" {...aria('arquivo')} />
        <p className="text-sm text-suave">PDF, JPEG ou PNG de até 20 MB.</p>
        {erro('arquivo')}
      </div>
      <LinhasDoExame idBase="novo" linhas={linhas} aoMudar={setLinhas} erros={erros} catalogo={catalogo} modelos={modelos} />
      {erros.geral && (
        <p id="geral-erro" role="alert" tabIndex={-1} className="text-sm text-erro">
          {erros.geral}
        </p>
      )}
      {/* sempre montada: "Exame salvo." é anunciado quando entra */}
      <p role="status" className="min-h-6 font-medium">
        {ok ? 'Exame salvo.' : ''}
      </p>
      <button disabled={enviando} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">
        Salvar exame
      </button>
    </form>
  );
}
