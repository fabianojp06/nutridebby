import type { Metadata } from 'next';
import { TextoLegalView } from '@/components/texto-legal';
import { SIGILO_EQUIPE_TEXTO, SIGILO_EQUIPE_TITULO } from '@/modules/plataforma/textos-versionados';

export const metadata: Metadata = { title: SIGILO_EQUIPE_TITULO };

/**
 * Plano 26 (RN-500, PM-R3): a cópia pública do Termo de confidencialidade da equipe em vigor, para consulta (sem login:
 * `/termos` fica fora de `PROTECTED`, src/proxy.ts). O aceite é só na página do convite.
 */
export default function SigiloEquipePage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <TextoLegalView texto={SIGILO_EQUIPE_TEXTO} id="sigilo-equipe-titulo" nivel="h1" classeTitulo="text-2xl font-semibold" />
    </main>
  );
}
