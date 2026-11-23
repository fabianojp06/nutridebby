import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { tenants } from '@/db/schema';
import { atualizarPerfil, contrasteComBranco, COR_PADRAO, FUSOS_BRASIL, getTenantBrand, PerfilError, perfilSchema } from './marca';

vi.mock('server-only', () => ({})); // M16: marca.ts é só do servidor
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const valido = {
  nomeExibicao: 'Debby Silva', crn: 'CRN-3 12345', corPrimaria: '#2E7D32', enderecoConsultorio: 'Rua A, 10',
  antecedenciaMinH: '12', cancelamentoMinH: '24',
  agendamentoPublicoAtivo: true, mostrarPercGorduraPaciente: false, fuso: 'America/Sao_Paulo',
};
/** Erros por campo, ou `undefined` quando a gravação dá certo. */
const erros = (tenantId: string, extra: Record<string, unknown>) =>
  atualizarPerfil(tenantId, { ...valido, ...extra }, app.db).then(
    () => undefined,
    (e: unknown) => (e as PerfilError).erros,
  );
async function novoTenant() {
  const [t] = await app.db.insert(tenants).values({ slug: `marca-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Marca' }).returning();
  return t;
}

describe('contrasteComBranco (WCAG, US-005)', () => {
  it('limite de 4,5:1', () => {
    expect(contrasteComBranco('#2E7D32')).toBeGreaterThan(5.1);
    expect(contrasteComBranco('#767676')).toBeGreaterThanOrEqual(4.5);
    expect(contrasteComBranco('#777777')).toBeLessThan(4.5);
    expect(contrasteComBranco('#FFEB3B')).toBeLessThan(4.5);
  });
});

describe('atualizarPerfil (US-005)', () => {
  it('grava os campos; endereço vazio vira nulo', async () => {
    const t = await novoTenant();
    await atualizarPerfil(t.id, valido, app.db);
    const [r] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r).toMatchObject({ nomeExibicao: 'Debby Silva', crn: 'CRN-3 12345', corPrimaria: '#2E7D32', antecedenciaMinH: 12, cancelamentoMinH: 24, agendamentoPublicoAtivo: true });
    await atualizarPerfil(t.id, { ...valido, enderecoConsultorio: ' ', agendamentoPublicoAtivo: false }, app.db);
    const [r2] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r2).toMatchObject({ enderecoConsultorio: null, agendamentoPublicoAtivo: false });
  });

  it('Plano 23 (AG-D7): o link padrão saiu do Perfil — não é validado nem gravado; o valor antigo continua no banco', async () => {
    expect(Object.keys(perfilSchema.shape)).not.toContain('linkOnlinePadrao');
    const t = await novoTenant();
    await app.db.update(tenants).set({ linkOnlinePadrao: 'https://meet.exemplo.com/antigo' }).where(eq(tenants.id, t.id));
    for (const linkOnlinePadrao of ['', 'http://nao-e-https', 'https://meet.exemplo.com/novo']) expect(await erros(t.id, { linkOnlinePadrao })).toBeUndefined();
    const [r] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.linkOnlinePadrao).toBe('https://meet.exemplo.com/antigo');
  });

  it('grava e lê de volta "Mostrar % de gordura ao paciente"', async () => {
    const t = await novoTenant();
    await atualizarPerfil(t.id, { ...valido, mostrarPercGorduraPaciente: true }, app.db);
    const [r] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.mostrarPercGorduraPaciente).toBe(true);
  });

  it('mensagens exatas', async () => {
    const t = await novoTenant();
    expect(await erros(t.id, { corPrimaria: '#FFEB3B' })).toEqual({ corPrimaria: 'Cor muito clara para texto branco' });
    expect(await erros(t.id, { corPrimaria: 'verde' })).toEqual({ corPrimaria: 'Use o formato #RRGGBB' });
    for (const h of ['73', '-1', '1.5', '']) expect(await erros(t.id, { antecedenciaMinH: h })).toEqual({ antecedenciaMinH: 'Informe um número inteiro de 0 a 72' });
    expect(await erros(t.id, { cancelamentoMinH: '0' })).toBeUndefined();
    expect(await erros(t.id, { fuso: 'Marte/Base' })).toEqual({ fuso: 'Fuso horário inválido' });
    // revisão final: só os fusos do Brasil da tela (sem horário de verão; rótulos e cota partem disso) — IANA válido de fora, não
    for (const f of ['America/New_York', 'Europe/Lisbon', 'UTC']) expect(await erros(t.id, { fuso: f })).toEqual({ fuso: 'Fuso horário inválido' });
    for (const f of FUSOS_BRASIL) expect(await erros(t.id, { fuso: f })).toBeUndefined();
    expect(await erros(t.id, { crn: 'X' })).toEqual({ crn: 'CRN inválido. Ex.: CRN-3 12345' });
  });
});

describe('getTenantBrand', () => {
  it('cor padrão sem cor definida; logo por URL assinada', async () => {
    const t = await novoTenant();
    expect(COR_PADRAO).toBe('#1d6b5a'); // D23
    expect(getTenantBrand(t)).toEqual({ nome: 'Marca', cor: '#1d6b5a', corNoEscuro: expect.stringMatching(/^#[0-9a-f]{6}$/), logoUrl: null });
    const comLogo = { ...t, corPrimaria: '#2E7D32', logoPath: `${t.id}/logo/${randomUUID()}.png` };
    expect(getTenantBrand(comLogo).logoUrl).toMatch(/^\/api\/arquivos\?c=/);
    expect(getTenantBrand(comLogo).cor).toBe('#2E7D32');
  });
});
