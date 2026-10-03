import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { caminhoAte, grafoDeImports, raizesDoNext } from '../../../test/grafo-de-imports';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { textoDoPdf } from '../../../test/pdf';
import { closeDb } from '@/db/client';
import { auditLog, consents, dataExports, exams, notifications, patients, pushSubscriptions, storedFiles, tenants, user } from '@/db/schema';
import { idTaco } from '@/modules/alimentos/taco';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { buscarModelo, preencherAnamnese, salvarModelo } from './anamnese';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { registrarAtendimento } from './atendimentos';
import { salvarEtiquetasDoPaciente } from './etiquetas';
import { criarExame } from './exames';
import {
  estadoDaExportacao,
  exportacoesRecentes,
  MSG_EXPORTACAO,
  solicitarExportacao,
} from './exportacao';
import {
  expirarExportacao,
  expirarExportacoesVencidas,
  gerarExportacao,
  montarDados,
} from './exportacao-job';
import { paraWinAnsi, renderizarProntuario } from './prontuario-pdf';
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
/** Tarefa 15: o que nunca sai no dados.json — o motivo que só a nutricionista vê e os dados técnicos de envio. */
const MOTIVO_DA_NUTRI = 'paciente difícil, cobrar antes';
const JID = '5511912345678@s.whatsapp.net';
const SELADO = 'conteudo-selado-de-teste';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/token-secreto-do-aparelho';

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
    const { id: planId } = await criarRascunho(T.ctx, p.id, { db: app.db });
    await salvarRascunho(T.ctx, planId, {
      revisao: 0, envio: randomUUID(), titulo: 'Plano alimentar', metaKcal: '', mostrarCalorias: false, orientacoes: '',
      refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
    }, { db: app.db });
    // Tarefa 15: agenda, lembretes, aceites do termo e dispositivos de push do titular
    const MSG_ID = `ID-DA-EVOLUTION-${randomUUID()}`; // rodada 1: provider_msg_id é UNIQUE no banco compartilhado pelos testes
    const inicio = new Date('2026-09-15T12:00:00Z');
    const consulta = await consultaDireta(app.db, T.ctx, p.id, inicio, 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: now, motivoCancelamento: MOTIVO_DA_NUTRI });
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-20T12:00:00Z'), 60, { status: 'cancelada', canceladoPor: 'paciente', canceladaEm: now, motivoCancelamento: 'Remarcada pelo paciente', origem: 'paciente' });
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({
      tenantId: T.tenantId, patientId: p.id, appointmentId: consulta, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', status: 'enviada',
      agendadaPara: new Date('2026-09-14T12:00:00Z'), enviadaEm: new Date('2026-09-14T12:00:01Z'), providerJid: JID, providerMsgId: MSG_ID,
    }), app.db);
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, canal: 'whatsapp', tipo: 'convite_paciente', status: 'pendente', agendadaPara: now, conteudoSelado: SELADO }), app.db);
    const uid = randomUUID();
    const outroConsultorio = await novoTenant(app.db);
    await app.db.insert(user).values({ id: uid, name: 'Ana', email: `conta-${uid.slice(0, 8)}@ex.com`, appRole: 'paciente' });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ userId: uid }).where(eq(patients.id, p.id)), app.db);
    await app.db.insert(consents).values([
      { tenantId: T.tenantId, patientId: p.id, termoVersao: 'termo-v1', aceitoEm: new Date('2026-09-01T12:00:00Z'), ip: '198.51.100.7' }, // página pública
      { userId: uid, tenantId: T.tenantId, termoVersao: 'termo-v0', aceitoEm: new Date('2026-08-01T12:00:00Z'), ip: null }, // pela conta, neste consultório
      { userId: uid, tenantId: outroConsultorio.tenantId, termoVersao: 'termo-v0', aceitoEm: new Date('2026-08-02T12:00:00Z'), ip: '198.51.100.99' }, // outro consultório: não sai
    ]);
    await withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: p.id, endpoint: ENDPOINT, p256dh: 'P'.repeat(87), auth: 'A'.repeat(22), userAgent: 'Firefox 131', createdAt: new Date('2026-09-02T12:00:00Z') }), app.db);
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
    const leituras = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.acao, 'ler'),
              eq(auditLog.entidade, 'exportacoes'),
              eq(auditLog.entidadeId, id),
            ),
          ),
      app.db,
    );
    expect(leituras).toHaveLength(1); // abrir o link com o ZIP pronto fica no "Histórico de acessos" (regra 8)
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
    expect(dados.planos).toEqual([
      { versao: 1, status: 'rascunho', titulo: 'Plano alimentar', publicadoEm: null, metaKcal: null, orientacoes: '',
        refeicoes: [{ nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ alimento: 'Arroz, tipo 1, cozido', quantidadeG: 100, medida: null, substituiDe: null }] }] },
    ]);
    expect(dados.consultas).toEqual([
      { inicio: '2026-09-15T12:00:00.000Z', fim: '2026-09-15T13:00:00.000Z', modalidade: 'presencial', status: 'cancelada', origem: 'nutri', canceladoPor: 'nutri', motivoCancelamento: null },
      { inicio: '2026-09-20T12:00:00.000Z', fim: '2026-09-20T13:00:00.000Z', modalidade: 'presencial', status: 'cancelada', origem: 'paciente', canceladoPor: 'paciente', motivoCancelamento: 'Remarcada pelo paciente' },
    ]);
    expect(dados.lembretes).toEqual([
      { tipo: 'lembrete_24h', canal: 'whatsapp', status: 'enviada', agendadaPara: '2026-09-14T12:00:00.000Z', enviadaEm: '2026-09-14T12:00:01.000Z', motivoNaoEnviado: null },
      { tipo: 'convite_paciente', canal: 'whatsapp', status: 'pendente', agendadaPara: now.toISOString(), enviadaEm: null, motivoNaoEnviado: null },
    ]);
    expect(dados.aceitesDoTermo).toEqual([
      { termoVersao: 'termo-v0', aceitoEm: '2026-08-01T12:00:00.000Z', ip: null },
      { termoVersao: 'termo-v1', aceitoEm: '2026-09-01T12:00:00.000Z', ip: '198.51.100.7' },
    ]);
    expect(dados.dispositivosPush).toEqual([{ criadaEm: '2026-09-02T12:00:00.000Z', navegador: 'Firefox 131' }]);
    for (const segredo of ['198.51.100.99', MOTIVO_DA_NUTRI, JID, MSG_ID, SELADO, ENDPOINT, 'P'.repeat(87), 'A'.repeat(22)]) expect(json).not.toContain(segredo);
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

  it('os laudos dos exames vão no ZIP, em laudos/, com o nome ligado ao exame no dados.json e no PDF', async () => {
    const { T, p } = await prontuarioCompleto();
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500, 7)]);
    await criarExame(
      T.ctx,
      T.tenant,
      p.id,
      { titulo: 'Hemograma', data: '2026-09-10', valores: [], arquivo: PDF },
      deps,
    );
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: id },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('pronta');
    const estado = await estadoDaExportacao(T.ctx, p.id, id, app.db, now);
    if (estado.estado !== 'pronta') throw new Error(estado.estado);
    const zip = unzipSync(readFileSync(path.join(dataDir, estado.caminho)));
    expect(Object.keys(zip).sort()).toEqual([
      'dados.json',
      'laudos/2026-09-10-02.pdf',
      'prontuario.pdf',
    ]);
    expect(Buffer.from(zip['laudos/2026-09-10-02.pdf']).equals(PDF)).toBe(true);
    const dados = JSON.parse(strFromU8(zip['dados.json']));
    expect(
      dados.exames.map((e: { titulo: string; laudo: string | null }) => [e.titulo, e.laudo]),
    ).toEqual([
      ['Rotina', null],
      ['Hemograma', 'laudos/2026-09-10-02.pdf'],
    ]);
    expect(dados.laudosForaDoZip).toBe(false);
  });

  it('laudos acima do teto de memória ou sumidos do disco ficam de fora, com aviso — a exportação não falha', async () => {
    const { T, p } = await prontuarioCompleto();
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]);
    await criarExame(
      T.ctx,
      T.tenant,
      p.id,
      { titulo: 'Hemograma', data: '2026-09-10', valores: [], arquivo: PDF },
      deps,
    );
    await criarExame(
      T.ctx,
      T.tenant,
      p.id,
      { titulo: 'Lipidograma', data: '2026-09-20', valores: [], arquivo: PDF },
      deps,
    );
    const cabe = await solicitarExportacao(T.ctx, p.id, deps);
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: cabe },
        { ...deps, ultimaTentativa: false, limiteLaudosBytes: PDF.length + 10 },
      ),
    ).toBe('pronta');
    const e0 = await estadoDaExportacao(T.ctx, p.id, cabe, app.db, now);
    if (e0.estado !== 'pronta') throw new Error(e0.estado);
    const d0 = JSON.parse(
      strFromU8(unzipSync(readFileSync(path.join(dataDir, e0.caminho)))['dados.json']),
    );
    expect(d0.exames.map((e: { laudo: string | null }) => e.laudo)).toEqual([
      null,
      'laudos/2026-09-10-02.pdf',
      null,
    ]); // entram os que cabem, em ordem
    expect(d0.laudosForaDoZip).toBe(true);

    const grande = await solicitarExportacao(T.ctx, p.id, deps);
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: grande },
        { ...deps, ultimaTentativa: false, limiteLaudosBytes: 100 },
      ),
    ).toBe('pronta');
    const e1 = await estadoDaExportacao(T.ctx, p.id, grande, app.db, now);
    if (e1.estado !== 'pronta') throw new Error(e1.estado);
    const z1 = unzipSync(readFileSync(path.join(dataDir, e1.caminho)));
    expect(Object.keys(z1).sort()).toEqual(['dados.json', 'prontuario.pdf']);
    const d1 = JSON.parse(strFromU8(z1['dados.json']));
    expect(d1.laudosForaDoZip).toBe(true);
    expect(d1.exames[1]).toMatchObject({ titulo: 'Hemograma', temLaudo: true, laudo: null });

    const [exame] = await withTenant(
      T.ctx,
      (tx) => tx.select().from(exams).where(eq(exams.titulo, 'Hemograma')),
      app.db,
    );
    rmSync(path.join(dataDir, exame.arquivoPath!));
    const sumido = await solicitarExportacao(T.ctx, p.id, {
      ...deps,
      now: new Date(now.getTime() + 31 * 60_000),
    });
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: sumido },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('pronta');
    const e2 = await estadoDaExportacao(T.ctx, p.id, sumido, app.db, now);
    if (e2.estado !== 'pronta') throw new Error(e2.estado);
    const d2 = JSON.parse(
      strFromU8(unzipSync(readFileSync(path.join(dataDir, e2.caminho)))['dados.json']),
    );
    expect(d2.exames[1]).toMatchObject({ temLaudo: true, laudo: null });
  });

  it('só um ZIP válido por paciente: o novo pronto apaga o anterior (e devolve a cota)', async () => {
    const { T, p } = await prontuarioCompleto();
    const primeiro = await solicitarExportacao(T.ctx, p.id, deps);
    await gerarExportacao(
      { tenantId: T.tenantId, exportId: primeiro },
      { ...deps, ultimaTentativa: false },
    );
    const segundo = await solicitarExportacao(T.ctx, p.id, deps);
    expect(segundo).not.toBe(primeiro);
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: segundo },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('pronta');
    expect(await estadoDaExportacao(T.ctx, p.id, primeiro, app.db, now)).toEqual({
      estado: 'expirada',
    });
    expect((await estadoDaExportacao(T.ctx, p.id, segundo, app.db, now)).estado).toBe('pronta');
    expect(await exportacoesRecentes(T.ctx, p.id, app.db, now)).toHaveLength(2);
    const lista = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.patientId, p.id),
              eq(auditLog.acao, 'ler'),
              eq(auditLog.entidade, 'exportacoes'),
            ),
          ),
      app.db,
    );
    expect(lista.filter((l) => l.entidadeId === null)).toHaveLength(1); // a lista da aba Privacidade também fica no histórico (regra 8)
    const zips = await withTenant(
      T.ctx,
      (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')),
      app.db,
    );
    expect(zips).toHaveLength(1);
    expect(
      (await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0].armazenamentoBytes,
    ).toBe(zips[0].bytes);
  });

  it('cota esgotada não barra a exportação (obrigação legal, LGPD art. 18): o ZIP é gerado e conta na cota', async () => {
    const { T, p } = await prontuarioCompleto();
    await app.db
      .update(tenants)
      .set({ armazenamentoBytes: COTA_BYTES })
      .where(eq(tenants.id, T.tenantId));
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: id },
        { ...deps, ultimaTentativa: false },
      ),
    ).toBe('pronta');
    expect(
      (await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0].armazenamentoBytes,
    ).toBeGreaterThan(COTA_BYTES);
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
    expect((await exportacoesRecentes(T.ctx, p.id, app.db, now))[0].status).toBe('pronta');
    expect(
      (await exportacoesRecentes(T.ctx, p.id, app.db, new Date('2026-10-02T15:00:01Z')))[0].status,
    ).toBe('expirada'); // a lista diz o mesmo que a página
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

  it('paciente anonimizado enquanto o job montava o ZIP: nada é gravado e o pedido vira "falhou"', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    const anonimizaNoMeio = async (...args: Parameters<typeof renderizarProntuario>) => {
      await withTenant(
        T.ctx,
        (tx) =>
          tx
            .update(patients)
            .set({ status: 'bloqueado', anonimizadoEm: now })
            .where(eq(patients.id, p.id)),
        app.db,
      );
      return renderizarProntuario(...args);
    };
    expect(
      await gerarExportacao(
        { tenantId: T.tenantId, exportId: id },
        { ...deps, ultimaTentativa: false, renderizar: anonimizaNoMeio },
      ),
    ).toBe('falhou');
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'falhou' });
    expect(
      await withTenant(
        T.ctx,
        (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')),
        app.db,
      ),
    ).toEqual([]);
  });

  it('paciente já anonimizado: o pedido é recusado (não há identificação a devolver) e nada vai para a fila', async () => {
    const { T, p } = await prontuarioCompleto();
    await withTenant(
      T.ctx,
      (tx) =>
        tx
          .update(patients)
          .set({ status: 'bloqueado', anonimizadoEm: now })
          .where(eq(patients.id, p.id)),
      app.db,
    );
    await expect(solicitarExportacao(T.ctx, p.id, deps)).rejects.toThrow(
      MSG_EXPORTACAO.anonimizado,
    );
    expect(
      await withTenant(
        T.ctx,
        (tx) => tx.select().from(dataExports).where(eq(dataExports.patientId, p.id)),
        app.db,
      ),
    ).toEqual([]);
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

  it('PDF: anamnese e exame longos quebram entre páginas em vez de sumir além do A4', async () => {
    const respostas = Array.from({ length: 60 }, (_, i) => ({
      pergunta: `Pergunta ${i + 1}`,
      resposta: 'resposta longa '.repeat(8),
    }));
    const valores = Array.from({ length: 60 }, (_, i) => ({
      nome: `Marcador ${i + 1}`,
      valor: i,
      unidade: 'mg/dL',
      referencia: null,
    }));
    const pdf = await renderizarProntuario(
      {
        versao: 1,
        geradoEm: now.toISOString(),
        dataEmissao: '2026-10-01',
        paciente: {
          nome: 'Ana Souza',
          dataNascimento: '1991-03-10',
          sexo: 'F',
          email: 'ana@ex.com',
          telefone: null,
          status: 'ativo',
          cadastradoEm: now.toISOString(),
        },
        anamneses: [{ data: '2026-09-01', modelo: 'Longa', respostas }],
        antropometria: [],
        gastoEnergetico: [],
        exames: [{ data: '2026-09-01', titulo: 'Painel', temLaudo: false, laudo: null, valores }],
        atendimentos: [],
        planos: [],
        pedidosLgpd: [],
        consultas: [],
        lembretes: [],
        aceitesDoTermo: [],
        dispositivosPush: [],
        laudosForaDoZip: false,
      },
      'Debby Silva',
    );
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('apagar a conta de quem pediu a exportação não esbarra na auditoria (solicitado_por sem FK, como o ator do audit_log)', async () => {
    const { T, p } = await prontuarioCompleto();
    await solicitarExportacao(T.ctx, p.id, deps);
    await expect(app.db.delete(user).where(eq(user.id, T.nutriId))).resolves.toBeDefined();
  });

  it('dados.json: "Sim"/"Não" só nas perguntas sim/não — texto livre sai como foi digitado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const modelo = await salvarModelo(
      T.ctx,
      null,
      {
        nome: 'Hábitos',
        perguntas: [
          { tipo: 'sim_nao', rotulo: 'Fuma', obrigatoria: false },
          { tipo: 'texto_curto', rotulo: 'Observação', obrigatoria: false },
          { tipo: 'numero', rotulo: 'Peso habitual', obrigatoria: false, unidade: 'kg' },
        ],
      },
      app.db,
    );
    const [fuma, obs, peso] = (await buscarModelo(T.ctx, modelo, app.db))!.schema.perguntas;
    await preencherAnamnese(
      T.ctx,
      T.tenant,
      p.id,
      modelo,
      { [fuma.id]: 'nao', [obs.id]: 'nao', [peso.id]: '70,5' },
      deps,
    );
    const { dados } = await withTenant(
      T.ctx,
      (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo'),
      app.db,
    );
    expect(dados.anamneses[0].respostas).toEqual([
      { pergunta: 'Fuma', resposta: 'Não' },
      { pergunta: 'Observação', resposta: 'nao' },
      { pergunta: 'Peso habitual', resposta: '70,5 kg' }, // número com a unidade da pergunta
    ]);
  });

  it('PDF: circunferências, dobras com o protocolo e pedidos do titular aparecem; números no formato da tela, sem notação exponencial', async () => {
    const pdf = await renderizarProntuario(
      {
        versao: 1,
        geradoEm: now.toISOString(),
        dataEmissao: '2026-10-01',
        paciente: {
          nome: 'Ana Souza',
          dataNascimento: '1991-03-10',
          sexo: 'F',
          email: 'ana@ex.com',
          telefone: null,
          status: 'ativo',
          cadastradoEm: now.toISOString(),
        },
        anamneses: [],
        antropometria: [
          {
            data: '2026-09-01',
            pesoKg: 60.5,
            alturaCm: 165,
            imc: 22.22,
            percGordura: 24.44,
            protocolo: 'jp7',
            circunferencias: { coxa: 50, cintura: 80.5 },
            dobrasMm: { triceps: 12 },
          },
        ],
        gastoEnergetico: [],
        exames: [
          {
            data: '2026-09-01',
            titulo: 'Traço',
            temLaudo: false,
            laudo: null,
            valores: [{ nome: 'Marcador', valor: 0.0000001, unidade: 'mg/L', referencia: null }],
          },
        ],
        atendimentos: [],
        planos: [],
        pedidosLgpd: [
          {
            tipo: 'exportacao',
            status: 'concluido',
            prazo: '2026-10-16',
            concluidoEm: '2026-10-01T15:00:00.000Z',
          },
        ],
        consultas: [],
        lembretes: [],
        aceitesDoTermo: [],
        dispositivosPush: [],
        laudosForaDoZip: false,
      },
      'Debby Silva',
    );
    const texto = textoDoPdf(pdf);
    for (const t of [
      'JP 7 dobras',
      'Cintura 80,5 cm · Coxa 50 cm',
      'Tríceps 12 mm',
      'Pedidos do titular (LGPD)',
      'Exportação',
      'prazo 16/10/2026',
      'peso 60,50 kg',
    ])
      expect(texto).toContain(t);
    expect(texto).not.toMatch(/\de-\d/);
  });

  it('PDF: caracteres fora do WinAnsi da Helvetica viram equivalentes, nunca outro caractere em silêncio', () => {
    expect(paraWinAnsi('≥ 40 mg/dL · ≤ 99 · −3,2 kg')).toBe('>= 40 mg/dL · <= 99 · -3,2 kg');
    expect(paraWinAnsi('ação – “ok” 😀')).toBe('ação – “ok” ?');
  });

  it('o PDF e o ZIP ficam fora do grafo do Next: nada de src/app (nem proxy, instrumentation, next.config) alcança exportacao-job, prontuario-pdf, plano-pdf ou @react-pdf, direta ou indiretamente', () => {
    // R11 (T13): o mesmo grafo transitivo da guarda do push (test/grafo-de-imports.ts), em vez da busca por texto nos imports diretos
    const g = grafoDeImports(raizesDoNext());
    expect(g.arquivos.has('src/modules/pacientes/exportacao.ts'), 'o grafo anda de verdade (a tela de privacidade pede a exportação)').toBe(true);
    for (const proibido of ['src/modules/pacientes/exportacao-job.ts', 'src/modules/pacientes/prontuario-pdf.tsx', 'src/modules/plano-alimentar/plano-pdf.tsx', 'src/modules/plano-alimentar/plano-pdf-job.ts']) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    for (const pacote of ['@react-pdf/renderer', 'fflate']) expect(g.pacotes.get(pacote), `${pacote} importado (no grafo do Next) por`).toBeUndefined();
  });
});
