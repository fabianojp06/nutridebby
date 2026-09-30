import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from '../cabecalho';
import { LogoForm } from './logo-form';
import { PerfilForm } from './perfil-form';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const { tenant } = await requireNutri('/painel/configuracoes');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-lg space-y-8 p-6">
        <h1 className="text-2xl font-semibold">Perfil e marca</h1>
        <LogoForm />
        <PerfilForm tenant={tenant} />
      </main>
    </>
  );
}
