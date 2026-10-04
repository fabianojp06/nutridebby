'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { MSG_CONTEUDO, type TipoConteudo } from '@/modules/conteudo/constantes';
import { removerCapaAction, removerPdfAction } from './actions';

const FALHOU = MSG_CONTEUDO.falhou;

/** D8/D20: capa (receita e orientação) e PDF (orientação), enviados crus para a rota (como o logo). */
export function ArquivosDoConteudo({ id, tipo, capaUrl, pdfUrl }: { id: string; tipo: TipoConteudo; capaUrl: string | null; pdfUrl: string | null }) {
  const router = useRouter();
  const [estado, setEstado] = useState<{ ok?: string; erro?: string; enviando?: boolean }>({});
  async function enviar(rota: 'capa' | 'pdf', campo: HTMLInputElement, ok: string) {
    const arquivo = campo.files?.[0];
    if (!arquivo) return;
    setEstado({ enviando: true });
    campo.value = ''; // escolher o mesmo arquivo de novo (depois de um erro ou de remover) dispara outro envio
    try {
      const r = await fetch(`/api/painel/conteudos/${id}/${rota}`, { method: 'POST', body: arquivo });
      const j = (await r.json().catch(() => ({}))) as { erro?: string };
      if (!r.ok) return setEstado({ erro: j.erro ?? FALHOU });
      setEstado({ ok });
      router.refresh();
    } catch {
      setEstado({ erro: FALHOU });
    }
  }
  return (
    <section aria-labelledby="arquivos-titulo" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
      <h2 id="arquivos-titulo" className="font-semibold">Arquivos</h2>
      <CapaDoConteudo tipo={tipo} capaUrl={capaUrl} className="max-w-xs" />
      <div className="space-y-1">
        <label htmlFor="capa" className="block font-medium">Capa (JPEG ou PNG, até 5 MB)</label>
        <input id="capa" type="file" accept="image/jpeg,image/png" disabled={estado.enviando} onChange={(e) => void enviar('capa', e.target, MSG_CONTEUDO.capaSalva)} />
      </div>
      {capaUrl && (
        <form action={removerCapaAction.bind(null, id)}>
          <button className="text-link underline">Remover capa</button>
        </form>
      )}
      {tipo === 'orientacao' && (
        <>
          <div className="space-y-1">
            <label htmlFor="pdf" className="block font-medium">Material em PDF (até 10 MB)</label>
            <input id="pdf" type="file" accept="application/pdf" disabled={estado.enviando} onChange={(e) => void enviar('pdf', e.target, MSG_CONTEUDO.pdfSalvo)} />
          </div>
          {pdfUrl && (
            <div className="flex gap-4">
              <a href={pdfUrl} className="text-link underline">Ver PDF</a>
              <button
                type="button"
                className="text-link underline"
                onClick={async () => {
                  try {
                    const r = await removerPdfAction(id);
                    if (r.erro) return setEstado({ erro: r.erro });
                    setEstado({}); // "PDF salvo." de antes não fica na tela
                    router.refresh();
                  } catch {
                    setEstado({ erro: FALHOU });
                  }
                }}
              >
                Remover PDF
              </button>
            </div>
          )}
        </>
      )}
      {estado.enviando && <p role="status">Enviando…</p>}
      {estado.ok && <p role="status">{estado.ok}</p>}
      {estado.erro && <p role="alert" className="text-erro">{estado.erro}</p>}
    </section>
  );
}
