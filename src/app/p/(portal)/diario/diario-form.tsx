'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { FOTO_DIARIO_MAX_BYTES, MSG_DIARIO, REFEICOES_DO_DIARIO, TEXTO_DIARIO_MAX } from '@/modules/portal/diario-constantes';
import { linkDaRecusa, recusaDoPortal } from '../../recusa-api';

type Erros = Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>>;

/** true só no cliente depois da hidratação (no servidor e na hidratação, false) — sem setState em efeito. */
const semInscricao = () => () => {};

/** US-042: envia por fetch (multipart) e mostra a miniatura local na hora, antes de o worker converter a foto. */
export function DiarioForm() {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [ok, setOk] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  /**
   * P09-04: antes da hidratação, "Registrar" faria o envio nativo do formulário (GET com o texto do diário na URL — dado
   * de saúde no log de acesso e no Referer). O botão nasce desabilitado e habilita quando o onSubmit já está ligado.
   */
  const hidratado = useSyncExternalStore(semInscricao, () => true, () => false);
  /**
   * Recusa da sessão: o link do login (401) ou da escolha do consultório (403 de vínculo a escolher, S-4) fica junto da
   * mensagem e o formulário NÃO é apagado (o texto não se perde).
   */
  const [link, setLink] = useState<{ href: string; texto: string } | null>(null);
  useEffect(
    () => () => {
      if (previa) URL.revokeObjectURL(previa);
    },
    [previa],
  );
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dados = new FormData(form);
    const foto = dados.get('foto');
    if (foto instanceof File && foto.size > FOTO_DIARIO_MAX_BYTES) {
      setOk(null); // o "Registro salvo." do envio anterior não fica na tela junto com o erro
      return setErros({ foto: MSG_DIARIO.foto });
    }
    setEnviando(true);
    setErros({});
    setOk(null);
    setLink(null);
    try {
      const r = await fetch('/api/p/diario', { method: 'POST', body: dados });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Erros; mensagem?: string };
      if (!r.ok) {
        // recusa da sessão ({ erro }: 401 expirada, 403 termo/indisponível/escolher) — não é erro de campo
        const recusa = recusaDoPortal(r.status, corpo, '/p/diario');
        if (recusa) {
          setLink(linkDaRecusa(recusa));
          return setErros({ geral: recusa.mensagem });
        }
        return setErros(corpo.erros ?? { geral: MSG_DIARIO.ocupado });
      }
      // R9: com a cota esgotada, a mensagem traz também "Espaço de armazenamento esgotado. Fale com o suporte."
      setOk(corpo.mensagem ?? MSG_DIARIO.salvo);
      form.reset();
      setPrevia(null);
      router.refresh();
    } catch {
      setErros({ geral: MSG_DIARIO.ocupado });
    } finally {
      setEnviando(false);
    }
  };
  const campoErro = (id: keyof Erros) => (erros[id] ? { 'aria-invalid': true, 'aria-describedby': `${id}-erro` } : {});
  return (
    <form onSubmit={enviar} className="space-y-3" noValidate>
      <div className="space-y-1">
        <label htmlFor="refeicao" className="block font-medium">Refeição</label>
        <select id="refeicao" name="refeicao" defaultValue="" className="min-h-11 w-full rounded-xl border border-campo bg-cartao text-texto p-2" {...campoErro('refeicao')}>
          <option value="" disabled>Escolha a refeição</option>
          {REFEICOES_DO_DIARIO.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {erros.refeicao && <p id="refeicao-erro" role="alert" className="text-sm text-erro">{erros.refeicao}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="texto" className="block font-medium">O que você comeu?</label>
        <textarea id="texto" name="texto" maxLength={TEXTO_DIARIO_MAX} rows={3} className="w-full rounded-xl border border-campo bg-cartao text-texto p-2" {...campoErro('texto')} />
        {erros.texto && <p id="texto-erro" role="alert" className="text-sm text-erro">{erros.texto}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="foto" className="block font-medium">Foto (opcional)</label>
        <input
          id="foto"
          name="foto"
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPrevia(f ? URL.createObjectURL(f) : null);
          }}
          className="block min-h-11 w-full max-w-full"
          {...campoErro('foto')}
        />
        {erros.foto && <p id="foto-erro" role="alert" className="text-sm text-erro">{erros.foto}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:), antes de enviar */}
        {previa && <img src={previa} alt="Miniatura da foto escolhida" className="h-24 w-24 rounded object-cover" />}
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
      <button disabled={enviando || !hidratado} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">Registrar</button>
    </form>
  );
}
