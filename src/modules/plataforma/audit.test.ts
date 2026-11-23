import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { tarefaNoBanco } from '../../../test/ia';
import * as conversa from '../../../test/ia-nutri-conversa';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, iaTarefas, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { provedorFake } from '@/modules/ia/provedor-fake';
import { perguntar } from '@/modules/ia/nutri-paciente/conversa';
import { processarPerguntaIaNutri } from '@/modules/ia/nutri-paciente/job';
import { auditRead, ENTIDADE_ROTULO, HISTORICO_POR_PAGINA, listAccessHistory, recordAudit, rotuloDaAcao } from './audit';

const app = makeDb(inject('appDatabaseUrl'));
let A: string;
let B: string;
let nutriId: string;
const P1 = randomUUID();
const P3 = randomUUID();

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `aud-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'A' },
      { slug: `aud-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  nutriId = randomUUID();
  await app.db.insert(user).values({ id: nutriId, name: 'Debby Silva', email: `aud-${nutriId.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: A });
});
afterAll(() => app.pool.end());
afterAll(conversa.fecharHarnessDaConversa);

const ctxA = (): TenantContext => ({ tenantId: A, role: 'nutri', actorUserId: nutriId, ip: '203.0.113.10' });
const logDe = (entidadeId: string) =>
  withTenant(ctxA(), (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, entidadeId)).orderBy(auditLog.criadoEm), app.db);

describe('auditoria automática (RNF-08, US-007)', () => {
  it('criar, alterar e excluir numa tabela de saúde viram linhas com ator, IP, paciente — sem o conteúdo', async () => {
    const id = await withTenant(ctxA(), async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'peso 70 kg') returning id`);
      const novo = r.rows[0].id;
      await tx.execute(sql`update audit_fixture_registros set texto = 'peso 71 kg' where id = ${novo}`);
      await tx.execute(sql`delete from audit_fixture_registros where id = ${novo}`);
      return novo;
    }, app.db);
    const log = await logDe(id);
    expect(log.map((l) => l.acao)).toEqual(['criar', 'alterar', 'excluir']);
    for (const l of log) {
      expect(l).toMatchObject({ tenantId: A, actorUserId: nutriId, ip: '203.0.113.10', patientId: P1, entidade: 'registros_teste' });
    }
    expect(JSON.stringify(log)).not.toContain('peso');
  });

  it('auditRead grava a leitura na mesma transação', async () => {
    await withTenant(ctxA(), (tx) => auditRead(tx, { entidade: 'patients', entidadeId: P1, patientId: P1 }), app.db);
    const log = await logDe(P1);
    expect(log.at(-1)).toMatchObject({ acao: 'ler', entidade: 'patients', patientId: P1, actorUserId: nutriId });
  });

  it('escrita feita por job do worker fica sem ator (Sistema)', async () => {
    const id = await withTenant({ tenantId: A, role: 'worker' }, async (tx) =>
      (await tx.execute<{ id: string }>(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'x') returning id`)).rows[0].id, app.db);
    expect((await logDe(id))[0]).toMatchObject({ acao: 'criar', actorUserId: null, ip: null });
  });

  it('sem contexto de tenant não há como auditar (e a escrita auditada falha junto)', async () => {
    await expect(app.db.transaction((tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P1, patientId: P1 }))).rejects.toThrow();
  });

  it('paciente grava o próprio registro e não lê o audit_log (B-6, 0085)', async () => {
    const P2 = randomUUID();
    await withTenant(ctxA(), (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P2, patientId: P2 }), app.db);

    // D1 (Plano 06): a sessão de paciente só grava o que PACIENTE_ESCREVE libera — aqui o próprio cadastro (patients,
    // update, auditado), não a tabela de exemplo (paciente_sem_insert). O gatilho roda com o papel do paciente.
    const pac = await novoPaciente(app.db, ctxA());
    const ctxP = { tenantId: A, role: 'paciente' as const, patientId: pac.id, actorUserId: randomUUID() };
    await withTenant(ctxP, (tx) => tx.execute(sql`update patients set nome = nome where id = ${pac.id}`), app.db);
    const gravado = await withTenant(ctxA(), (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, pac.id)), app.db);
    expect(gravado.some((l) => l.acao === 'alterar' && l.patientId === pac.id && l.actorUserId === ctxP.actorUserId)).toBe(true);
    // B-6: paciente_sem_leitura (RESTRICTIVE FOR SELECT) — nem as próprias linhas (IP e ator da equipe), nem as de P2
    expect(await withTenant(ctxP, (tx) => tx.select().from(auditLog), app.db)).toEqual([]);

    // WITH CHECK: a sessão do paciente não consegue gravar uma linha de auditoria em nome de P2.
    await expect(
      withTenant(ctxP, (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P2, patientId: P2 }), app.db),
    ).rejects.toThrow();
  });
});

describe('listAccessHistory ("Histórico de acessos", 50 por página, mais recente primeiro)', () => {
  beforeAll(async () => {
    await withTenant(ctxA(), (tx) =>
      recordAudit(tx, Array.from({ length: 120 }, () => ({ acao: 'ler' as const, entidade: 'patients', entidadeId: P3, patientId: P3 }))), app.db);
  });

  it('pagina em 50, em ordem decrescente, com o nome de quem acessou', async () => {
    const p1 = await listAccessHistory(ctxA(), P3, 1, app.db);
    expect(p1).toMatchObject({ pagina: 1, totalPaginas: 3, total: 120 });
    expect(p1.itens).toHaveLength(HISTORICO_POR_PAGINA);
    for (let i = 1; i < p1.itens.length; i++) {
      expect(p1.itens[i - 1].criadoEm.getTime()).toBeGreaterThanOrEqual(p1.itens[i].criadoEm.getTime());
    }
    expect(p1.itens[0].ator).toEqual({ nome: 'Debby Silva', papel: 'nutri' });
    expect((await listAccessHistory(ctxA(), P3, 3, app.db)).itens).toHaveLength(20);
  });

  it('página fora da faixa é ajustada', async () => {
    expect((await listAccessHistory(ctxA(), P3, 99, app.db)).pagina).toBe(3);
    expect((await listAccessHistory(ctxA(), P3, 0, app.db)).pagina).toBe(1);
  });

  it('patientId que não é UUID (vindo da URL) devolve histórico vazio, não erro 500 (M6)', async () => {
    for (const id of ['abc', '', "1' or '1'='1", `${P3}x`]) {
      await expect(listAccessHistory(ctxA(), id, 1, app.db)).resolves.toEqual({ itens: [], pagina: 1, totalPaginas: 1, total: 0 });
    }
  });

  it('id válido no Postgres mas sem versão RFC (00000000-…-0001) lista o histórico normalmente (G5)', async () => {
    const semVersao = '00000000-0000-0000-0000-000000000001';
    await withTenant(ctxA(), (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: semVersao, patientId: semVersao }), app.db);
    const h = await listAccessHistory(ctxA(), semVersao, 1, app.db);
    expect(h.total).toBe(1);
    expect(h.itens[0]).toMatchObject({ acao: 'ler', entidadeId: semVersao });
  });

  it('outro tenant não vê o histórico', async () => {
    expect((await listAccessHistory({ tenantId: B, role: 'nutri', actorUserId: randomUUID() }, P3, 1, app.db)).total).toBe(0);
  });
});

describe('Plano 11 (RN-101) — a IA no Histórico de acessos', () => {
  it('"Pediu leitura à IA" (criar) e "Laudo enviado à IA" (exportar do worker, "Sistema"); o alterar do worker não aparece nem conta; o da nutricionista aparece', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const worker = { tenantId: T.tenantId, role: 'worker' as const };
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'na_fila' }); // criar, com ator
    await withTenant(worker, (tx) => tx.update(iaTarefas).set({ status: 'processando' }).where(eq(iaTarefas.id, id)), app.db); // alterar, sem ator
    await withTenant(worker, (tx) => recordAudit(tx, { acao: 'exportar', entidade: 'ia', entidadeId: id, patientId: p.id }), app.db); // saída (portão do envio, T11)
    await withTenant(T.ctx, (tx) => tx.update(iaTarefas).set({ status: 'falhou', erro: 'interrompida' }).where(eq(iaTarefas.id, id)), app.db); // alterar, com ator
    const h = await listAccessHistory(T.ctx, p.id, 1, app.db);
    const daIa = h.itens.filter((i) => i.entidade === 'ia');
    expect(daIa.map((i) => rotuloDaAcao(i))).toEqual(['Alterou', 'Laudo enviado à IA', 'Pediu leitura à IA']);
    expect(daIa[1].ator).toBeNull(); // "Sistema" na tela
    expect(h.total).toBe(h.itens.length); // a contagem também ignora o alterar do worker
    expect(ENTIDADE_ROTULO.ia).toBe('Inteligência artificial');
    expect(rotuloDaAcao({ acao: 'ler', entidade: 'ia' })).toBe('Visualizou');
  });

  it('Plano 14B (D22, RN-101): o rótulo da IA pelo tipo da tarefa', () => {
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia', tipoIa: 'leitura_exame' })).toBe('Pediu leitura à IA');
    expect(rotuloDaAcao({ acao: 'exportar', entidade: 'ia', tipoIa: 'leitura_exame' })).toBe('Laudo enviado à IA');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia', tipoIa: 'resumo_historico' })).toBe('Pediu resumo à IA');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia', tipoIa: 'rascunho_plano' })).toBe('Pediu rascunho à IA');
    expect(rotuloDaAcao({ acao: 'exportar', entidade: 'ia', tipoIa: 'resumo_historico' })).toBe('Dados enviados à IA');
    expect(rotuloDaAcao({ acao: 'exportar', entidade: 'ia', tipoIa: 'rascunho_plano' })).toBe('Dados enviados à IA');
    // tarefa já apagada (anonimização): o tipo não é mais conhecido
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia', tipoIa: null })).toBe('Pediu uso da IA');
    expect(rotuloDaAcao({ acao: 'exportar', entidade: 'ia', tipoIa: null })).toBe('Dados enviados à IA');
    // chamada sem o campo (antes do Plano 14B): os rótulos da leitura
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia' })).toBe('Pediu leitura à IA');
    expect(rotuloDaAcao({ acao: 'exportar', entidade: 'ia' })).toBe('Laudo enviado à IA');
    expect(rotuloDaAcao({ acao: 'ler', entidade: 'ia', tipoIa: 'resumo_historico' })).toBe('Visualizou');
  });

  it('Plano 14B (D22): listAccessHistory lê o tipo em ia_tarefas — resumo, rascunho e leitura; tarefa sem linha → null; fora da IA, sem o campo', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const worker = { tenantId: T.tenantId, role: 'worker' as const };
    const resumo = await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', status: 'na_fila' });
    const rascunho = await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'rascunho_plano', status: 'na_fila' });
    await withTenant(worker, (tx) => recordAudit(tx, { acao: 'exportar', entidade: 'ia', entidadeId: resumo, patientId: p.id }), app.db);
    const apagada = randomUUID(); // a tarefa que a anonimização apagou: o registro fica, sem a linha em ia_tarefas
    await withTenant(worker, (tx) => recordAudit(tx, { acao: 'exportar', entidade: 'ia', entidadeId: apagada, patientId: p.id }), app.db);
    await withTenant(T.ctx, (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: p.id, patientId: p.id }), app.db);
    const h = await listAccessHistory(T.ctx, p.id, 1, app.db);
    const de = (id: string, acao: string) => h.itens.find((i) => i.entidadeId === id && i.acao === acao)!;
    expect(de(resumo, 'criar').tipoIa).toBe('resumo_historico');
    expect(rotuloDaAcao(de(resumo, 'criar'))).toBe('Pediu resumo à IA');
    expect(rotuloDaAcao(de(resumo, 'exportar'))).toBe('Dados enviados à IA');
    expect(rotuloDaAcao(de(rascunho, 'criar'))).toBe('Pediu rascunho à IA');
    expect(de(apagada, 'exportar').tipoIa).toBeNull();
    expect(rotuloDaAcao(de(apagada, 'exportar'))).toBe('Dados enviados à IA');
    expect(h.itens.filter((i) => i.entidade !== 'ia').length).toBeGreaterThan(0);
    expect(h.itens.filter((i) => i.entidade !== 'ia').every((i) => !('tipoIa' in i))).toBe(true);
  });

  it('Plano 16 (Desvio 5): "Não mostrar peso no app" aparece como "Ligou"/"Desligou — Peso oculto no app"', () => {
    expect(ENTIDADE_ROTULO.peso_no_app).toBe('Peso oculto no app');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'peso_no_app' })).toBe('Ligou');
    expect(rotuloDaAcao({ acao: 'excluir', entidade: 'peso_no_app' })).toBe('Desligou');
    expect(rotuloDaAcao({ acao: 'alterar', entidade: 'peso_no_app' })).toBe('Alterou');
  });

  it('Plano 17: a configuração dos lembretes de rotina aparece como "Lembretes no app"', () => {
    expect(ENTIDADE_ROTULO.lembretes).toBe('Lembretes no app');
  });

  it('Plano 18: o "criar" do cadastro complementar (entidade_id ≠ titular) aparece como "Alterou — Cadastro do paciente"', () => {
    const titular = randomUUID();
    const cadastro = randomUUID();
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'patients', entidadeId: cadastro, patientId: titular })).toBe('Alterou');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'patients', entidadeId: titular, patientId: titular })).toBe('Criou');
    expect(rotuloDaAcao({ acao: 'alterar', entidade: 'patients', entidadeId: cadastro, patientId: titular })).toBe('Alterou');
    // a anonimização (worker) apaga o cadastro complementar: continua "Excluiu"
    expect(rotuloDaAcao({ acao: 'excluir', entidade: 'patients', entidadeId: cadastro, patientId: titular })).toBe('Excluiu');
    // sem o titular (item montado fora de listAccessHistory), o rótulo de sempre
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'patients', entidadeId: cadastro })).toBe('Criou');
    // outra entidade com entidade_id ≠ titular não muda
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'antropometria', entidadeId: cadastro, patientId: titular })).toBe('Criou');
    expect(ENTIDADE_ROTULO.patients).toBe('Cadastro do paciente');
  });
});

describe('Plano 20 (RN-319) — o Financeiro no Histórico de acessos', () => {
  it('a entidade financeiro aparece como "Financeiro"; financeiro_configuracoes não tem paciente e fica sem rótulo', () => {
    expect(ENTIDADE_ROTULO.financeiro).toBe('Financeiro');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'financeiro' })).toBe('Criou');
    expect(rotuloDaAcao({ acao: 'alterar', entidade: 'financeiro' })).toBe('Alterou');
    expect(ENTIDADE_ROTULO.financeiro_configuracoes).toBeUndefined();
  });
});

describe('Plano 15 (RN-183) — a IA Nutri no Histórico de acessos', () => {
  it('rótulos: "Perguntou à IA", "Enviou dúvida à nutricionista", "Pergunta enviada à IA"; as entidades com o nome de trabalho (desvio 6)', () => {
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia_nutri_pergunta' })).toBe('Perguntou à IA');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia_nutri_duvida' })).toBe('Enviou dúvida à nutricionista');
    expect(rotuloDaAcao({ acao: 'exportar', entidade: 'ia_nutri' })).toBe('Pergunta enviada à IA');
    expect(rotuloDaAcao({ acao: 'ler', entidade: 'ia_nutri' })).toBe('Visualizou');
    expect(rotuloDaAcao({ acao: 'alterar', entidade: 'ia_nutri' })).toBe('Alterou');
    expect(rotuloDaAcao({ acao: 'excluir', entidade: 'ia_nutri' })).toBe('Excluiu');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia_nutri_liberacao' })).toBe('Criou');
    expect(ENTIDADE_ROTULO.ia_nutri).toBe('IA Nutri (conversa com o paciente)');
    expect(ENTIDADE_ROTULO.ia_nutri_liberacao).toBe('IA Nutri — liberação');
    expect(ENTIDADE_ROTULO.ia_nutri_pergunta).toBe('IA Nutri (conversa com o paciente)');
    expect(ENTIDADE_ROTULO.ia_nutri_duvida).toBe('IA Nutri (conversa com o paciente)');
    // P15-02a: a desativação (recordAudit do módulo, consentimento.ts)
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'ia_nutri_revogacao' })).toBe('Desativou a IA Nutri');
    expect(ENTIDADE_ROTULO.ia_nutri_revogacao).toBe('IA Nutri (conversa com o paciente)');
  });

  it('pergunta respondida: "Perguntou à IA" (paciente) e "Pergunta enviada à IA" (Sistema); o criar do gatilho (pergunta, resposta, mensagem `sistema`) e os alterar do worker ficam fora da tela e da contagem', async () => {
    const { T, p, ctxP } = await conversa.pronto();
    const { mensagemId } = await perguntar(ctxP, 'o que posso comer no lugar da banana à tarde?', conversa.depsApp);
    const fake = provedorFake({ gerar: [conversa.finalOk({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] })] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, conversa.depsDoJob(fake))).toBe('respondida');
    const risco = await perguntar(ctxP, 'depois do jantar eu vomito pra não engordar', conversa.depsApp); // pergunta + `sistema`
    expect(risco.codigo).toBe('risco');
    // no audit_log está tudo: os criar do gatilho (com e sem ator) e os alterar do worker
    const brutos = await conversa.comoWorker(T, sql`select acao, actor_user_id is null as sistema, count(*)::int as n from audit_log
      where patient_id = ${p.id} and entidade = 'ia_nutri' group by 1, 2 order by 1, 2`);
    expect(brutos).toEqual(expect.arrayContaining([
      { acao: 'criar', sistema: false, n: 3 }, // as duas perguntas e a mensagem `sistema` (sessão do paciente)
      { acao: 'criar', sistema: true, n: 1 }, // a resposta, gravada pelo worker
      expect.objectContaining({ acao: 'alterar', sistema: true }),
      { acao: 'exportar', sistema: true, n: 1 },
    ]));

    const h = await listAccessHistory(T.ctx, p.id, 1, conversa.app.db);
    const daIaNutri = h.itens.filter((i) => i.entidade.startsWith('ia_nutri'));
    // mais recente primeiro: a pergunta com risco (gravada, a nutricionista a lê), a saída da primeira, a primeira, a liberação
    expect(daIaNutri.map((i) => [rotuloDaAcao(i), ENTIDADE_ROTULO[i.entidade], i.ator ? i.ator.papel : 'Sistema'])).toEqual([
      ['Perguntou à IA', 'IA Nutri (conversa com o paciente)', 'paciente'],
      ['Pergunta enviada à IA', 'IA Nutri (conversa com o paciente)', 'Sistema'],
      ['Perguntou à IA', 'IA Nutri (conversa com o paciente)', 'paciente'],
      ['Criou', 'IA Nutri — liberação', 'nutri'], // a nutricionista liberou
    ]);
    expect(daIaNutri.map((i) => i.entidadeId).slice(1, 3)).toEqual([mensagemId, mensagemId]);
    expect(h.total).toBe(h.itens.length); // a contagem também esconde
  });
});

describe('Plano 22 (RN-378, RN-383, EP-D61) — versões e nota do exame no Histórico de acessos', () => {
  it('ENTIDADE_ROTULO.exames_versoes é "Versões do exame" e ENTIDADE_ROTULO.exames_nota é "Nota de interpretação do exame"', () => {
    expect(ENTIDADE_ROTULO.exames_versoes).toBe('Versões do exame');
    expect(ENTIDADE_ROTULO.exames_nota).toBe('Nota de interpretação do exame');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'exames_nota' })).toBe('Criou');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'exames_versoes' })).toBe('Criou');
  });
});

describe('Plano 25 (RN-453, CH-D39) — Mensagens no Histórico de acessos', () => {
  it('rótulos: as entidades do chat e os atos de liberar, pausar e retomar (recordAudit do módulo)', () => {
    expect(ENTIDADE_ROTULO.chat).toBe('Mensagens (conversa com o paciente)');
    expect(ENTIDADE_ROTULO.chat_conversa).toBe('Mensagens — conversa');
    for (const e of ['chat_liberacao', 'chat_pausa', 'chat_retomada']) expect(ENTIDADE_ROTULO[e]).toBe('Mensagens (conversa com o paciente)');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'chat_liberacao' })).toBe('Liberou a conversa por mensagens');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'chat_pausa' })).toBe('Pausou a conversa por mensagens');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'chat_retomada' })).toBe('Retomou a conversa por mensagens');
    // a leitura e as escritas das mensagens ficam com os rótulos de sempre
    expect(rotuloDaAcao({ acao: 'ler', entidade: 'chat' })).toBe('Visualizou');
    expect(rotuloDaAcao({ acao: 'criar', entidade: 'chat' })).toBe('Criou');
  });

  it('a entidade neutra chat_conversa (gatilho da linha da conversa) fica no audit_log, fora da tela e da contagem', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const conversaId = randomUUID();
    await withTenant(
      T.ctx,
      (tx) =>
        recordAudit(tx, [
          { acao: 'criar', entidade: 'chat_conversa', entidadeId: conversaId, patientId: p.id },
          { acao: 'alterar', entidade: 'chat_conversa', entidadeId: conversaId, patientId: p.id },
          { acao: 'criar', entidade: 'chat_liberacao', entidadeId: conversaId, patientId: p.id },
          { acao: 'ler', entidade: 'chat', entidadeId: null, patientId: p.id },
        ]),
      app.db,
    );
    const brutos = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.patientId, p.id)), app.db);
    expect(brutos.filter((l) => l.entidade === 'chat_conversa')).toHaveLength(2);
    const h = await listAccessHistory(T.ctx, p.id, 1, app.db);
    const doChat = h.itens.filter((i) => i.entidade.startsWith('chat'));
    expect(doChat.map((i) => i.entidade).sort()).toEqual(['chat', 'chat_liberacao']);
    expect(h.total).toBe(h.itens.length);
    expect(h.itens.some((i) => i.entidade === 'chat_conversa')).toBe(false);
  });
});
