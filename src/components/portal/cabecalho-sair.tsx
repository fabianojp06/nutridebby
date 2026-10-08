import { SairPortal } from '@/app/p/sair-portal';

/** RN-211: nas páginas fora do layout do portal (/p/escolher, /p/sem-acesso, /p/termo) o "Sair" continua no topo. */
export function CabecalhoSair() {
  return (
    <header className="flex justify-end px-6 pt-4">
      <SairPortal />
    </header>
  );
}
