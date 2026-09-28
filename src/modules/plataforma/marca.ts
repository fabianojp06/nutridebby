import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { signFileUrl } from '@/lib/signed-url';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { crnSchema, nomeExibicaoSchema } from './contas';
import { COR_PADRAO, FUSOS_BRASIL } from './marca-constantes';

export { COR_PADRAO, FUSOS_BRASIL };

export const MSG_MARCA = {
  cor: 'Cor muito clara para texto branco',
  corFormato: 'Use o formato #RRGGBB',
  horas: 'Informe um número inteiro de 0 a 72',
  link: 'Informe um link que comece com https://',
  fuso: 'Fuso horário inválido',
  endereco: 'Use no máximo 200 caracteres',
} as const;

/** Razão de contraste WCAG 2.1 entre a cor e o branco. */
export function contrasteComBranco(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

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
    .refine((v) => v === '' || (/^https:\/\/\S+$/.test(v) && URL.canParse(v)), MSG_MARCA.link)
    .transform(opcional),
  antecedenciaMinH: horas,
  cancelamentoMinH: horas,
  agendamentoPublicoAtivo: z.boolean(),
  fuso: z.string().refine((f) => Intl.supportedValuesOf('timeZone').includes(f), MSG_MARCA.fuso),
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
  const p = perfilSchema.safeParse(input);
  if (!p.success) throw new PerfilError(primeiroErroPorCampo(p.error));
  await db.update(tenants).set({ ...p.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

export type MarcaTenant = { nome: string; cor: string; logoUrl: string | null };

/** Marca da nutricionista (US-005 "Marca aplicada"): painel agora; PWA (Plano 06) e PDF (P04-09) depois. */
export function getTenantBrand(tenant: TenantRow): MarcaTenant {
  return {
    nome: tenant.nomeExibicao,
    cor: tenant.corPrimaria ?? COR_PADRAO,
    logoUrl: tenant.logoPath ? signFileUrl(tenant.logoPath) : null,
  };
}
