'use client';
import { useSyncExternalStore } from 'react';

export const precisaDaSigla = (fusoDoAparelho: string, fusoDoTenant: string): boolean => fusoDoAparelho !== fusoDoTenant;

const semAssinatura = () => () => {};
const fusoDoAparelho = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

/** RN-06: "seg., 12/10 às 09:00" no fuso do consultório; com o aparelho em outro fuso, "(horário de Brasília)" junto. */
export function QuandoLocal({ semFuso, comFuso, fuso }: { semFuso: string; comFuso: string; fuso: string }) {
  // no servidor (e sem JS), o fuso é '' → com a sigla: nunca ambíguo
  const aparelho = useSyncExternalStore(semAssinatura, fusoDoAparelho, () => '');
  return <>{precisaDaSigla(aparelho, fuso) ? comFuso : semFuso}</>;
}
