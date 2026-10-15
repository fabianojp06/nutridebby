import { DPA_PATH, requireNutri } from '@/lib/tenant-session';
import { DPA_MUDOU, DPA_PARAGRAFOS, DPA_ROTULO, DPA_TITULO, DPA_VERSAO } from '@/modules/plataforma/dpa';
import { DpaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function DpaPage() {
  const { tenant } = await requireNutri(DPA_PATH, { permitirDpaPendente: true });
  const atual = tenant.dpaVersao === DPA_VERSAO;
  // P08-06: quem já aceitou uma versão anterior chega aqui no meio do trabalho; o aviso diz por que o painel parou
  const mudou = !atual && tenant.dpaVersao !== null;
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      {/* a nutricionista com o DPA pendente só chega aqui: o "Sair" está no cabeçalho mínimo do layout (sem o menu) */}
      <h1 className="font-titulo text-2xl font-semibold">{DPA_TITULO}</h1>
      {mudou && (
        <p role="status" className="rounded-2xl border border-borda bg-cartao p-3 font-medium">
          {DPA_MUDOU}
        </p>
      )}
      {/* o texto inteiro na página, sem caixa com rolagem própria (15 cláusulas não cabem numa caixa no celular) */}
      <section aria-label={DPA_TITULO} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3 text-sm">
        {DPA_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
      </section>
      {atual ? <p role="status">Você já aceitou esta versão do contrato.</p> : <DpaForm rotulo={DPA_ROTULO} />}
    </main>
  );
}
