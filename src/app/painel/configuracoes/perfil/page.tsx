import { requireNutri } from '@/lib/tenant-session';
import { LogoForm } from '../logo-form';
import { PerfilForm } from '../perfil-form';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const { tenant } = await requireNutri('/painel/configuracoes/perfil');
  return (
    <main className="mx-auto w-full max-w-lg space-y-8 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Perfil e marca</h1>
      <LogoForm />
      <PerfilForm tenant={tenant} />
    </main>
  );
}
