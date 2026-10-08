import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { auditLog, diaryEntries, meals, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { COTA_BYTES, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { MSG_DIARIO } from './diario-constantes';
import { DiarioError, diarioDoPaciente, registrarNoDiario, respostasDeHoje } from './diario';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-diario-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const deps = (agora = new Date('2026-10-05T15:00:00Z')) => ({ db: app.db, dataDir, agora });
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DiarioError) return e.erros;
    throw e;
  }
  throw new Error('esperava DiarioError');
};

describe('diário (US-042, RN-07)', () => {
  it('"Almoço" com texto e foto: registro na hora, foto original guardada com dono e o job de conversão na fila', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const r = await registrarNoDiario(ctx, SP, { refeicao: 'Almoço', texto: 'arroz, feijão, frango', foto: JPEG }, deps());
    expect(r.semFoto).toBe(false);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, r.id)), app.db);
    expect(e).toMatchObject({ refeicao: 'Almoço', texto: 'arroz, feijão, frango', fotoStatus: 'processando', fotoPath: null });
    expect(e.fotoOriginalPath).toMatch(new RegExp(`^${T.tenantId}/diario_foto_original/`));
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, e.fotoOriginalPath!)), app.db);
    expect(f.patientId).toBe(p.id);
    const jobs = await (await getBoss()).findJobs('diario-foto');
    expect(jobs.some((j) => (j.data as { entryId: string }).entryId === r.id)).toBe(true);
  });

  it('validação: refeição fora da lista, vazio, texto longo, PDF no lugar da foto', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Brunch', texto: 'x', foto: null }, deps()))).toEqual({ refeicao: MSG_DIARIO.refeicao });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: '   ', foto: null }, deps()))).toEqual({ geral: MSG_DIARIO.vazio });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'a'.repeat(2001), foto: null }, deps()))).toEqual({ texto: MSG_DIARIO.texto });
    // F-4: o limite conta caracteres (code points), como o CHECK do banco (char_length), não unidades UTF-16
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: '🍎'.repeat(2001), foto: null }, deps()))).toEqual({ texto: MSG_DIARIO.texto });
    // F-4: NUL não entra no Postgres (text) — recusado antes, com 400, e não 500
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'arroz\u0000feijão', foto: null }, deps()))).toEqual({ geral: MSG_DIARIO.formulario });
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'x', foto: pdf }, deps()))).toEqual({ foto: MSG_DIARIO.foto });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'x', foto: Buffer.alloc(10 * 1024 * 1024 + 1, 0xff) }, deps()))).toEqual({ foto: MSG_DIARIO.foto });
  });

  it('F-4: 2000 emojis (4000 unidades UTF-16) cabem nos 2000 caracteres da spec e do CHECK do banco', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const texto = '🍎'.repeat(2000);
    const { id } = await registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto, foto: null }, deps());
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, id)), app.db);
    expect(e.texto).toBe(texto);
  });

  it('limite de 10 por dia no fuso do tenant: o 11º é recusado; 23:30 de Brasília ainda conta no mesmo dia; à 00:10 libera', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    for (let i = 0; i < 10; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps(new Date('2026-10-05T12:00:00Z')));
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: 'mais', foto: null }, deps(new Date('2026-10-06T02:30:00Z'))))).toEqual({ geral: MSG_DIARIO.limite });
    await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: 'novo dia', foto: null }, deps(new Date('2026-10-06T03:10:00Z')));
  });

  it('corrida: com 9 no dia, dois envios ao mesmo tempo → exatamente um entra (Review Focus 3)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    for (let i = 0; i < 9; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps());
    const r = await Promise.allSettled([1, 2].map((n) => registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `c${n}`, foto: null }, deps())));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('cota esgotada (RN-18): o texto é salvo sem a foto; só a foto → "Espaço de armazenamento esgotado"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    const ctx = ctxPaciente(T.tenantId, p.id);
    const r = await registrarNoDiario(ctx, SP, { refeicao: 'Jantar', texto: 'sopa', foto: JPEG }, deps());
    expect(r.semFoto).toBe(true);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, r.id)), app.db);
    expect(e).toMatchObject({ texto: 'sopa', fotoStatus: 'sem_foto', fotoOriginalPath: null });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Jantar', texto: '', foto: JPEG }, deps()))).toEqual({ foto: MSG_COTA_ESGOTADA });
  });

  it('o paciente lê só os próprios registros, mais recentes primeiro; leitura auditada', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await registrarNoDiario(ctxPaciente(T.tenantId, p1.id), SP, { refeicao: 'Café da manhã', texto: 'pão', foto: null }, deps(new Date('2026-10-05T10:00:00Z')));
    await registrarNoDiario(ctxPaciente(T.tenantId, p1.id), SP, { refeicao: 'Almoço', texto: 'arroz', foto: null }, deps(new Date('2026-10-05T15:00:00Z')));
    await registrarNoDiario(ctxPaciente(T.tenantId, p2.id), SP, { refeicao: 'Almoço', texto: 'de outro', foto: null }, deps());
    const lista = await diarioDoPaciente(ctxPaciente(T.tenantId, p1.id), { db: app.db });
    expect(lista.map((x) => x.texto)).toEqual(['arroz', 'pão']);
    expect(lista[0].foto).toEqual({ estado: 'sem_foto' });
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p1.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'diario'))), app.db);
    expect(lidas).toHaveLength(1);
  });
});

