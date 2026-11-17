import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { paginasDoPdf, textoDoPdf } from '../../../test/pdf';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPacienteParaEscrita, PacienteBloqueadoError } from '@/modules/pacientes/base';
import { anexosDoPaciente, anonimizarVencidos } from '@/modules/pacientes/lgpd';
import { COTA_BYTES, resolverCaminho } from '@/modules/plataforma/armazenamento';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { gTexto, totalDoDia } from './calculo';
import { carregarPlano } from './carregar';
import { PdfEmPreparoError, PlanoNaoEncontradoError } from './erros';
import { renderizarPlano } from './plano-pdf';
import { expirarPdfsPendentes, gerarPdfDoPlano } from './plano-pdf-job';
import { editarPublicado, pedirNovoPdf, publicarPlano } from './publicacao';
import { criarRascunho, criarRascunhoTx, salvarRascunho } from './rascunho';
import type { CorpoSalvamento, PlanoCompleto } from './tipos';

// Rodada 2 da T13: a varredura da anonimização (listarTenantsParaVarredura) só passa pelos tenants deste arquivo — os
// arquivos de teste rodam em paralelo no mesmo banco, cada um com o seu dataDir (implementação real por baixo)
vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
});

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const dataDir = process.env.DATA_DIR!;
const now = new Date('2026-10-01T15:00:00Z');
/** Anonimização (job retencao-lgpd) só destes tenants. */
const anonimizarSo = (...ts: TenantDeTeste[]) => {
  vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce(ts.map((t) => ({ id: t.tenantId, fuso: t.tenant.fuso })));
  return anonimizarVencidos(app.db, now, { dataDir });
};
const deps = { db: app.db, now };
const job = (T: TenantDeTeste, planId: string, extra: Partial<Parameters<typeof gerarPdfDoPlano>[1]> = {}) =>
  gerarPdfDoPlano({ tenantId: T.tenantId, planId }, { db: app.db, dataDir, now, ultimaTentativa: false, ...extra });

function conteudo(mostrarCalorias: boolean): CorpoSalvamento {
  const pao = randomUUID();
  return {
    revisao: 0, envio: randomUUID(), titulo: 'Plano de Ana', metaKcal: '2000', mostrarCalorias, orientacoes: 'Beber 2 litros de água por dia.',
    refeicoes: [
      { id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: 'Prato colorido', itens: [
        { id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 }, substituiItemId: null },
      ] },
      { id: randomUUID(), nome: 'Café da manhã', horario: '07:30', observacao: '', itens: [
        { id: pao, foodId: idTaco(53), quantidadeG: '50', medida: null, substituiItemId: null },
        { id: randomUUID(), foodId: idTaco(551), quantidadeG: '40', medida: null, substituiItemId: pao },
      ] },
    ],
  };
}

async function planoPublicado(T: TenantDeTeste, mostrarCalorias = false) {
  await app.db.update(tenants).set({ crn: 'CRN-3 12345' }).where(eq(tenants.id, T.tenantId));
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  await salvarRascunho(T.ctx, id, conteudo(mostrarCalorias), deps);
  await publicarPlano(T.ctx, p.id, id, deps);
  return { p, id };
}

