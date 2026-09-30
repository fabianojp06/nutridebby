import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '@/db/client';
import { patients, type PatientRow } from '@/db/schema';

export const MSG_BLOQUEADO = 'Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.';
export const MSG_CADASTRO_INCOMPLETO = 'Complete a data de nascimento e o sexo do paciente no cadastro.';

export class PacienteNaoEncontradoError extends Error {
  override name = 'PacienteNaoEncontradoError';
  constructor() {
    super('Paciente não encontrado');
  }
}

export class PacienteBloqueadoError extends Error {
  override name = 'PacienteBloqueadoError';
  constructor() {
    super(MSG_BLOQUEADO);
  }
}

/** O id costuma vir da URL; sem isto, o cast para uuid no Postgres vira erro 500 (M6/G5 do Plano 02). */
export const idValido = (id: unknown): id is string => typeof id === 'string' && z.guid().safeParse(id).success;

/**
 * Paciente travado (FOR UPDATE) antes de qualquer escrita no prontuário. Chamar dentro de withTenant:
 * a RLS já esconde paciente de outro tenant (→ não encontrado). Bloqueado ou anonimizado é só leitura
 * (US-018 "mantido … só para consulta da nutricionista"). Arquivado continua editável.
 */
export async function carregarPacienteParaEscrita(tx: Tx, patientId: string): Promise<PatientRow> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p) throw new PacienteNaoEncontradoError();
  if (p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
  return p;
}