describe('respostas à refeição do plano (Plano 16, RN-197, D3)', () => {
  const ALMOCO_1240 = new Date('2026-10-05T15:40:00Z'); // 12:40 em São Paulo
  async function comPlano(o: { refeicoes?: { nome: string; horario: string }[] } = {}) {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const plano = await planoPublicado(app.db, T, p.id, { refeicoes: o.refeicoes ?? [{ nome: 'Almoço', horario: '12:30' }, { nome: 'Pré-treino', horario: '17:00' }, { nome: 'Ceia', horario: '21:00' }] });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const linhas = () => withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), app.db);
    return { T, p, ctx, plano, linhas, ref: (nome: string) => plano.refeicoes.find((r) => r.nome === nome)!.id };
  }

  it('"Comi assim": refeição do diário mapeada pelo nome, resposta e a cópia "{nome} · {HH:MM}", sem texto nem foto', async () => {
    const { ctx, linhas, ref } = await comPlano();
    const r = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect(r).toMatchObject({ semFoto: false, jaRegistrado: false });
    expect(await linhas()).toEqual([expect.objectContaining({ id: r.id, refeicao: 'Almoço', resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30', texto: null, fotoStatus: 'sem_foto', dataHora: ALMOCO_1240 })]);
  });

  it('nome fora da lista vira "Outro"; refeição sem horário leva só o nome', async () => {
    const { T, ctx, linhas, ref } = await comPlano();
    // a publicação de hoje exige horário em toda refeição (MSG_PLANO.publicarHorario); a coluna aceita nulo
    await withTenant(T.ctx, (tx) => tx.update(meals).set({ horario: null }).where(eq(meals.id, ref('Ceia'))), app.db);
    await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Pré-treino'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Ceia'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect((await linhas()).map((e) => [e.refeicao, e.refeicaoDoPlano]).sort()).toEqual([['Ceia', 'Ceia'], ['Outro', 'Pré-treino · 17:00']]);
  });

  it('uma resposta por refeição do plano por dia: o segundo "Comi assim" devolve o mesmo registro — também em duas conexões ao mesmo tempo', async () => {
    const { ctx, linhas, ref } = await comPlano();
    const entrada = { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' };
    const [a, b] = await Promise.all([registrarNoDiario(ctx, SP, entrada, deps(ALMOCO_1240)), registrarNoDiario(ctx, SP, entrada, deps(ALMOCO_1240))]);
    expect(a.id).toBe(b.id);
    expect([a.jaRegistrado, b.jaRegistrado].sort()).toEqual([false, true]);
    expect(await linhas()).toHaveLength(1);
    // no dia seguinte, outra resposta à mesma refeição entra
    await registrarNoDiario(ctx, SP, entrada, deps(new Date('2026-10-06T15:40:00Z')));
    expect(await linhas()).toHaveLength(2);
  });

  it('"Comi outra coisa" exige texto ou foto; com texto, entra com a resposta; depois de uma resposta, o registro com conteúdo vira registro comum (D3)', async () => {
    const { ctx, linhas, ref } = await comPlano();
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '  ', foto: null, refeicaoId: ref('Almoço'), resposta: 'outra_coisa' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.vazio });
    const outra = await registrarNoDiario(ctx, SP, { refeicao: null, texto: 'Sanduíche natural', foto: null, refeicaoId: ref('Almoço'), resposta: 'outra_coisa' }, deps(ALMOCO_1240));
    const depois = await registrarNoDiario(ctx, SP, { refeicao: null, texto: 'e um suco', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect(depois.id).not.toBe(outra.id);
    const porId = new Map((await linhas()).map((e) => [e.id, e]));
    expect(porId.get(outra.id)).toMatchObject({ resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30', texto: 'Sanduíche natural' });
    expect(porId.get(depois.id)).toMatchObject({ resposta: null, refeicaoDoPlano: null, refeicao: 'Almoço', texto: 'e um suco' });
  });

  it('refeição de outro paciente, do rascunho, id inválido ou resposta sem refeição: nada gravado', async () => {
    const { T, ctx, linhas } = await comPlano();
    const outro = await novoPaciente(app.db, T.ctx);
    const deOutro = (await planoPublicado(app.db, T, outro.id)).refeicoes[0].id;
    const naoEncontrada = { geral: MSG_DIARIO.refeicaoNaoEncontrada };
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: deOutro, resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual(naoEncontrada);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: 'nao-e-uuid', resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual(naoEncontrada);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Almoço', texto: '', foto: null, resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.formulario });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: deOutro, resposta: 'talvez' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.formulario });
    expect(await linhas()).toEqual([]);
  });

  it('limite de 10 por dia (RN-07): o "Comi assim" novo recusa; o repetido de uma refeição já respondida devolve o registro', async () => {
    const { ctx, ref } = await comPlano();
    const almoco = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    for (let i = 0; i < 9; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps(ALMOCO_1240));
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Pré-treino'), resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.limite });
    const repetido = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect(repetido).toMatchObject({ id: almoco.id, jaRegistrado: true });
  });

  it('vínculo bloqueado depois de abrir a tela: "Conta temporariamente indisponível"', async () => {
    const { T, p, ctx, ref } = await comPlano();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual({ geral: 'Conta temporariamente indisponível' });
  });

  it('foto com "Comi assim": a resposta vai junto da foto em processamento; respostasDeHoje e a leitura devolvem a resposta', async () => {
    const { ctx, ref } = await comPlano();
    const r = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: JPEG, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    const lista = await diarioDoPaciente(ctx, { db: app.db });
    expect(lista).toEqual([expect.objectContaining({ id: r.id, resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30', foto: { estado: 'processando' } })]);
    expect(await respostasDeHoje(ctx, SP.fuso, { db: app.db, agora: ALMOCO_1240 })).toEqual(new Set(['Almoço · 12:30']));
    expect(await respostasDeHoje(ctx, SP.fuso, { db: app.db, agora: new Date('2026-10-06T15:40:00Z') })).toEqual(new Set());
  });
});
