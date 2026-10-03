'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { FOTO_DIARIO_MAX_BYTES, MSG_DIARIO, REFEICOES_DO_DIARIO, TEXTO_DIARIO_MAX } from '@/modules/portal/diario-constantes';

type Erros = Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>>;

/** US-042: envia por fetch (multipart) e mostra a miniatura local na hora, antes de o worker converter a foto. */
export function DiarioForm() {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [ok, setOk] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
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
    try {
      const r = await fetch('/api/p/diario', { method: 'POST', body: dados });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Erros; mensagem?: string };
      if (!r.ok) return setErros(corpo.erros ?? { geral: MSG_DIARIO.ocupado });
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
        <select id="refeicao" name="refeicao" defaultValue="" className="min-h-11 w-full rounded border p-2" {...campoErro('refeicao')}>
          <option value="" disabled>Escolha a refeição</option>
          {REFEICOES_DO_DIARIO.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {erros.refeicao && <p id="refeicao-erro" role="alert" className="text-sm text-red-700">{erros.refeicao}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="texto" className="block font-medium">O que você comeu?</label>
        <textarea id="texto" name="texto" maxLength={TEXTO_DIARIO_MAX} rows={3} className="w-full rounded border p-2" {...campoErro('texto')} />
        {erros.texto && <p id="texto-erro" role="alert" className="text-sm text-red-700">{erros.texto}</p>}
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
          className="block min-h-11"
          {...campoErro('foto')}
        />
        {erros.foto && <p id="foto-erro" role="alert" className="text-sm text-red-700">{erros.foto}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:), antes de enviar */}
        {previa && <img src={previa} alt="Miniatura da foto escolhida" className="h-24 w-24 rounded object-cover" />}
      </div>
      {erros.geral && <p role="alert" className="text-red-700">{erros.geral}</p>}
      {ok && <p role="status" className="rounded bg-emerald-50 p-3">{ok}</p>}
      <button disabled={enviando} className="min-h-11 rounded bg-emerald-700 px-4 text-white">Registrar</button>
    </form>
  );
}
