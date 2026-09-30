import { formatarBytes } from '@/lib/format';
import { requireNutri } from '@/lib/tenant-session';
import { COTA_BYTES, MSG_COTA_ESGOTADA, nivelDeUso } from '@/modules/plataforma/armazenamento';
import { Cabecalho } from './cabecalho';

export const dynamic = 'force-dynamic';

export default async function PainelHome() {
  const { data, tenant } = await requireNutri('/painel');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Painel da nutricionista</h1>
        {(() => {
          const uso = nivelDeUso(tenant.armazenamentoBytes);
          if (uso.nivel === 'esgotado') return <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA_ESGOTADA}</p>;
          if (uso.nivel === 'aviso') {
            return (
              <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
                {`Você já usou ${uso.percentual}% do espaço de armazenamento (${formatarBytes(tenant.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)}).`}
              </p>
            );
          }
          return null;
        })()}
        <p>Conectado como {data.user.email}.</p>
      </main>
    </>
  );
}
