import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { signFileUrl } from '@/lib/signed-url';
import { contraste } from '@/lib/tema/contraste';
import { corNoEscuro } from '@/lib/tema/marca-tema';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { crnSchema, nomeExibicaoSchema } from './contas';
import { COR_PADRAO, FUSOS_BRASIL } from './marca-constantes';

export { COR_PADRAO, FUSOS_BRASIL };

export const MSG_MARCA = {
  cor: 'Cor muito clara para texto branco',
  corFormato: 'Use o formato #RRGGBB',
  horas: 'Informe um número inteiro de 0 a 72',
  link: 'Informe um link que comece com https://',
  linkTamanho: 'Use no máximo 500 caracteres',
  fuso: 'Fuso horário inválido',
  endereco: 'Use no máximo 200 caracteres',
} as const;

/** Razão de contraste WCAG 2.1 entre a cor e o branco. */
export const contrasteComBranco = (hex: string): number => contraste(hex, '#ffffff');

const horas = z.string().trim().regex(/^\d{1,2}$/, MSG_MARCA.horas).transform(Number).pipe(z.number().max(72, MSG_MARCA.horas));
const opcional = (v: string) => (v === '' ? null : v);

export const perfilSchema = z.object({
  nomeExibicao: nomeExibicaoSchema,
  crn: crnSchema,
  corPrimaria: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, MSG_MARCA.corFormato)
    .refine((c) => contrasteComBranco(c) >= 4.5, MSG_MARCA.cor),
  enderecoConsultorio: z.string().trim().max(200, MSG_MARCA.endereco).transform(opcional),
  linkOnlinePadrao: z
    .string()
    .trim()
    .max(500, MSG_MARCA.linkTamanho)
    .refine((v) => v === '' || (/^https:\/\/\S+$/.test(v) && URL.canParse(v)), MSG_MARCA.link)
    .transform(opcional),
  antecedenciaMinH: horas,
  cancelamentoMinH: horas,
  agendamentoPublicoAtivo: z.boolean(),
  mostrarPercGorduraPaciente: z.boolean(),
  // revisão final: só os fusos do Brasil oferecidos na tela — a agenda (T1: sem horário de verão) e a cota (T11) partem disso
  fuso: z.string().refine((f) => (FUSOS_BRASIL as readonly string[]).includes(f), MSG_MARCA.fuso),
});

export type ErrosPerfil = Partial<Record<keyof z.input<typeof perfilSchema> | 'geral', string>>;

export class PerfilError extends Error {
  override name = 'PerfilError';
  constructor(readonly erros: ErrosPerfil) {
    super('Perfil inválido');
  }
}

/** US-005. `tenants` não tem RLS: o tenantId vem sempre da sessão (requireNutri), nunca do formulário. */
export async function atualizarPerfil(tenantId: string, input: Record<string, unknown>, db: Db = getDb()): Promise<void> {
  // SUS-118: o formulário manda sempre o CRN; o já salvo (talvez da regra antiga) não é revalidado se o campo não mudou
  const [atual] = await db.select({ crn: tenants.crn }).from(tenants).where(eq(tenants.id, tenantId));
  const crnSemMudanca = atual?.crn != null && typeof input.crn === 'string' && input.crn.trim() === atual.crn;
  const p = (crnSemMudanca ? perfilSchema.omit({ crn: true }) : perfilSchema).safeParse(input);
  if (!p.success) throw new PerfilError(primeiroErroPorCampo(p.error));
  await db.update(tenants).set({ ...p.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

export type MarcaTenant = { nome: string; cor: string; corNoEscuro: string; logoUrl: string | null };

/** Marca da nutricionista (US-005 "Marca aplicada"); D19: a variante clara vai para texto/foco no modo escuro. */
export function getTenantBrand(tenant: TenantRow): MarcaTenant {
  const cor = tenant.corPrimaria ?? COR_PADRAO;
  return { nome: tenant.nomeExibicao, cor, corNoEscuro: corNoEscuro(cor), logoUrl: tenant.logoPath ? signFileUrl(tenant.logoPath) : null };
}
