import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { anthropometry, consultations, type AnthropometryRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar, decimalEntre, decimalOpcionalEntre } from '@/lib/numero';
import { auditRead } from '@/modules/plataforma/audit';
import { CIRCUNFERENCIAS, MSG_ANTROPO, type CircunferenciaId } from './antropometria-constantes';
import { MSG_ATENDIMENTO } from './atendimentos';
import { carregarPacienteParaEscrita, idValido, MSG_CADASTRO_INCOMPLETO } from './base';
import { dataValida, hojeNoFuso, idadeEm } from './datas';
import { calcularGordura, DOBRAS, dobrasDoProtocolo, dobrasNormalizadas, type DobraId, type Protocolo, type Sexo } from './formulas';

export { CIRCUNFERENCIAS, MSG_ANTROPO, type CircunferenciaId } from './antropometria-constantes';

/** Erros por campo: `data`, `pesoKg`, `alturaCm`, `circ_<id>`, `dobra_<id>`. */
export class AntropometriaError extends Error {
  override name = 'AntropometriaError';
  constructor(readonly erros: Record<string, string>) {
    super('Medidas inválidas');
  }
}

export type EntradaAntropometria = {
  data: unknown;
  pesoKg: unknown;
  alturaCm: unknown;
  protocolo: unknown;
  circunferencias: Partial<Record<CircunferenciaId, unknown>>;
  dobras: Partial<Record<DobraId, unknown>>;
  consultationId?: string | null;
};

/** Campos do formulário (`circ_<id>`, `dobra_<id>`) → entrada do serviço. */
export function entradaDoFormulario(v: Record<string, string>): EntradaAntropometria {
  return {
    data: v.data,
    pesoKg: v.pesoKg,
    alturaCm: v.alturaCm,
    protocolo: v.protocolo,
    circunferencias: Object.fromEntries(CIRCUNFERENCIAS.map((c) => [c.id, v[`circ_${c.id}`]])),
    dobras: Object.fromEntries(DOBRAS.map((d) => [d.id, v[`dobra_${d.id}`]])),
    consultationId: v.consultationId || null,
  };
}

function campo<T>(schema: z.ZodType<T>, valor: unknown, chave: string, erros: Record<string, string>): T | undefined {
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  erros[chave] = r.error.issues[0].message;
  return undefined;
}

const PESO = decimalEntre(MSG_ANTROPO.peso, 1, 400);
const ALTURA = decimalEntre(MSG_ANTROPO.altura, 30, 250);
const CIRC = decimalOpcionalEntre(MSG_ANTROPO.circunferencia, 5, 300);
const DOBRA = decimalOpcionalEntre(MSG_ANTROPO.dobra, 1, 100);

/**
 * US-013. Todos os campos são validados antes de gravar (nenhum erro = nada salvo). Com protocolo e as
 * dobras completas, grava densidade e %G (Apêndice A, idade na data da avaliação); faltando dobra ou
 * cadastro, salva as medidas e devolve o aviso.
 */
export async function registrarAntropometria(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: EntradaAntropometria,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ id: string; aviso: string | null }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const erros: Record<string, string> = {};
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_ANTROPO.data;
  else if (data > hojeNoFuso(tenant.fuso, now)) erros.data = MSG_ANTROPO.futuro;
  const peso = campo(PESO, input.pesoKg, 'pesoKg', erros);
  const altura = campo(ALTURA, input.alturaCm, 'alturaCm', erros);
  const protocolo: Protocolo | 'nenhum' = input.protocolo === 'jp3' || input.protocolo === 'jp7' ? input.protocolo : 'nenhum';
  const circunferencias: Record<string, number> = {};
  for (const c of CIRCUNFERENCIAS) {
    const v = campo(CIRC, input.circunferencias[c.id], `circ_${c.id}`, erros);
    if (typeof v === 'number') circunferencias[c.id] = arredondar(v, 1);
  }
  const dobrasBrutas: Partial<Record<DobraId, number>> = {};
  for (const d of DOBRAS) {
    const v = campo(DOBRA, input.dobras[d.id], `dobra_${d.id}`, erros);
    if (typeof v === 'number') dobrasBrutas[d.id] = v;
  }
  const dobras = dobrasNormalizadas(dobrasBrutas);
  if (Object.keys(erros).length || peso === undefined || altura === undefined) throw new AntropometriaError(erros);

  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const consultationId = input.consultationId || null;
      if (consultationId) {
        const [c] = idValido(consultationId)
          ? await tx.select({ id: consultations.id }).from(consultations).where(and(eq(consultations.id, consultationId), eq(consultations.patientId, p.id)))
          : [];
        if (!c) throw new AntropometriaError({ geral: MSG_ATENDIMENTO.naoEncontrado });
      }
      if (p.dataNascimento && data < p.dataNascimento) throw new AntropometriaError({ data: MSG_ANTROPO.antesDoNascimento });
      let densidade: number | null = null;
      let percGordura: number | null = null;
      let aviso: string | null = null;
      if (protocolo !== 'nenhum') {
        if (!p.dataNascimento || !p.sexo) aviso = MSG_CADASTRO_INCOMPLETO;
        else {
          const sexo = p.sexo as Sexo;
          const r = calcularGordura(protocolo, sexo, idadeEm(p.dataNascimento, data), dobras);
          if (r.ok) ({ densidade, percGordura } = r);
          else aviso = MSG_ANTROPO.dobrasFaltando(dobrasDoProtocolo(protocolo, sexo).length);
        }
      }
      const [row] = await tx
        .insert(anthropometry)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          consultationId,
          data,
          pesoKg: arredondar(peso, 2),
          alturaCm: arredondar(altura, 1),
          circunferencias,
          dobrasMm: dobras,
          protocolo,
          densidade,
          percGordura,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: anthropometry.id });
      return { id: row.id, aviso };
    },
    db,
  );
}

/** Avaliações do paciente, da mais recente para a mais antiga. Leitura de dado de saúde: auditada. */
export async function listarAntropometrias(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<AnthropometryRow[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select()
        .from(anthropometry)
        .where(eq(anthropometry.patientId, patientId))
        .orderBy(desc(anthropometry.data), desc(anthropometry.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

export async function excluirAntropometria(ctx: TenantContext, patientId: string, id: string, db: Db = getDb()): Promise<boolean> {
  if (!idValido(id)) return false;
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const apagadas = await tx
        .delete(anthropometry)
        .where(and(eq(anthropometry.id, id), eq(anthropometry.patientId, patientId)))
        .returning({ id: anthropometry.id });
      return apagadas.length > 0;
    },
    db,
  );
}
