import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { apagarUsoDeConteudo, conteudosDoTitular } from './titular';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('conteúdo e o titular (US-018, US-046, D15)', () => {
  it('o que viu e favoritou vai para a exportação (despublicado: "Conteúdo indisponível", nunca o título do rascunho); a exclusão apaga alvos, favoritos e visualizações só dele', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx);
    const c = await novoConteudo(app.db, T, { titulo: 'Como ler rótulos', visibilidade: 'pacientes', pacientes: [ana.id, bia.id] });
    // despublicado depois de visto e favoritado, e renomeado com um título interno de rascunho
    const d = await novoConteudo(app.db, T, { titulo: 'Rascunho interno', visibilidade: 'pacientes', pacientes: [ana.id] });
    await withTenant(
      T.ctx,
      async (tx) => {
        for (const p of [ana.id, bia.id]) {
          await tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id, visto_em) values (${T.tenantId}, ${c.id}, ${p}, '2026-10-20T12:00:00Z')`);
          await tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id, created_at) values (${T.tenantId}, ${c.id}, ${p}, '2026-10-20T12:05:00Z')`);
        }
        await tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id, visto_em) values (${T.tenantId}, ${d.id}, ${ana.id}, '2026-10-21T09:00:00Z')`);
        await tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id, created_at) values (${T.tenantId}, ${d.id}, ${ana.id}, '2026-10-21T09:01:00Z')`);
        await tx.execute(sql`update contents set status = 'rascunho', publicado_em = null, titulo = 'Plano interno: só para a Ana' where id = ${d.id}`);
      },
      app.db,
    );
    expect(await withTenant(T.ctx, (tx) => conteudosDoTitular(tx, ana.id), app.db)).toEqual({
      vistos: [
        { titulo: 'Como ler rótulos', vistoEm: '2026-10-20T12:00:00.000Z' },
        { titulo: 'Conteúdo indisponível', vistoEm: '2026-10-21T09:00:00.000Z' },
      ],
      favoritos: [
        { titulo: 'Como ler rótulos', favoritadoEm: '2026-10-20T12:05:00.000Z' },
        { titulo: 'Conteúdo indisponível', favoritadoEm: '2026-10-21T09:01:00.000Z' },
      ],
    });
    await withTenant(T.ctx, (tx) => apagarUsoDeConteudo(tx, ana.id), app.db);
    const restam = await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`select (select count(*) from content_views where patient_id = ${ana.id})::int as v, (select count(*) from content_favorites where patient_id = ${ana.id})::int as f,
        (select count(*) from content_audience where patient_id = ${ana.id})::int as a, (select count(*) from content_views where patient_id = ${bia.id})::int as vb`),
      app.db,
    );
    expect(restam.rows[0]).toEqual({ v: 0, f: 0, a: 0, vb: 1 });
  });
});
