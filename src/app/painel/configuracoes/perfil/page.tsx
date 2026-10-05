import { requireNutri } from '@/lib/tenant-session';
import { ROTULO_HABILITACAO, TERMO_FITOTERAPIA } from '@/modules/documentos/perfil-profissional';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { LogoForm } from '../logo-form';
import { PerfilForm } from '../perfil-form';
import { DocumentosForm } from './documentos-form';
import { FitoterapiaForm } from './fitoterapia-form';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const { tenant } = await requireNutri('/painel/configuracoes/perfil');
  return (
    <main className="mx-auto w-full max-w-lg space-y-8 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Perfil e marca</h1>
      <LogoForm />
      <PerfilForm tenant={tenant} />
      <section id="documentos" aria-labelledby="documentos-titulo" className="space-y-4">
        <h2 id="documentos-titulo" className="text-lg font-semibold">Dados para documentos</h2>
        <p className="text-sm text-suave">O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020). O CRN e o endereço ficam no formulário acima.</p>
        <DocumentosForm dados={{ nomeProfissional: tenant.nomeProfissional ?? '', contatoEmail: tenant.contatoEmail ?? '', contatoTelefone: tenant.contatoTelefoneE164 ? formatarTelefone(tenant.contatoTelefoneE164) : '' }} />
        <FitoterapiaForm
          registro={tenant.fitoterapiaRegistro}
          declaradaEm={tenant.fitoterapiaDeclaradaEm ? formatarData(hojeNoFuso(tenant.fuso, tenant.fitoterapiaDeclaradaEm)) : null}
          rotulo={ROTULO_HABILITACAO}
          termo={TERMO_FITOTERAPIA.texto}
        />
      </section>
    </main>
  );
}
