'use client';

import { createContext, useContext } from 'react';
import type { StatusSalvamento } from './use-salvamento';

/**
 * Estado do salvamento automático para quem está fora do editor, mas dentro das `acoes` dele: o "Publicar" só vale
 * com tudo salvo (senão publicaria o que o servidor tem, não o que a nutricionista vê na tela).
 */
export const SalvamentoContext = createContext<StatusSalvamento>('salvo');
export const useStatusSalvamento = () => useContext(SalvamentoContext);