describe('PDF do plano (US-026)', () => {
  it('"Geração na publicação": o worker grava o PDF e o pdf_path; rodar de novo não gera outro', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await planoPublicado(T);
    expect(await job(T, id)).toBe('pronto');
    const pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl).toMatchObject({ pdfStatus: 'pronto' });
    expect(pl!.pdfPath).toMatch(new RegExp(`^${T.tenantId}/plano_pdf/[0-9a-f-]{36}\\.pdf$`));
    expect(existsSync(resolverCaminho(dataDir, pl!.pdfPath!))).toBe(true);
    expect(await job(T, id)).toBe('ignorado');
    const anexos = await withTenant(T.ctx, (tx) => anexosDoPaciente(tx, p.id), app.db);
    expect(anexos).toContain(pl!.pdfPath); // anonimização (US-018) apaga o PDF do plano
  });

  it('"Conteúdo do PDF": nutricionista, CRN, paciente, data, refeições por horário, medida e gramas, substituição, orientações e fonte; sem calorias por padrão', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T);
    let pdf: Buffer | null = null;
    await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) });
    const texto = textoDoPdf(pdf!);
    for (const t of [
      'Debby Silva', 'CRN-3 12345', 'Paciente: Ana Souza', 'Data: 01/10/2026', 'Plano de Ana',
      'Café da manhã · 07:30', 'Almoço · 12:00', 'Pão, trigo, francês', '50 g',
      'Arroz, tipo 1, cozido', '4 colheres de sopa cheias (100 g)', 'ou Tapioca, com manteiga', 'Prato colorido',
      'Beber 2 litros de água por dia.', 'TACO 4', 'NEPA/UNICAMP',
    ]) expect(texto, t).toContain(t);
    expect(texto.indexOf('Café da manhã')).toBeLessThan(texto.indexOf('Almoço')); // por horário
    expect(texto).not.toContain('kcal');
    expect(texto).not.toContain('Proteína'); // totais nutricionais só com "Mostrar calorias ao paciente"
    expect(texto).not.toContain('Elaborado com apoio de IA'); // RN-117: o selo só no plano que nasceu do rascunho da IA
  });

  it('selo (RN-117, A-D13): o plano publicado a partir do rascunho da IA leva "Elaborado com apoio de IA e revisado pela nutricionista" logo depois do título', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ crn: 'CRN-3 12345' }).where(eq(tenants.id, T.tenantId));
    const p = await novoPaciente(app.db, T.ctx);
    const id = await withTenant(T.ctx, async (tx) => {
      await carregarPacienteParaEscrita(tx, p.id);
      return criarRascunhoTx(tx, T.tenantId, p.id, { iaOrigemEm: now });
    }, app.db);
    await salvarRascunho(T.ctx, id, conteudo(false), deps);
    await publicarPlano(T.ctx, p.id, id, deps);
    let pdf: Buffer | null = null;
    expect(await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) })).toBe('pronto');
    const texto = textoDoPdf(pdf!);
    expect(texto).toContain('Elaborado com apoio de IA e revisado pela nutricionista');
    expect(texto.indexOf('Plano de Ana')).toBeLessThan(texto.indexOf('Elaborado com apoio de IA'));
    expect(texto.indexOf('Elaborado com apoio de IA')).toBeLessThan(texto.indexOf('Paciente: Ana Souza'));
  });

  it('"Mostrar calorias ao paciente" marcado: totais por refeição e do dia', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T, true);
    let pdf: Buffer | null = null;
    await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) });
    const texto = textoDoPdf(pdf!);
    expect(texto).toContain('Total do dia: 278 kcal'); // arroz 128 + pão 150 (substituição fora)
    expect(texto).toContain('139 kcal');
    expect(texto).toContain('(-11 kcal)'); // tapioca 139 × pão 150: o "−" (U+2212) do cálculo sai como "-", WinAnsi não tem o glifo
    // US-026: com a opção marcada, os totais do dia incluem os macros (g, 1 casa, vírgula), só dos principais
    const pl = (await carregarPlano(T.ctx, id, app.db))!;
    const t = totalDoDia(pl.refeicoes.map((r) => ({ itens: r.itens })));
    expect(texto).toContain(`Proteína: ${gTexto(t.proteinaG)} g · Carboidrato: ${gTexto(t.carboidratoG)} g · Lipídio: ${gTexto(t.lipidioG)} g · Fibra: ${gTexto(t.fibraG)} g`);
    expect(texto).toMatch(/Proteína: \d+,\d g/);
  });

  it('sem kcal na TACO (substituição ou principal): o item mostra "—" e nenhuma diferença de kcal', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    const [leite, pao, leite2, pao2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const item = (i: string, foodId: string, g: string, sub: string | null) => ({ id: i, foodId, quantidadeG: g, medida: null, substituiItemId: sub });
    await salvarRascunho(T.ctx, id, {
      revisao: 0, envio: randomUUID(), titulo: 'Sem kcal', metaKcal: '', mostrarCalorias: true, orientacoes: '',
      refeicoes: [
        { id: randomUUID(), nome: 'Lanche A', horario: '10:00', observacao: '', itens: [item(pao, idTaco(53), '50', null), item(leite, idTaco(458), '200', pao)] }, // substituição sem kcal
        { id: randomUUID(), nome: 'Lanche B', horario: '16:00', observacao: '', itens: [item(leite2, idTaco(458), '200', null), item(pao2, idTaco(53), '50', leite2)] }, // principal sem kcal
      ],
    }, deps);
    await publicarPlano(T.ctx, p.id, id, deps);
    let pdf: Buffer | null = null;
    expect(await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) })).toBe('pronto');
    const texto = textoDoPdf(pdf!);
    expect(texto).toContain('ou Leite, de vaca, integral');
    expect(texto).toContain('ou Pão, trigo, francês');
    expect(texto).toContain('150 kcal'); // o pão continua com a própria kcal
    expect(texto).not.toMatch(/\([+-]\d+ kcal\)/); // nenhuma diferença (seria "-150" ou "+150": o item sem valor conta 0)
  });

  it('refeição maior que a página continua na página seguinte: nenhum item ou observação fica de fora', async () => {
    const itens = Array.from({ length: 60 }, (_, k) => ({
      id: randomUUID(), foodId: idTaco(1 + k), nome: `Alimento número ${k + 1}`, fonte: 'taco' as const, origem: 'TACO' as const,
      porCem: { kcal: 100, proteinaG: 1, carboidratoG: 1, lipidioG: 1, fibraG: 1 }, medidas: [],
      quantidadeG: 100, medida: null, medidaCaseiraTxt: null, substituiItemId: null,
    }));
    const plano: PlanoCompleto = {
      id: randomUUID(), patientId: randomUUID(), isTemplate: false, titulo: 'Plano grande', metaKcal: null, energyCalcId: null, status: 'publicado',
      versao: 1, revisao: 1, publicadoEm: now.toISOString(), mostrarCalorias: false, orientacoes: '', pdfStatus: 'pendente', pdfPath: null,
      refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: 'Observação no fim do almoço', itens }],
      origemIa: null,
      iaOrigemEm: null,
    };
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pdf = await renderizarPlano({ plano, nutricionista: { nome: 'Debby Silva', crn: null }, paciente: 'Ana Souza', data: '01/10/2026', cor: '#047857', logo: null });
      expect(paginasDoPdf(pdf)).toBeGreaterThanOrEqual(2);
      const texto = textoDoPdf(pdf);
      expect(texto).toContain('Alimento número 60');
      expect(texto).toContain('Observação no fim do almoço');
      expect(avisos).not.toHaveBeenCalled(); // o react-pdf avisa quando um bloco sem quebra passa da página (e corta)
    } finally {
      avisos.mockRestore();
    }
  });

  it('6 refeições e 40 itens: PDF em até 5 s de processamento', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    const refeicoes = Array.from({ length: 6 }, (_, r) => ({
      id: randomUUID(), nome: `Refeição ${r + 1}`, horario: `${String(7 + 2 * r).padStart(2, '0')}:00`, observacao: 'Observação da refeição',
      itens: Array.from({ length: r < 4 ? 7 : 6 }, (_, i) => ({ id: randomUUID(), foodId: idTaco(1 + ((r * 7 + i) % 597)), quantidadeG: '100', medida: null, substituiItemId: null })),
    }));
    await salvarRascunho(T.ctx, id, { revisao: 0, envio: randomUUID(), titulo: 'Grande', metaKcal: '', mostrarCalorias: true, orientacoes: '', refeicoes }, deps);
    await publicarPlano(T.ctx, p.id, id, deps);
    const t0 = performance.now();
    expect(await job(T, id)).toBe('pronto');
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('falhas: tenant suspenso e cota esgotada marcam "falhou"; erro na última tentativa marca "falhou"; antes disso a fila tenta de novo', async () => {
    const T1 = await novoTenant(app.db);
    const a = await planoPublicado(T1);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T1.tenantId));
    expect(await job(T1, a.id)).toBe('ignorado');
    expect((await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [a.id])).rows[0].pdf_status).toBe('falhou');

    const T2 = await novoTenant(app.db);
    const b = await planoPublicado(T2);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T2.tenantId));
    expect(await job(T2, b.id)).toBe('falhou');

    const T3 = await novoTenant(app.db);
    const c = await planoPublicado(T3);
    const quebra = async () => {
      throw new Error('falha no render');
    };
    await expect(job(T3, c.id, { renderizar: quebra })).rejects.toThrow('falha no render');
    expect((await carregarPlano(T3.ctx, c.id, app.db))?.pdfStatus).toBe('pendente');
    expect(await job(T3, c.id, { renderizar: quebra, ultimaTentativa: true })).toBe('falhou');
    // "Gerar o PDF de novo": volta a pendente e enfileira
    await pedirNovoPdf(T3.ctx, c.p.id, c.id, deps);
    expect((await carregarPlano(T3.ctx, c.id, app.db))?.pdfStatus).toBe('pendente');
    const n = await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [c.id]);
    expect(n.rows[0].n).toBe(2); // o da publicação + o do pedido novo
  });

  it('anonimização (US-018): apaga o PDF do plano do disco e do registro; o PDF que chega depois da anonimização não é gravado', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await planoPublicado(T);
    expect(await job(T, id)).toBe('pronto');
    const caminho = (await carregarPlano(T.ctx, id, app.db))!.pdfPath!;
    const bloquear = (t: TenantDeTeste, patientId: string) =>
      withTenant(t.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2026-09-30' }).where(eq(patients.id, patientId)), app.db);
    await bloquear(T, p.id);
    // rodada 2 da T13: um tenant que não é desta varredura (outro arquivo de teste, rodando ao mesmo tempo, com outro dataDir)
    const alheio = await novoTenant(app.db);
    const deOutroArquivo = await novoPaciente(app.db, alheio.ctx);
    await bloquear(alheio, deOutroArquivo.id);
    await anonimizarSo(T);
    const [visto] = await withTenant(alheio.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, deOutroArquivo.id)), app.db);
    expect(visto.anonimizadoEm, 'a varredura do teste só passa pelos próprios tenants').toBeNull();
    expect(existsSync(resolverCaminho(dataDir, caminho))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, caminho)), app.db)).toEqual([]);
    expect((await carregarPlano(T.ctx, id, app.db))?.pdfPath).toBeNull();

    // plano publicado cujo job só roda depois de o paciente já ter sido anonimizado
    const T2 = await novoTenant(app.db);
    const b = await planoPublicado(T2);
    await bloquear(T2, b.p.id);
    await anonimizarSo(T2);
    expect(await job(T2, b.id)).toBe('ignorado');
    expect((await owner.pool.query(`select pdf_status, pdf_path from meal_plans where id = $1`, [b.id])).rows[0]).toEqual({ pdf_status: 'falhou', pdf_path: null });
    expect(await withTenant(T2.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
  });

  it('marca (D14): logo PNG do tenant e cor primária entram no PDF', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T);
    const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#047857' } }).png().toBuffer();
    const caminho = `${T.tenantId}/logo/${randomUUID()}.png`;
    mkdirSync(path.dirname(resolverCaminho(dataDir, caminho)), { recursive: true });
    writeFileSync(resolverCaminho(dataDir, caminho), logo);
    await app.db.update(tenants).set({ logoPath: caminho, corPrimaria: '#1d4ed8' }).where(eq(tenants.id, T.tenantId));
    let pdf: Buffer | null = null;
    let cor = '';
    expect(await job(T, id, { renderizar: async (d) => { cor = d.cor; expect(d.logo?.equals(logo)).toBe(true); return (pdf = await renderizarPlano(d)); } })).toBe('pronto');
    expect(cor).toBe('#1d4ed8');
    expect(pdf!.toString('latin1')).toContain('/Subtype /Image');
  });

  it('"Gerar o PDF de novo" só enfileira de "falhou": pendente → "O PDF já está sendo preparado."; pronto → nada a fazer; id inválido, rascunho ou outro tenant → não encontrado', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await planoPublicado(T);
    const estado = async () => (await owner.pool.query(`select pdf_status, pdf_path, updated_at from meal_plans where id = $1`, [id])).rows[0];
    await expect(pedirNovoPdf(T.ctx, p.id, id, deps)).rejects.toBeInstanceOf(PdfEmPreparoError); // pendente
    expect(new PdfEmPreparoError().message).toBe('O PDF já está sendo preparado.'); // o texto que a action mostra
    expect(await job(T, id)).toBe('pronto');
    const pronto = await estado();
    // pronto (outra aba já gerou, ou o worker terminou entre a tela e o clique): sem erro, a página mostra "Baixar PDF"
    await expect(pedirNovoPdf(T.ctx, p.id, id, deps)).resolves.toBeUndefined();
    expect(await estado()).toEqual(pronto); // nada muda: nem o arquivo nem o updated_at
    await expect(pedirNovoPdf(T.ctx, p.id, 'nao-e-um-id', deps)).rejects.toThrow(PlanoNaoEncontradoError);
    const { id: rascunho } = await criarRascunho(T.ctx, (await novoPaciente(app.db, T.ctx)).id, deps);
    await expect(pedirNovoPdf(T.ctx, p.id, rascunho, deps)).rejects.toThrow(PlanoNaoEncontradoError); // rascunho não tem PDF
    const outro = await novoTenant(app.db);
    await owner.pool.query(`update meal_plans set pdf_status = 'falhou' where id = $1`, [id]);
    await expect(pedirNovoPdf(outro.ctx, p.id, id, deps)).rejects.toThrow(PlanoNaoEncontradoError); // RLS: outro tenant
    expect((await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [id])).rows[0].pdf_status).toBe('falhou');
    const n = await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [id]);
    expect(n.rows[0].n).toBe(1); // só o da publicação
  });

  it('"Gerar o PDF de novo" de plano de outro paciente (o da URL é outro): "Plano não encontrado." e nada vai para a fila', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T);
    const bia = await novoPaciente(app.db, T.ctx);
    await owner.pool.query(`update meal_plans set pdf_status = 'falhou' where id = $1`, [id]);
    await expect(pedirNovoPdf(T.ctx, bia.id, id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(pedirNovoPdf(T.ctx, 'nao-e-um-id', id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect((await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [id])).rows[0].pdf_status).toBe('falhou');
    const n = await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [id]);
    expect(n.rows[0].n).toBe(1); // só o da publicação
  });

  it('"Gerar o PDF de novo" com a fila recusando o job: erro e o plano continua "falhou" (nada fica pendente sem job)', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await planoPublicado(T);
    await owner.pool.query(`update meal_plans set pdf_status = 'falhou' where id = $1`, [id]);
    const recusa = { send: async () => null } as unknown as PgBoss;
    await expect(pedirNovoPdf(T.ctx, p.id, id, { ...deps, boss: recusa })).rejects.toThrow('A fila recusou o PDF do plano');
    expect((await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [id])).rows[0].pdf_status).toBe('falhou');
  });

  it('paciente bloqueado (pedido de exclusão, US-018): "Gerar o PDF de novo" é recusado e o job não grava PDF novo', async () => {
    const bloquear = (t: TenantDeTeste, patientId: string) =>
      withTenant(t.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, patientId)), app.db);
    const jobs = async (planId: string) => (await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [planId])).rows[0].n;
    const status = async (planId: string) => (await owner.pool.query(`select pdf_status, pdf_path from meal_plans where id = $1`, [planId])).rows[0];

    const T = await novoTenant(app.db);
    const a = await planoPublicado(T);
    await owner.pool.query(`update meal_plans set pdf_status = 'falhou' where id = $1`, [a.id]);
    await bloquear(T, a.p.id);
    await expect(pedirNovoPdf(T.ctx, a.p.id, a.id, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await status(a.id)).toEqual({ pdf_status: 'falhou', pdf_path: null });
    expect(await jobs(a.id)).toBe(1); // só o da publicação

    // publicado antes do bloqueio, com o job ainda na fila: não gera o PDF depois do pedido de exclusão
    const T2 = await novoTenant(app.db);
    const b = await planoPublicado(T2);
    await bloquear(T2, b.p.id);
    expect(await job(T2, b.id)).toBe('ignorado');
    expect(await status(b.id)).toEqual({ pdf_status: 'falhou', pdf_path: null });
    expect(await withTenant(T2.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
  });

  it('pendente esquecido há mais de 1 h vira "falhou" (rede de segurança); recente, pronto e rascunho ficam; o painel pode pedir de novo', async () => {
    const T = await novoTenant(app.db);
    const esquecido = await planoPublicado(T);
    const recente = await planoPublicado(T);
    const pronto = await planoPublicado(T);
    expect(await job(T, pronto.id)).toBe('pronto');
    // datas de 2000 só aqui: a varredura cruza todos os tenants do banco de teste e não pode mexer nos planos de outros testes
    const em = (id: string, quando: string) => owner.pool.query(`update meal_plans set pdf_pedido_em = $2, updated_at = $2 where id = $1`, [id, quando]);
    await em(esquecido.id, '2000-01-01T00:00:00Z');
    await em(recente.id, '2000-01-01T01:30:00Z');
    await em(pronto.id, '2000-01-01T00:00:00Z');
    const status = async (id: string) => (await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [id])).rows[0].pdf_status;

    expect(await expirarPdfsPendentes(app.db, new Date('2000-01-01T00:30:00Z'))).toBe(0); // 30 min: ainda dentro do prazo
    expect(await status(esquecido.id)).toBe('pendente');
    expect(await expirarPdfsPendentes(app.db, new Date('2000-01-01T02:00:00Z'))).toBe(1);
    expect(await status(esquecido.id)).toBe('falhou');
    expect(await status(recente.id)).toBe('pendente'); // 30 min
    expect(await status(pronto.id)).toBe('pronto');
    expect(await expirarPdfsPendentes(app.db, new Date('2000-01-01T02:00:00Z'))).toBe(0); // idempotente

    // o botão "Gerar o PDF de novo" volta a funcionar e o job gera
    await pedirNovoPdf(T.ctx, esquecido.p.id, esquecido.id, deps);
    expect(await status(esquecido.id)).toBe('pendente');
    expect(await job(T, esquecido.id)).toBe('pronto');
  });

  it('a idade do pendente conta do pedido do PDF (pdf_pedido_em), não da última gravação no plano: arquivar a versão anterior não renova o prazo', async () => {
    // datas de 1999 só aqui, num teste depois do de cima: a varredura cruza todos os tenants do banco de teste
    const as = (hhmm: string) => new Date(`1999-12-31T${hhmm}:00Z`);
    const linha = async (id: string) => (await owner.pool.query(`select status, pdf_status, pdf_pedido_em, updated_at from meal_plans where id = $1`, [id])).rows[0];
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id: v1 } = await criarRascunho(T.ctx, p.id, deps);
    await salvarRascunho(T.ctx, v1, conteudo(false), deps);
    await publicarPlano(T.ctx, p.id, v1, { ...deps, now: as('22:00') }); // o worker não chega a gerar o PDF da v1
    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps);
    await publicarPlano(T.ctx, p.id, v2, { ...deps, now: as('22:50') }); // arquiva a v1, o que grava o updated_at dela
    expect(await linha(v1)).toMatchObject({ status: 'arquivado', pdf_status: 'pendente', updated_at: as('22:50') });

    expect(await expirarPdfsPendentes(app.db, as('23:10'))).toBe(1); // v1: PDF pedido há 70 min, plano gravado há 20
    expect(await linha(v1)).toMatchObject({ pdf_status: 'falhou', pdf_pedido_em: as('22:00') });
    expect(await linha(v2)).toMatchObject({ pdf_status: 'pendente', pdf_pedido_em: as('22:50') }); // pedido há 20 min

    // "Gerar o PDF de novo" também marca o pedido; pendente sem a data (de antes da coluna) mede pelo updated_at
    await pedirNovoPdf(T.ctx, p.id, v1, { ...deps, now: as('23:20') });
    expect(await linha(v1)).toMatchObject({ pdf_status: 'pendente', pdf_pedido_em: as('23:20') });
    await owner.pool.query(`update meal_plans set pdf_pedido_em = null where id = $1`, [v2]); // updated_at da v2: 22:50
    expect(await expirarPdfsPendentes(app.db, as('23:55'))).toBe(1); // v2: 65 min pelo updated_at; v1: pedido há 35 min
    expect((await linha(v2)).pdf_status).toBe('falhou');
    expect((await linha(v1)).pdf_status).toBe('pendente');
    expect(await job(T, v1)).toBe('pronto'); // nenhum pendente com data de 1999 sobra para outras varreduras
  });
});
