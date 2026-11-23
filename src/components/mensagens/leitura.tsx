'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { lidaMaisAdiante } from './situacao';

const C = MSG_MENSAGENS.conversa;

/** O "Lida" do render e o atualizado pela consulta (RN-448): as próprias mensagens mostradas, em ordem, e a última lida. */
type Leitura = { minhas: readonly string[]; ultimaLida: string | null; setConsultada: (id: string | null) => void };
export const ContextoDaLeitura = createContext<Leitura>({ minhas: [], ultimaLida: null, setConsultada: () => undefined });

/**
 * Guarda o "Lida": o do servidor e o da consulta da situação, valendo o mais adiante (`lidaMaisAdiante`, derivado no
 * render — nunca a prop copiada para o estado). Sem `key` (rodada da T6b, C1): nada abaixo dele remonta quando a página
 * refaz, e o rascunho, o foco e a região viva ficam.
 */
export function ProvedorDaLeitura({ minhas, ultimaLida, children }: { minhas: readonly string[]; ultimaLida: string | null; children?: ReactNode }) {
  const [consultada, setConsultada] = useState<string | null>(null);
  const valor = { minhas, ultimaLida: lidaMaisAdiante(minhas, ultimaLida, consultada), setConsultada };
  return <ContextoDaLeitura.Provider value={valor}>{children}</ContextoDaLeitura.Provider>;
}

/**
 * RN-448: "Lida" na última mensagem própria que o paciente já passou; "Enviada" nas próprias depois dela (ou em todas,
 * quando a lida não está na página); nada nas anteriores à lida.
 */
export function EstadoDaMinha({ id }: { id: string }) {
  const { minhas, ultimaLida } = useContext(ContextoDaLeitura);
  const i = minhas.indexOf(id);
  const j = ultimaLida === null ? -1 : minhas.indexOf(ultimaLida);
  if (i < 0) return null;
  if (j >= 0 && i < j) return null;
  return <span className="text-xs text-suave">{i === j ? C.lida : C.enviada}</span>;
}
