import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, dataExports, storedFiles, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { buscarModelo, preencherAnamnese, salvarModelo } from './anamnese';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { registrarAtendimento } from './atendimentos';
import { salvarEtiquetasDoPaciente } from './etiquetas';
import { criarExame } from './exames';
import { estadoDaExportacao, solicitarExportacao } from './exportacao';
import { expirarExportacao, expirarExportacoesVencidas, gerarExportacao } from './exportacao-job';
import { paraWinAnsi } from './prontuario-pdf';
import { anexosDoPaciente } from './lgpd';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-export-'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, dataDir, appUrl: 'http://localhost:3000' };
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const NOTA = 'suspeita de compulsão';

async function prontuarioCompleto() {
  const T = await novoTenant(app.db, 'Debby Silva');
  const p = await novoPaciente(app.db, T.ctx);
  const modelo = await salvarModelo(
    T.ctx,
    null,
    {
      nome: 'Consulta',
      perguntas: [{ tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: false }],
    },
    app.db,
  );
  const [pergunta] = (await buscarModelo(T.ctx, modelo, app.db))!.schema.perguntas;
  await preencherAnamnese(T.ctx, T.tenant, p.id, modelo, { [pergunta.id]: 'Lactose' }, deps);
  await registrarAntropometria(
    T.ctx,
    T.tenant,
    p.id,
    entradaDoFormulario({ data: '2026-09-01', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }),
    deps,
  );
  await criarExame(
    T.ctx,
    T.tenant,
    p.id,
    {
      titulo: 'Rotina',
      data: '2026-09-01',
      valores: [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL' }],
      arquivo: null,
    },
    deps,
  );
  await registrarAtendimento(
    T.ctx,
    T.tenant,
    p.id,
    { data: '2026-09-01', notasPrivadas: NOTA, orientacoes: 'beber 2 L de água/dia' },
    deps,
  );
  await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'etiqueta-secreta' }, app.db);
  return { T, p };
}

