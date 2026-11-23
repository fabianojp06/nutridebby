import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Db } from '@/db/client';
import { patients, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { liberarConversa } from '@/modules/mensagens/conversa';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from './pacientes';

/** Plano 25: o carimbo profissional do consultório (RN-475) usado nos testes do chat. */
export const CARIMBO = { nome: 'Débora Nutricionista', crn: 'CRN-3 12345' };

/** Consultório com o carimbo (gravado pelo dono: a tela do perfil é de outro módulo). */
export async function consultorioDoChat(db: Db, owner: Pool, nome?: string): Promise<TenantDeTeste> {
  const T = await novoTenant(db, nome);
  await owner.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', [CARIMBO.nome, CARIMBO.crn, T.tenantId]);
  return T;
}

export type PacienteDoChat = { p: string; u: string; P: TenantContext };

/**
 * Paciente com conta (a linha em `user` e o `patients.user_id`, sem senha: o chat não faz login) e, por padrão, a conversa
 * liberada pelo módulo. `P` é a sessão de paciente com conta (ator = a conta).
 */
export async function pacienteDoChat(db: Db, T: TenantDeTeste, o: { liberar?: boolean; nome?: string } = {}): Promise<PacienteDoChat> {
  const u = randomUUID();
  await db.insert(user).values({ id: u, name: o.nome ?? 'Ana Souza', email: `chat-${u.slice(0, 8)}@teste.dev`, appRole: 'paciente' });
  const p = (await novoPaciente(db, T.ctx, o.nome ? { nome: o.nome } : {})).id;
  await withTenant(T.ctx, (tx) => tx.update(patients).set({ userId: u }).where(eq(patients.id, p)), db);
  if (o.liberar ?? true) {
    const r = await liberarConversa(T.ctx, p, { forma: 'aceite_escrito', confirmou: true }, db);
    if (r !== 'ok') throw new Error(`liberar: ${r}`);
  }
  return { p, u, P: ctxPaciente(T.tenantId, p, u) };
}

type Row = Record<string, unknown>;
export const naSessao = async (db: Db, ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), db)).rows as Row[];

/**
 * Mensagem gravada pelo dono (superusuário, sem papel: os gatilhos devolvem NEW cedo), com `criada_em` escolhido — para os
 * testes de microssegundos e de cursores. `autor = 'paciente'` por padrão (sem carimbo).
 */
export async function mensagemDoDono(
  owner: Pool,
  T: TenantDeTeste,
  c: PacienteDoChat,
  m: { autor?: 'nutri' | 'paciente'; criadaEm?: string; texto?: string; risco?: string | null } = {},
): Promise<string> {
  const nutri = m.autor === 'nutri';
  const r = await owner.query<{ id: string }>(
    `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto, risco, criada_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, clock_timestamp())) returning id`,
    [T.tenantId, c.p, nutri ? 'nutri' : 'paciente', nutri ? T.nutriId : c.u, nutri ? CARIMBO.nome : null, nutri ? CARIMBO.crn : null, m.texto ?? 'Oi', m.risco ?? null, m.criadaEm ?? null],
  );
  return r.rows[0].id;
}

/** Conversas e mensagens de recado (sem liberação), gravadas pela sessão `nutri` como o envio de recado fará (T10). */
export async function recadoPara(db: Db, T: TenantDeTeste, pacientes: string[], texto = 'Feriado na segunda'): Promise<string> {
  return withTenant(
    T.ctx,
    async (tx) => {
      const [{ id }] = (
        await tx.execute<{ id: string }>(sql`insert into recados (tenant_id, texto, filtro, filtro_rotulo, destinatarios, autor_nome, autor_crn, criado_por)
          values (${T.tenantId}, ${texto}, '{"tipo":"todos"}', 'Todos os pacientes com app', ${pacientes.length}, 'x', 'x', ${T.nutriId}) returning id`)
      ).rows;
      for (const p of pacientes) {
        await tx.execute(sql`insert into chat_conversas (tenant_id, patient_id) values (${T.tenantId}, ${p}) on conflict do nothing`);
        await tx.execute(sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, recado_id)
          values (${T.tenantId}, ${p}, 'nutri', ${T.nutriId}, ${texto}, ${id})`);
      }
      return id;
    },
    db,
  );
}

/** Espera até alguma sessão ficar presa na trava segurada por `pid` (pg_blocking_pids). */
export async function esperarBloqueio(owner: Pool, pid: number): Promise<void> {
  for (let i = 0; ; i++) {
    if ((await owner.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) return;
    if (i > 300) throw new Error('ninguém ficou preso na trava');
    await new Promise((r) => setTimeout(r, 10));
  }
}

export type EstadoDoAnexo = 'pronto' | 'processando' | 'pronto_com_original' | 'falhou_com_original';
/**
 * Plano 25 (T5): uma foto do paciente gravada pelo dono (superusuário: gatilho e RLS não se aplicam), com os arquivos no
 * disco (`dataDir`) e as linhas de `stored_files`. `pronto_com_original`: o job caiu entre gravar `pronto` e apagar o
 * original (CH-D59); `falhou_com_original`: a conversão falhou e o original ainda não saiu.
 */
export async function anexoDoDono(owner: Pool, dataDir: string, T: TenantDeTeste, c: PacienteDoChat, estado: EstadoDoAnexo): Promise<{ id: string; caminhos: string[] }> {
  const arquivo = async (tipo: 'chat_anexo' | 'chat_anexo_original') => {
    const caminho = `${T.tenantId}/${tipo}/${randomUUID()}.jpg`;
    const destino = path.join(dataDir, caminho);
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, Buffer.alloc(64, 1));
    await owner.query("insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values ($1, $2, $3, 64, 'image/jpeg', $4)", [T.tenantId, tipo, caminho, c.p]);
    return caminho;
  };
  const anexo = estado === 'processando' || estado === 'falhou_com_original' ? null : await arquivo('chat_anexo');
  const original = estado === 'pronto' ? null : await arquivo('chat_anexo_original');
  const status = estado === 'pronto_com_original' ? 'pronto' : estado === 'falhou_com_original' ? 'falhou' : estado;
  const r = await owner.query<{ id: string }>(
    `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, anexo_status, anexo_tipo, anexo_path, anexo_original_path, anexo_bytes)
     values ($1, $2, 'paciente', $3, $4, 'imagem', $5, $6, 64) returning id`,
    [T.tenantId, c.p, c.u, status, anexo, original],
  );
  return { id: r.rows[0].id, caminhos: [anexo, original].filter((x): x is string => x !== null) };
}

/** Titular na anonimização pelo relógio do banco: bloqueado com `anonimizar_apos` já vencido no fuso (dois dias atrás). */
export async function bloqueadoVencido(owner: Pool, patientId: string): Promise<void> {
  await owner.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date - 2 where id = $1", [patientId]);
}
