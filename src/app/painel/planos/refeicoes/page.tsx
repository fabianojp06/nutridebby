import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_MINHAS_REFEICOES } from '@/modules/plano-alimentar/biblioteca-constantes';
import { kcalTexto } from '@/modules/plano-alimentar/calculo';
import { listarMinhasRefeicoes } from '@/modules/plano-alimentar/refeicoes-modelo';
import { TIPOS_DE_REFEICAO, type TipoDeRefeicao } from '@/modules/plano-alimentar/tipos-de-refeicao';

export const dynamic = 'force-dynamic';

const CAMPO = 'rounded-xl border border-campo bg-cartao p-2 text-texto';

/**
 * US-237 "Tela de cadastro": as minhas refeições com nome, tipo e "Cerca de {kcal} kcal" (valores atuais, RN-11),
 * filtráveis pelo tipo. Sem "Nova": a minha refeição nasce só pelo editor do plano ("Salvar como minha refeição").
 */
export default async function MinhasRefeicoesPage({ searchParams }: PageProps<'/painel/planos/refeicoes'>) {
  const { ctx } = await requireNutri('/painel/planos/refeicoes');
  const { tipo: pedido } = await searchParams;
  const tipo = TIPOS_DE_REFEICAO.find((t) => t === pedido) as TipoDeRefeicao | undefined; // outro valor = todos
  const refeicoes = await listarMinhasRefeicoes(ctx, { tipo });
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">{MSG_MINHAS_REFEICOES.titulo}</h1>
      <p className="text-suave">{MSG_MINHAS_REFEICOES.descricao}</p>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="tipo" className="block text-sm font-medium">Tipo</label>
          <select id="tipo" name="tipo" defaultValue={tipo ?? ''} className={CAMPO}>
            <option value="">{MSG_MINHAS_REFEICOES.todosOsTipos}</option>
            {TIPOS_DE_REFEICAO.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">Filtrar</button>
      </form>
      {refeicoes.length === 0 ? (
        <p>{MSG_MINHAS_REFEICOES.vazio}</p>
      ) : (
        <ul className="divide-y divide-linha rounded-2xl border border-borda bg-cartao">
          {refeicoes.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 p-2">
              <Link href={`/painel/planos/refeicoes/${r.id}`} className="inline-flex min-h-11 items-center text-link underline">{r.nome}</Link>
              <span className="text-sm text-suave">
                {r.tipo} · {r.kcal === null ? MSG_MINHAS_REFEICOES.textoLivre : MSG_MINHAS_REFEICOES.kcal(kcalTexto(r.kcal))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
