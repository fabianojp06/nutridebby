import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { metricasDosConteudos, quemViu, textoDaMetrica } from './metricas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('métricas (US-056, D14)', () => {
  it('texto da spec, com arredondamento e singular', () => {
    expect(textoDaMetrica({ vistos: 18, audiencia: 40 })).toBe('18 de 40 pacientes (45%)');
    expect(textoDaMetrica({ vistos: 1, audiencia: 3 })).toBe('1 de 3 pacientes (33%)');
    expect(textoDaMetrica({ vistos: 1, audiencia: 1 })).toBe('1 de 1 paciente (100%)');
    expect(textoDaMetrica({ vistos: 0, audiencia: 0 })).toBe('0 de 0 pacientes (0%)');
  });

  it('audiência atual (ativos); quem saiu (arquivado) não conta em nenhum lado; quem viu fora da audiência não conta', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia, caio, duda] = await Promise.all(['Ana', 'Bia', 'Caio', 'Duda'].map((nome) => novoPaciente(app.db, T.ctx, { nome })));
    const c = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id, bia.id, caio.id] });
    const ver = (patientId: string, quando: string) =>
      withTenant(T.ctx, (tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id, visto_em) values (${T.tenantId}, ${c.id}, ${patientId}, ${quando})`), app.db);
    await ver(ana.id, '2026-10-20T12:00:00Z');
    await ver(caio.id, '2026-10-21T12:00:00Z');
    await ver(duda.id, '2026-10-21T13:00:00Z'); // pelo cartão do plano, fora da audiência
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, caio.id)), app.db);
    const m = await metricasDosConteudos(T.ctx, [{ id: c.id }], app.db);
    expect(m.get(c.id)).toEqual({ vistos: 1, audiencia: 2 });
    expect(await quemViu(T.ctx, c.id, app.db)).toEqual({ titulo: c.titulo, pessoas: [{ nome: 'Ana', vistoEm: new Date('2026-10-20T12:00:00Z') }] });
    expect(await quemViu(T.ctx, 'lixo', app.db)).toBeNull();
  });

  it('vários conteúdos numa consulta só: todos, etiqueta, pacientes sem ninguém na audiência e id de outro consultório', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const [ana, bia] = await Promise.all(['Ana', 'Bia'].map((nome) => novoPaciente(app.db, T.ctx, { nome })));
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const todos = await novoConteudo(app.db, T);
    const porEtiqueta = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    const ninguem = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [] });
    const deFora = await novoConteudo(app.db, U);
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${todos.id}, ${bia.id}), (${T.tenantId}, ${porEtiqueta.id}, ${ana.id})`), app.db);
    const m = await metricasDosConteudos(T.ctx, [todos, porEtiqueta, ninguem, deFora], app.db);
    expect(Object.fromEntries(m)).toEqual({
      [todos.id]: { vistos: 1, audiencia: 2 },
      [porEtiqueta.id]: { vistos: 1, audiencia: 1 },
      [ninguem.id]: { vistos: 0, audiencia: 0 },
    });
  });
});
