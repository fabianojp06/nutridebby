import { DPA_PATH, requireNutri } from '@/lib/tenant-session';
import { DPA_PARAGRAFOS, DPA_ROTULO, DPA_TITULO, DPA_VERSAO } from '@/modules/plataforma/dpa';
import { DpaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function DpaPage() {
  const { tenant } = await requireNutri(DPA_PATH, { permitirDpaPendente: true });
  const atual = tenant.dpaVersao === DPA_VERSAO;
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      {/* a nutricionista com o DPA pendente só chega aqui: o "Sair" está no cabeçalho mínimo do layout (sem o menu) */}
      <h1 className="font-titulo text-2xl font-semibold">{DPA_TITULO}</h1>
      <section aria-label={DPA_TITULO} tabIndex={0} className="max-h-96 space-y-2 overflow-y-auto rounded-2xl border border-borda bg-cartao p-3 text-sm">
        {DPA_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
      </section>
      {atual ? <p role="status">Você já aceitou esta versão do contrato.</p> : <DpaForm rotulo={DPA_ROTULO} />}
    </main>
  );
}
