import Link from 'next/link';

/** O Perfil, onde ficam o nome profissional e o CRN (o carimbo, RN-475). */
export const CAMINHO_DO_PERFIL = '/painel/configuracoes/perfil';

/**
 * RN-475 (§6.2): "… preencha seu nome e seu CRN em Configurações." com "Configurações" como link para o Perfil. Serve ao
 * servidor e ao cliente (sem diretiva e sem import de servidor).
 */
export function ComLinkDoPerfil({ texto, id }: { texto: string; id?: string }) {
  const [antes, ...resto] = texto.split('Configurações');
  if (resto.length === 0) return <>{texto}</>;
  return (
    <>
      {antes}
      <Link id={id} href={CAMINHO_DO_PERFIL} prefetch={false} className="text-link underline">
        Configurações
      </Link>
      {resto.join('Configurações')}
    </>
  );
}
