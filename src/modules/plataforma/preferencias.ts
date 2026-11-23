import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { user } from '@/db/schema';
import { ehTema, ESTADOS_GUIA, ID_GUIA, type EstadoGuia, type ProgressoGuia, type Tema } from './preferencias-tipos';

export * from './preferencias-tipos';

export class PreferenciaError extends Error {
  override name = 'PreferenciaError';
}

/**
 * D17: a tabela `user` é exceção de RLS (CLAUDE.md regra 1). Este módulo só lê/grava `tema` e `guia` da conta da
 * própria sessão — o `userId` vem sempre da sessão (requireNutri ou, nas actions do cabeçalho que abrem para a recepção,
 * requireEquipe — Plano 26, RN-513), nunca do formulário.
 */
export async function gravarTema(userId: string, tema: unknown, db: Db = getDb()): Promise<Tema> {
  if (!ehTema(tema)) throw new PreferenciaError('tema inválido');
  await db.update(user).set({ tema }).where(eq(user.id, userId));
  return tema;
}

export async function lerGuia(userId: string, db: Db = getDb()): Promise<ProgressoGuia> {
  const [u] = await db.select({ guia: user.guia }).from(user).where(eq(user.id, userId));
  return u?.guia ?? {};
}

/**
 * Atômico (`jsonb_set` numa instrução): duas abas gravando tours diferentes não se apagam. Uma versão menor que a gravada
 * nunca sobrescreve (aba aberta antes do deploy, com o GUIAS antigo); "visto" não rebaixa um tour já concluído/dispensado
 * na mesma versão. Mesma regra do `aplicarMarca` (T19).
 */
export async function marcarGuia(userId: string, id: string, versao: number, estado: EstadoGuia, db: Db = getDb()): Promise<void> {
  if (!ID_GUIA.test(id) || !Number.isInteger(versao) || versao < 1 || versao > 1000 || !ESTADOS_GUIA.includes(estado)) {
    throw new PreferenciaError('progresso do manual inválido');
  }
  const valor = JSON.stringify({ v: versao, estado });
  const novo = sql`jsonb_set(${user.guia}, array[${id}]::text[], ${valor}::jsonb, true)`;
  const versaoGravada = sql`(${user.guia} -> ${id} ->> 'v')::int`; // null quando o tour ainda não tem marca
  const manter =
    estado === 'visto'
      ? sql`${versaoGravada} > ${versao} or (${versaoGravada} = ${versao} and ${user.guia} -> ${id} ->> 'estado' in ('concluido', 'dispensado'))`
      : sql`${versaoGravada} > ${versao}`;
  const guia = sql`case when coalesce(${manter}, false) then ${user.guia} else ${novo} end`;
  await db.update(user).set({ guia }).where(eq(user.id, userId));
}
