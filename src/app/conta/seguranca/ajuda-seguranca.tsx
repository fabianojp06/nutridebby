import { guiaDaRota, type PapelDoGuia } from '@/modules/ajuda/conteudo';
import { SECURITY_PATH } from '@/lib/session-rules';

/**
 * D18 (Plano 10A): /conta/seguranca não tem o GuiaDoPainel (fora do layout do painel); o guia aparece aqui, aberto ou
 * fechado. Plano 26 (RE-D42): o guia do papel da sessão.
 */
export function AjudaSeguranca({ papel }: { papel: PapelDoGuia }) {
  const g = guiaDaRota(SECURITY_PATH, papel);
  if (!g) return null;
  return (
    <details className="rounded-2xl border border-borda bg-cartao p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">Como funciona</summary>
      <p className="mt-2">{g.ajuda.resumo}</p>
      {g.ajuda.secoes.map((s) => (
        <section key={s.titulo} className="mt-3">
          <h2 className="font-semibold">{s.titulo}</h2>
          <ul className="list-disc space-y-1 pl-5">
            {s.itens.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </section>
      ))}
    </details>
  );
}