describe('exportar dados do paciente (US-018 "Exportar")', () => {
  it('pedir registra "exportar" no audit_log e põe o job na fila; pedir de novo enquanto gera não duplica', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    expect(await solicitarExportacao(T.ctx, p.id, deps)).toBe(id);
    const log = await withTenant(
      T.ctx,
      (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'exportar')),
      app.db,
    );
    expect(log.filter((l) => l.patientId === p.id)).toHaveLength(1);
    expect(log.find((l) => l.patientId === p.id)).toMatchObject({
      entidade: 'patients',
      actorUserId: T.nutriId,
    });
    const jobs = await (
      await getBoss()
    ).findJobs<{ tenantId: string; exportId: string }>('exportacao-paciente');
    expect(jobs.filter((j) => j.data.exportId === id)).toHaveLength(1);
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'pendente' });
  });

  it('o job gera o ZIP com dados.json e prontuario.pdf — sem notas privadas nem etiquetas — e manda o link de 24 h por e-mail', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: id },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('pronta');
    const estado = await estadoDaExportacao(T.ctx, p.id, id, app.db, now);
    if (estado.estado !== 'pronta') throw new Error(estado.estado);
    expect(estado.expiraEm.toISOString()).toBe('2026-10-02T15:00:00.000Z');
    expect(estado.caminho).toMatch(new RegExp(`^${T.tenantId}/exportacao/[0-9a-f-]{36}\\.zip$`));
    const zip = unzipSync(readFileSync(path.join(dataDir, estado.caminho)));
    expect(Object.keys(zip).sort()).toEqual(['dados.json', 'prontuario.pdf']);
    expect(strFromU8(zip['prontuario.pdf'].subarray(0, 5))).toBe('%PDF-');
    const json = strFromU8(zip['dados.json']);
    const dados = JSON.parse(json);
    expect(dados.paciente).toMatchObject({ nome: 'Ana Souza', dataNascimento: '1991-03-10' });
    expect(dados.anamneses[0].respostas).toEqual([{ pergunta: 'Alergias', resposta: 'Lactose' }]);
    expect(dados.atendimentos).toEqual([
      { data: '2026-09-01', orientacoes: 'beber 2 L de água/dia' },
    ]);
    expect(dados.exames[0].valores[0]).toMatchObject({ nome: 'Glicemia de jejum', valor: 95 });
    expect(json).not.toContain(NOTA); // US-016
    expect(json).not.toContain('etiqueta-secreta'); // US-019
    const [nutri] = await app.db.select().from(user).where(eq(user.id, T.nutriId));
    const [msg] = await emailsNaFila('exportacao_pronta', nutri.email);
    expect(msg.link).toBe(`http://localhost:3000/painel/pacientes/${p.id}/exportacoes/${id}`);
    const expirar = (
      await (await getBoss()).findJobs<{ exportId: string }>('expirar-exportacao')
    ).filter((j) => j.data.exportId === id);
    expect(expirar).toHaveLength(1);
    expect(await withTenant(T.ctx, (tx) => anexosDoPaciente(tx, p.id), app.db)).toContain(
      estado.caminho,
    ); // a anonimização apaga
    // rodar de novo (retry do pg-boss) não gera outro ZIP
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: id },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('ignorada');
    expect(
      await withTenant(
        T.ctx,
        (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')),
        app.db,
      ),
    ).toHaveLength(1);
  });

  it('24 h depois o arquivo some e o link diz que expirou; a cota volta', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await gerarExportacao(
      { tenantId: T.tenantId, exportId: id },
      { ...deps, ultimaTentativa: false },
    );
    expect(
      await estadoDaExportacao(T.ctx, p.id, id, app.db, new Date('2026-10-02T15:00:01Z')),
    ).toEqual({ estado: 'expirada' });
    await expirarExportacao({ tenantId: T.tenantId, exportId: id }, { db: app.db, dataDir });
    const [e] = await withTenant(
      T.ctx,
      (tx) => tx.select().from(dataExports).where(eq(dataExports.id, id)),
      app.db,
    );
    expect(e).toMatchObject({ status: 'expirada', arquivoPath: null });
    expect(readdirSync(path.join(dataDir, T.tenantId, 'exportacao'))).toEqual([]);
    expect(
      (await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0].armazenamentoBytes,
    ).toBe(0);
  });

  it('tenant suspenso: o job não gera nada (RN-15) e o pedido vira "falhou"; reativado, pedir de novo cria outro job', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: id },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('ignorada');
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'falhou' });
    expect(
      await withTenant(
        T.ctx,
        (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')),
        app.db,
      ),
    ).toEqual([]);
    await app.db.update(tenants).set({ status: 'ativa' }).where(eq(tenants.id, T.tenantId));
    const novo = await solicitarExportacao(T.ctx, p.id, deps);
    expect(novo).not.toBe(id);
    const jobs = await (await getBoss()).findJobs<{ exportId: string }>('exportacao-paciente');
    expect(jobs.filter((j) => j.data.exportId === novo)).toHaveLength(1);
  });

  it('falha na última tentativa marca "falhou" e não deixa ZIP nem cota', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    const quebrado = {
      ...deps,
      ultimaTentativa: true,
      renderizar: async () => Promise.reject(new Error('pdf quebrou')),
    };
    expect(await gerarExportacao({ tenantId: T.tenantId, exportId: id }, quebrado)).toBe('falhou');
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'falhou' });
    expect(
      (await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0].armazenamentoBytes,
    ).toBe(0);
  });

  it('pendente há mais de 30 min (job perdido) não prende o paciente: pedir de novo cria outro', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    const depois = { ...deps, now: new Date(now.getTime() + 31 * 60_000) };
    const novo = await solicitarExportacao(T.ctx, p.id, depois);
    expect(novo).not.toBe(id);
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, depois.now)).toEqual({
      estado: 'falhou',
    });
  });

  it('varredura diária: pronta vencida perde o ZIP mesmo sem o job de expiração; pendente de ontem vira "falhou"', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await gerarExportacao(
      { tenantId: T.tenantId, exportId: id },
      { ...deps, ultimaTentativa: false },
    );
    const esquecido = await solicitarExportacao(
      T.ctx,
      (await novoPaciente(app.db, T.ctx)).id,
      deps,
    );
    const r = await expirarExportacoesVencidas(app.db, new Date('2026-10-02T15:00:01Z'), {
      dataDir,
    });
    expect(r.expiradas).toBeGreaterThanOrEqual(1);
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'expirada' });
    expect(
      await withTenant(
        T.ctx,
        (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')),
        app.db,
      ),
    ).toEqual([]);
    const [e] = await withTenant(
      T.ctx,
      (tx) => tx.select().from(dataExports).where(eq(dataExports.id, esquecido)),
      app.db,
    );
    expect(e.status).toBe('falhou');
  });

  it('PDF: caracteres fora do WinAnsi da Helvetica viram equivalentes, nunca outro caractere em silêncio', () => {
    expect(paraWinAnsi('≥ 40 mg/dL · ≤ 99 · −3,2 kg')).toBe('>= 40 mg/dL · <= 99 · -3,2 kg');
    expect(paraWinAnsi('ação – “ok” 😀')).toBe('ação – “ok” ?');
  });

  it('o PDF e o ZIP ficam fora do grafo do Next: nenhuma rota importa exportacao-job ou @react-pdf', () => {
    const arquivos = readdirSync(path.resolve('src/app'), {
      recursive: true,
      withFileTypes: true,
    }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name));
    for (const d of arquivos)
      expect(readFileSync(path.join(d.parentPath, d.name), 'utf8'), d.name).not.toMatch(
        /exportacao-job|@react-pdf|prontuario-pdf/,
      );
  });
});
