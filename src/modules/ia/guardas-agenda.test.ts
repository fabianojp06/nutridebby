import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { caminhoAte, fontesDe, grafoDeImports } from '../../../test/grafo-de-imports';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { montarPedidoDoResumo } from './resumo-dados';

/**
 * Plano 23 (RN-439): nada da agenda nova entra em contexto de IA — locais, aniversário, previsão de retorno e pedido. Guarda
 * por grafo (também por caminho indireto, como a do Financeiro, RN-323) e guarda de texto: nenhum arquivo de
 * src/modules/ia/** cita a coluna da previsão. A coluna é montada aqui para este arquivo não a conter escrita.
 */
const PROIBIDOS = ['locais', 'aniversarios', 'retorno', 'solicitacoes'].map((m) => `src/modules/agenda/${m}.ts`);
const COLUNA = ['retorno', 'previsto'].join('_');
const CAMPO = ['retorno', 'Previsto'].join('');

describe('RN-439: a agenda nova fica fora da IA', () => {
  const raizes = fontesDe('src/modules/ia');
  const g = grafoDeImports(raizes);

  it('o grafo anda de verdade (a IA alcança o banco e outros módulos)', () => {
    expect(raizes.length).toBeGreaterThan(10);
    expect(g.arquivos.has('src/db/tenant.ts')).toBe(true);
  });

  it('nenhum arquivo alcançável a partir de src/modules/ia/** é locais.ts, aniversarios.ts, retorno.ts ou solicitacoes.ts', () => {
    const alcancados = PROIBIDOS.filter((p) => g.arquivos.has(p));
    expect(alcancados.map((p) => caminhoAte(g, p).join(' → '))).toEqual([]);
  });

  it('nenhum arquivo de src/modules/ia/** (testes incluídos) contém a coluna da previsão de retorno nem o campo dela', () => {
    const arquivos = readdirSync('src/modules/ia', { recursive: true, encoding: 'utf8' })
      .map((f) => path.join('src/modules/ia', f))
      .filter((f) => /\.(tsx?|jsx?|mjs|cjs|sql|md|txt)$/.test(f));
    expect(arquivos.length).toBeGreaterThan(10);
    const comTexto = arquivos.filter((f) => {
      const fonte = readFileSync(f, 'utf8');
      return fonte.includes(COLUNA) || fonte.includes(CAMPO);
    });
    expect(comTexto).toEqual([]);
  });

  it('os quatro módulos proibidos existem (a guarda não passa por um nome errado)', () => {
    // desde a T10, os quatro existem
    const existentes = PROIBIDOS.filter((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
    expect(existentes).toEqual(PROIBIDOS);
  });
});

describe('RN-439: a previsão de retorno não sai no resumo da IA', () => {
  const app = makeDb(inject('appDatabaseUrl'));
  afterAll(() => app.pool.end());

  it('o pedido do resumo (dados, fontes e tabela) de um paciente com atendimento com previsão não tem a data da previsão', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const w = { tenantId: T.tenantId, role: 'worker' as const };
    // a coluna pelo nome montado (este arquivo não a contém escrita)
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente, ${sql.raw(`${COLUNA}_em`)})
          values (${T.tenantId}, ${p.id}, '2026-11-01', 'Caminhar 30 minutos por dia.', '2026-12-17')`),
      app.db,
    );
    const pedido = await withTenant(
      w,
      async (tx) => {
        const [linha] = await tx.select().from(patients).where(eq(patients.id, p.id));
        return montarPedidoDoResumo(tx, linha, { notasPrivadas: true, agora: new Date('2026-11-20T15:00:00Z'), fuso: 'America/Sao_Paulo' });
      },
      app.db,
    );
    const tudo = JSON.stringify(pedido);
    expect(JSON.stringify(pedido.dados)).toContain('Caminhar 30 minutos'); // controle: o atendimento entrou no resumo
    expect(tudo).not.toMatch(/2026-12-17|17\/12\/2026|17\/12/);
    expect(tudo).not.toContain(CAMPO);
  });
});
