import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { textoDoPdf } from '../../../test/pdf';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { anexosDoPaciente, anonimizarVencidos } from '@/modules/pacientes/lgpd';
import { COTA_BYTES, resolverCaminho } from '@/modules/plataforma/armazenamento';
import { gTexto, totalDoDia } from './calculo';
import { carregarPlano } from './carregar';
import { PlanoNaoEncontradoError } from './erros';
import { renderizarPlano } from './plano-pdf';
import { expirarPdfsPendentes, gerarPdfDoPlano } from './plano-pdf-job';
import { pedirNovoPdf, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { RascunhoEnviado } from './tipos';

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
const deps = { db: app.db, now };
const job = (T: TenantDeTeste, planId: string, extra: Partial<Parameters<typeof gerarPdfDoPlano>[1]> = {}) =>
  gerarPdfDoPlano({ tenantId: T.tenantId, planId }, { db: app.db, dataDir, now, ultimaTentativa: false, ...extra });

function conteudo(mostrarCalorias: boolean): RascunhoEnviado {
  const pao = randomUUID();
  return {
    revisao: 0, titulo: 'Plano de Ana', metaKcal: '2000', mostrarCalorias, orientacoes: 'Beber 2 litros de água por dia.',
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
  await publicarPlano(T.ctx, id, deps);
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
      revisao: 0, titulo: 'Sem kcal', metaKcal: '', mostrarCalorias: true, orientacoes: '',
      refeicoes: [
        { id: randomUUID(), nome: 'Lanche A', horario: '10:00', observacao: '', itens: [item(pao, idTaco(53), '50', null), item(leite, idTaco(458), '200', pao)] }, // substituição sem kcal
        { id: randomUUID(), nome: 'Lanche B', horario: '16:00', observacao: '', itens: [item(leite2, idTaco(458), '200', null), item(pao2, idTaco(53), '50', leite2)] }, // principal sem kcal
      ],
    }, deps);
    await publicarPlano(T.ctx, id, deps);
    let pdf: Buffer | null = null;
    expect(await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) })).toBe('pronto');
    const texto = textoDoPdf(pdf!);
    expect(texto).toContain('ou Leite, de vaca, integral');
    expect(texto).toContain('ou Pão, trigo, francês');
    expect(texto).toContain('150 kcal'); // o pão continua com a própria kcal
    expect(texto).not.toMatch(/\([+-]\d+ kcal\)/); // nenhuma diferença (seria "-150" ou "+150": o item sem valor conta 0)
  });

  it('6 refeições e 40 itens: PDF em até 5 s de processamento', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    const refeicoes = Array.from({ length: 6 }, (_, r) => ({
      id: randomUUID(), nome: `Refeição ${r + 1}`, horario: `${String(7 + 2 * r).padStart(2, '0')}:00`, observacao: 'Observação da refeição',
      itens: Array.from({ length: r < 4 ? 7 : 6 }, (_, i) => ({ id: randomUUID(), foodId: idTaco(1 + ((r * 7 + i) % 597)), quantidadeG: '100', medida: null, substituiItemId: null })),
    }));
    await salvarRascunho(T.ctx, id, { revisao: 0, titulo: 'Grande', metaKcal: '', mostrarCalorias: true, orientacoes: '', refeicoes }, deps);
    await publicarPlano(T.ctx, id, deps);
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
    await pedirNovoPdf(T3.ctx, c.id, deps);
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
    await anonimizarVencidos(app.db, now, { dataDir });
    expect(existsSync(resolverCaminho(dataDir, caminho))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, caminho)), app.db)).toEqual([]);
    expect((await carregarPlano(T.ctx, id, app.db))?.pdfPath).toBeNull();

    // plano publicado cujo job só roda depois de o paciente já ter sido anonimizado
    const T2 = await novoTenant(app.db);
    const b = await planoPublicado(T2);
    await bloquear(T2, b.p.id);
    await anonimizarVencidos(app.db, now, { dataDir });
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

  it('"Gerar o PDF de novo" só vale para "falhou": pendente, pronto, id inválido ou plano de outro tenant não enfileiram nada', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T);
    await expect(pedirNovoPdf(T.ctx, id, deps)).rejects.toThrow(PlanoNaoEncontradoError); // pendente
    expect(await job(T, id)).toBe('pronto');
    await expect(pedirNovoPdf(T.ctx, id, deps)).rejects.toThrow(PlanoNaoEncontradoError); // pronto
    await expect(pedirNovoPdf(T.ctx, 'nao-e-um-id', deps)).rejects.toThrow(PlanoNaoEncontradoError);
    const outro = await novoTenant(app.db);
    await owner.pool.query(`update meal_plans set pdf_status = 'falhou' where id = $1`, [id]);
    await expect(pedirNovoPdf(outro.ctx, id, deps)).rejects.toThrow(PlanoNaoEncontradoError); // RLS: outro tenant
    expect((await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [id])).rows[0].pdf_status).toBe('falhou');
    const n = await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [id]);
    expect(n.rows[0].n).toBe(1); // só o da publicação
  });

  it('pendente esquecido há mais de 1 h vira "falhou" (rede de segurança); recente, pronto e rascunho ficam; o painel pode pedir de novo', async () => {
    const T = await novoTenant(app.db);
    const esquecido = await planoPublicado(T);
    const recente = await planoPublicado(T);
    const pronto = await planoPublicado(T);
    expect(await job(T, pronto.id)).toBe('pronto');
    // datas de 2000 só aqui: a varredura cruza todos os tenants do banco de teste e não pode mexer nos planos de outros testes
    const em = (id: string, quando: string) => owner.pool.query(`update meal_plans set updated_at = $2 where id = $1`, [id, quando]);
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
    await pedirNovoPdf(T.ctx, esquecido.id, deps);
    expect(await status(esquecido.id)).toBe('pendente');
    expect(await job(T, esquecido.id)).toBe('pronto');
  });
});
