'use client';
import { useEffect } from 'react';
import { vistoAction } from './actions';

/** D18: registra a visualização quando a página abre no navegador (em dev o Strict Mode chama duas vezes: o banco ignora a segunda). */
export function MarcarVisto({ id }: { id: string }) {
  useEffect(() => {
    void vistoAction(id).catch(() => undefined);
  }, [id]);
  return null;
}
