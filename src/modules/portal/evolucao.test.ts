import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { evolucaoParaPaciente } from './evolucao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function comAvaliacoes() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  await withTenant(
    T.ctx,
    async (tx) => {
      await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm, perc_gordura, dobras_mm, circunferencias) values
        (${T.tenantId}, ${p.id}, '2026-08-01', 80, 170, 30.5, '{"triceps": 20}', '{"cintura": 90}'),
        (${T.tenantId}, ${p.id}, '2026-09-01', 77, 170, 28.1, '{"triceps": 18}', '{"cintura": 86}')`);
      await tx.execute(sql`insert into exams (tenant_id, patient_id, data, titulo, valores) values (${T.tenantId}, ${p.id}, '2026-09-01', 'Glicemia', '[{"nome":"Glicose","valor":90,"unidade":"mg/dL","referencia":null}]')`);
      // A nota privada fica em consultation_notes (staff_only, US-016), não em consultations
      const [c] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${T.tenantId}, ${p.id}, '2026-09-01', 'Caminhar 30 min') returning id`)).rows;
      await tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${T.tenantId}, ${p.id}, ${c.id}, 'segredo da nutri')`);
    },
    app.db,
  );
  return { T, p };
}

describe('Minha evolução (US-044, D14)', () => {
  it('peso, IMC e circunferências; sem % de gordura (opção desligada), sem dobras e sem exames; orientações sem notas privadas', async () => {
    const { T, p } = await comAvaliacoes();
    const e = await evolucaoParaPaciente(ctxPaciente(T.tenantId, p.id), { mostrarPercGorduraPaciente: false }, app.db);
    expect(e.series.map((s) => s.id)).toEqual(['peso', 'imc', 'circ_cintura']);
    expect(e.diferencas.map((d) => d.rotulo)).not.toContain('% de gordura');
    expect(e.orientacoes).toEqual([{ data: '2026-09-01', orientacoes: 'Caminhar 30 min' }]);
    expect(JSON.stringify(e)).not.toMatch(/Glicose|segredo|triceps/);
  });

  it('com "Mostrar % de gordura ao paciente" ligada, a série aparece', async () => {
    const { T, p } = await comAvaliacoes();
    const e = await evolucaoParaPaciente(ctxPaciente(T.tenantId, p.id), { mostrarPercGorduraPaciente: true }, app.db);
    expect(e.series.map((s) => s.id)).toContain('perc_gordura');
  });

  it('só em sessão de paciente', async () => {
    const { T } = await comAvaliacoes();
    await expect(evolucaoParaPaciente(T.ctx, { mostrarPercGorduraPaciente: false }, app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
