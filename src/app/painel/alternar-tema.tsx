'use client';

import { useSyncExternalStore } from 'react';
import { proximoTema, type Tema } from '@/modules/plataforma/preferencias-tipos';
import { alternarTemaAction } from './preferencias/actions';

const consulta = () => window.matchMedia('(prefers-color-scheme: dark)');
const assinar = (avisar: () => void) => {
  const m = consulta();
  m.addEventListener('change', avisar);
  return () => m.removeEventListener('change', avisar);
};

/**
 * D17: rótulo fixo "Modo escuro" + aria-pressed (padrão de botão de alternar). Sem JavaScript, o formulário posta e a
 * página volta com o tema novo; com JavaScript, o data-tema do contêiner muda na hora (otimista) e a ação grava.
 */
export function AlternarTema({ tema }: { tema: Tema }) {
  const aparelhoEscuro = useSyncExternalStore(assinar, () => consulta().matches, () => false);
  const escuro = tema === 'escuro' || (tema === 'sistema' && aparelhoEscuro);
  return (
    <form data-guia="tema" action={alternarTemaAction} onSubmit={() => document.querySelector('[data-tema]')?.setAttribute('data-tema', proximoTema(tema, aparelhoEscuro))}>
      <input type="hidden" name="aparelhoEscuro" value={aparelhoEscuro ? '1' : '0'} />
      <button
        type="submit"
        aria-label="Modo escuro"
        aria-pressed={escuro}
        title={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
        className="grid size-11 place-items-center rounded-full border border-borda bg-cartao text-texto hover:bg-linha"
      >
        {escuro ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>
    </form>
  );
}
