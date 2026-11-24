import { requireEquipe } from '@/lib/tenant-session';
import { guiasDoPapel } from '@/modules/ajuda/conteudo';

export const dynamic = 'force-dynamic';

/**
 * D26: o manual completo — funciona sem JavaScript, dá para imprimir e é a base do treinamento (P08-08). Plano 26
 * (RN-513, RE-D42): abre também para a recepção, só com os guias do papel da sessão (`guiasDoPapel`): a recepção nunca vê
 * os guias clínicos nem os da nutricionista.
 */
export default async function AjudaPage() {
  const { papel } = await requireEquipe('/painel/ajuda');
  const guias = guiasDoPapel(papel);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6 print:max-w-none">
      <h1 className="font-titulo text-3xl font-extrabold">Manual do NutriDebby</h1>
      <nav aria-labelledby="indice" className="rounded-3xl border border-borda bg-cartao p-5 print:hidden">
        <h2 id="indice" className="font-semibold">Nesta página</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {guias.map((g) => <li key={g.id}><a href={`#${g.id}`} className="text-link underline">{g.titulo}</a></li>)}
        </ul>
      </nav>
      {guias.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`${g.id}-titulo`} className="scroll-mt-24 space-y-3 rounded-3xl border border-borda bg-cartao p-5 print:break-inside-avoid">
          <h2 id={`${g.id}-titulo`} className="font-titulo text-2xl font-semibold">{g.titulo}</h2>
          <p>{g.ajuda.resumo}</p>
          <ol className="list-decimal space-y-1 pl-5">{g.passos.map((p) => <li key={p.titulo}><strong>{p.titulo}.</strong> {p.texto}</li>)}</ol>
          {g.ajuda.secoes.map((s) => (
            <div key={s.titulo}>
              <h3 className="font-semibold">{s.titulo}</h3>
              <ul className="list-disc space-y-1 pl-5">{s.itens.map((it) => <li key={it}>{it}</li>)}</ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
