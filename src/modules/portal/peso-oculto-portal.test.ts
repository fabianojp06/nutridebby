import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';
import { evolucaoParaPaciente } from './evolucao';
import { jornadaDoPaciente, miniJornadaDoPaciente } from './jornada';
import { muralDoPaciente } from './mural';
import { planoDoPaciente } from './plano';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

// Valores que só podem vir do peso (81,37 e 78,62 kg com 170 cm → IMC 28,16 e 27,20) e as formas como a tela os escreveria
const PESO_OU_IMC = /81[.,]37|81[.,]4|78[.,]62|78[.,]6|28[.,]16|28[.,]2|27[.,]2|\bkg\b|IMC|"peso"|"imc"|pesoKg/;
// Os horários ISO das respostas ("…T15:03:27.214Z") saem antes da comparação: ":27.2" e ":28.2" casariam com o IMC sem vazamento nenhum.
// Não serve um lookbehind de ":" no número: ele deixaria passar um número JSON como "valor":81.37.
const HORARIO_ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;
const semHorarios = (r: unknown) => JSON.stringify(r).replace(HORARIO_ISO, '');

describe('guarda do CS-194', () => {
  it('ignora horário ISO com ":27.2" ou ":28.2" e continua pegando o peso e o IMC escritos como número ou texto', () => {
    expect(semHorarios({ quando: new Date('2026-10-08T15:03:27.214Z'), outro: new Date('2026-10-08T15:04:28.231Z') })).not.toMatch(PESO_OU_IMC);
    for (const vazado of [{ valor: 81.37 }, { y: 27.2 }, { y: 28.16 }, { texto: 'IMC 27,2' }, { texto: '78,62 kg' }, { pesoKg: 1 }]) {
      expect(semHorarios(vazado), JSON.stringify(vazado)).toMatch(PESO_OU_IMC);
    }
  });
});

describe('CS-194: com "Não mostrar peso no app", nenhum módulo do portal devolve peso ou IMC (RN-203)', () => {
  it('mural, jornada, mini-jornada, "Todas as medidas" e o plano (a cópia offline) — a cintura continua', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: '12:30' }], mostrarCalorias: true });
    await consultaDireta(app.db, T.ctx, p.id, new Date(Date.now() + 26 * 3600_000));
    await withTenant(
      T.ctx,
      async (tx) => {
        const [c] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${T.tenantId}, ${p.id}, '2026-03-18', 'Beber água.') returning id`)).rows;
        await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, consultation_id, data, peso_kg, altura_cm, circunferencias) values
          (${T.tenantId}, ${p.id}, ${c.id}, '2026-03-18', 81.37, 170, '{"cintura": 92}'),
          (${T.tenantId}, ${p.id}, null, '2026-09-22', 78.62, 170, '{"cintura": 86}')`);
      },
      app.db,
    );
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    // segundo 27 e milissegundo 214: o horário ISO do mural ("…:27.214Z") traz ":27.2", que já confundiu a guarda com o IMC 27,2
    const agora = new Date();
    agora.setUTCSeconds(27, 214);
    const respostas = {
      mural: await muralDoPaciente(ctx, tenant, agora, app.db),
      jornada: await jornadaDoPaciente(ctx, tenant, agora, app.db),
      mini: await miniJornadaDoPaciente(ctx, tenant, agora, app.db),
      medidas: await evolucaoParaPaciente(ctx, tenant, app.db),
      plano: await planoDoPaciente(ctx, tenant.fuso, { db: app.db }),
    };
    for (const [nome, r] of Object.entries(respostas)) expect(semHorarios(r), nome).not.toMatch(PESO_OU_IMC);
    expect(JSON.stringify(respostas.jornada)).toContain('cintura 86 cm');
    expect(respostas.medidas.series.map((s) => s.id)).toEqual(['circ_cintura']);

    // desligar: o peso volta no próximo carregamento (US-195 "Desligar")
    await definirPesoOculto(T.ctx, p.id, false, { db: app.db });
    expect(JSON.stringify(await jornadaDoPaciente(ctx, tenant, agora, app.db))).toContain('78,62 kg');
  });
});
