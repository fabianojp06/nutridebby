'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { EXAME_MAX_BYTES, MSG_EXAME } from '@/modules/pacientes/exames-constantes';

type Linha = { chave: number; nome: string; valor: string; unidade: string; referencia: string };
const vazia = (chave: number): Linha => ({ chave, nome: '', valor: '', unidade: '', referencia: '' });

/** Envia por fetch (multipart) para o Route Handler: laudo de até 20 MB não cabe no limite das Server Actions. */
export function ExameForm({ patientId, hoje }: { patientId: string; hoje: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [linhas, setLinhas] = useState<Linha[]>([vazia(0)]);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);
  const mudar = (i: number, k: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setOk(false);
    const fd = new FormData(ev.currentTarget);
    const arquivo = fd.get('arquivo');
    if (arquivo instanceof File && arquivo.size > EXAME_MAX_BYTES) return setErros({ arquivo: MSG_EXAME.arquivo });
    fd.set('valores', JSON.stringify(linhas.map(({ nome, valor, unidade, referencia }) => ({ nome, valor, unidade, referencia }))));
    setEnviando(true);
    try {
      const r = await fetch(`/api/painel/pacientes/${patientId}/exames`, { method: 'POST', body: fd });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Record<string, string> };
      if (!r.ok) return setErros(corpo.erros ?? { geral: 'Não foi possível salvar o exame. Tente de novo.' });
      setErros({});
      setLinhas([vazia(Date.now())]);
      form.current?.reset();
      setOk(true);
      router.refresh();
    } catch {
      setErros({ geral: 'Não foi possível salvar o exame. Tente de novo.' });
    } finally {
      setEnviando(false);
    }
  }

  const aria = (k: string) => (erros[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => erros[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{erros[k]}</p>;
  return (
    <form ref={form} onSubmit={enviar} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="titulo" className="block font-medium">Título do exame</label>
          <input id="titulo" name="titulo" maxLength={120} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('titulo')} />
          {erro('titulo')}
        </div>
        <div className="space-y-1">
          <label htmlFor="data" className="block font-medium">Data do exame</label>
          <input id="data" name="data" type="date" max={hoje} defaultValue={hoje} className="rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('data')} />
          {erro('data')}
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="arquivo" className="block font-medium">Laudo (opcional)</label>
        <input id="arquivo" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" {...aria('arquivo')} />
        <p className="text-sm text-suave">PDF, JPEG ou PNG de até 20 MB.</p>
        {erro('arquivo')}
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Valores</legend>
        {linhas.map((l, i) => (
          <div key={l.chave} className="grid gap-2 sm:grid-cols-5">
            {(
              [
                ['nome', `Marcador ${i + 1}`],
                ['valor', `Valor ${i + 1}`],
                ['unidade', `Unidade ${i + 1}`],
                ['referencia', `Referência ${i + 1}`],
              ] as const
            ).map(([k, rotulo]) => (
              <div key={k} className="space-y-1">
                <label htmlFor={`${k}-${l.chave}`} className="block text-sm">{rotulo}</label>
                <input id={`${k}-${l.chave}`} {...aria('valores')} value={l[k]} onChange={(ev) => mudar(i, k, ev.target.value)} inputMode={k === 'valor' ? 'decimal' : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
              </div>
            ))}
            <button type="button" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} className="self-end underline" aria-label={`Remover o valor ${i + 1}`}>Remover</button>
          </div>
        ))}
        <button type="button" onClick={() => setLinhas((ls) => [...ls, vazia(Date.now())])} className="rounded-full border border-campo bg-cartao px-3 py-1 text-texto">Adicionar valor</button>
        {erro('valores')}
      </fieldset>
      {erro('geral')}
      {ok && <p role="status">Exame salvo.</p>}
      <button disabled={enviando} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-110">Salvar exame</button>
    </form>
  );
}
