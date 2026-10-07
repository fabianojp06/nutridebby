'use client';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  ENVIO_FOTO_MAX_BYTES, ENVIO_MAX_FOTOS, ENVIO_PDF_MAX_BYTES, ENVIO_TOTAL_MAX_BYTES, MSG_ENVIO, NOME_ENVIO_MAX, OBSERVACAO_ENVIO_MAX,
} from '@/modules/pacientes/exames-enviados-constantes';
import { linkDaRecusa, recusaDoPortal } from '../../recusa-api';

type Campo = 'dataColeta' | 'nome' | 'observacao' | 'arquivos' | 'geral';
type Erros = Partial<Record<Campo, string>>;

/** true só no cliente depois da hidratação (no servidor e na hidratação, false) — sem setState em efeito. */
const semInscricao = () => () => {};

/** RN-161 no navegador, pelo tamanho e pelo tipo declarado (o servidor confere de novo, pelo conteúdo). */
export function arquivosValidos(arquivos: { size: number; type: string }[]): boolean {
  if (!arquivos.length || arquivos.length > ENVIO_MAX_FOTOS) return false;
  if (arquivos.reduce((s, a) => s + a.size, 0) > ENVIO_TOTAL_MAX_BYTES) return false;
  if (arquivos.some((a) => a.type === 'application/pdf')) return arquivos.length === 1 && arquivos[0].size <= ENVIO_PDF_MAX_BYTES;
  return arquivos.every((a) => a.size <= ENVIO_FOTO_MAX_BYTES);
}

/** US-160: envia por fetch (multipart) para /api/p/exames; o worker processa depois ("Processando…" na lista). */
export function EnvioForm({ hoje }: { hoje: string }) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [link, setLink] = useState<{ href: string; texto: string } | null>(null);
  /** P09-04: antes da hidratação, "Enviar" faria o envio nativo; o botão nasce desabilitado. */
  const hidratado = useSyncExternalStore(semInscricao, () => true, () => false);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dados = new FormData(form);
    const itens = dados.getAll('arquivos');
    const arquivos = itens.filter((a): a is File => a instanceof File && a.size > 0);
    setOk(null);
    setLink(null);
    // revisão do plano: um arquivo vazio no meio é recusado (como na rota), não descartado em silêncio
    if (arquivos.length !== itens.length || !arquivosValidos(arquivos)) return setErros({ arquivos: MSG_ENVIO.arquivos });
    setEnviando(true);
    setErros({});
    try {
      const r = await fetch('/api/p/exames', { method: 'POST', body: dados });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Erros; mensagem?: string };
      if (!r.ok) {
        // recusa da sessão ({ erro }: 401 expirada, 403 termo/indisponível/escolher) — não é erro de campo; o formulário fica
        const recusa = recusaDoPortal(r.status, corpo, '/p/exames');
        if (recusa) {
          setLink(linkDaRecusa(recusa));
          return setErros({ geral: recusa.mensagem });
        }
        return setErros(corpo.erros && Object.keys(corpo.erros).length ? corpo.erros : { geral: MSG_ENVIO.ocupado });
      }
      setOk(corpo.mensagem ?? MSG_ENVIO.enviado);
      form.reset();
      router.refresh();
    } catch {
      setErros({ geral: MSG_ENVIO.ocupado });
    } finally {
      setEnviando(false);
    }
  };
  const descrito = (id: Campo, dica?: string) => {
    const ids = [dica, erros[id] ? `${id}-erro` : undefined].filter(Boolean).join(' ');
    return { ...(erros[id] ? { 'aria-invalid': true } : {}), ...(ids ? { 'aria-describedby': ids } : {}) };
  };
  const erro = (id: Campo) => erros[id] && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{erros[id]}</p>;
  return (
    <form method="post" onSubmit={enviar} className="space-y-3" noValidate>
      <div className="space-y-1">
        <label htmlFor="dataColeta" className="block font-medium">Data da coleta</label>
        <input id="dataColeta" name="dataColeta" type="date" max={hoje} required className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...descrito('dataColeta')} />
        {erro('dataColeta')}
      </div>
      <div className="space-y-1">
        <label htmlFor="nome" className="block font-medium">Nome do exame (opcional)</label>
        <input id="nome" name="nome" maxLength={NOME_ENVIO_MAX} className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...descrito('nome')} />
        {erro('nome')}
      </div>
      <div className="space-y-1">
        <label htmlFor="observacao" className="block font-medium">Observação (opcional)</label>
        <textarea id="observacao" name="observacao" maxLength={OBSERVACAO_ENVIO_MAX} rows={3} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...descrito('observacao', 'observacao-dica')} />
        <p id="observacao-dica" className="text-sm text-suave">{MSG_ENVIO.dicaObservacao}</p>
        {erro('observacao')}
      </div>
      <div className="space-y-1">
        <label htmlFor="arquivos" className="block font-medium">PDF ou fotos do exame</label>
        {/* revisão do plano: a dica e o erro têm o mesmo texto — com erro, só o erro (o leitor de tela não repete a frase) */}
        <input id="arquivos" name="arquivos" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/heic,image/heif" className="block min-h-11 w-full max-w-full" {...descrito('arquivos', erros.arquivos ? undefined : 'arquivos-dica')} />
        {!erros.arquivos && <p id="arquivos-dica" className="text-sm text-suave">{MSG_ENVIO.arquivos}</p>}
        {erro('arquivos')}
      </div>
      {erros.geral && (
        <p role="alert" className="text-erro">
          {erros.geral}
          {link && (
            <>
              {' '}
              <a href={link.href} className="inline-flex min-h-11 items-center underline">{link.texto}</a>
            </>
          )}
        </p>
      )}
      {ok && <p role="status" className="rounded bg-ok-fundo p-3">{ok}</p>}
      <button disabled={enviando || !hidratado} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">Enviar</button>
    </form>
  );
}
