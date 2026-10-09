import { Cartao } from '@/components/ui/cartao';
import { requireUser } from '@/lib/session';
import { Reiniciar2faForm } from '../reiniciar-2fa-form';

export const dynamic = 'force-dynamic';

/** P16-17: a aba "Segurança" — reiniciar a verificação em duas etapas de outra conta (P09-02). */
export default async function SegurancaPage() {
  await requireUser(['admin'], '/admin/seguranca');
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <h1 className="font-titulo text-2xl font-semibold">Segurança</h1>
      <Cartao id="titulo-2fa" titulo="Verificação em duas etapas" className="max-w-3xl">
        <div className="space-y-4">
          <p className="text-sm">Use quando alguém perdeu o app autenticador e os códigos de recuperação, ou depois da troca do AUTH_SECRET. Confirme antes a identidade de quem pediu.</p>
          <Reiniciar2faForm />
        </div>
      </Cartao>
    </main>
  );
}
