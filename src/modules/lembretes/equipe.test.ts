import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { auditLog, lembretesRotina, patients, pushSubscriptions } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { sugestaoInicial } from './config';
import { apagarLembrete, LembreteError, lembretesDoPaciente, ligarLembrete, salvarLembrete } from './equipe';

/** Plano 17 (§5.3, §5.4): o que o painel chama para ler, salvar, ligar/desligar e apagar os lembretes de um paciente. */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // publicarPlano enfileira o PDF
  await closeDb();
  await app.pool.end();
});

const db = { db: app.db };
const SP = { fuso: 'America/Sao_Paulo' };
const TODOS = [0, 1, 2, 3, 4, 5, 6];
/** Segunda-feira, 16/11/2026, 09:00 em São Paulo. */
const AGORA = new Date('2026-11-16T12:00:00Z');
const MSG_TETO = 'Com este lembrete, o paciente receberia mais de 24 avisos em um dia. Diminua os horários ou aumente o intervalo da água.';

const agua = (c: Record<string, unknown> = {}) => ({ tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: TODOS, ...c } });
const refeicoes = (c: Record<string, unknown> = {}) => ({ tipo: 'refeicoes', config: { antecedenciaMin: 0, diarioDepoisMin: null, ...c } });
const comHorarios = (tipo: 'suplemento' | 'livre', horarios: string[], texto = tipo === 'suplemento' ? 'Vitamina D' : 'Caminhar 20 minutos') => ({
  tipo,
  texto,
  config: { horarios, dias: TODOS },
});
/** Água 06:00–22:00 a cada 1 h: 17 avisos por dia. */
const AGUA_17 = agua({ inicio: '06:00', fim: '22:00', intervaloMin: 60 });

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const salvar = (input: unknown, ctx: TenantContext = T.ctx) => salvarLembrete(ctx, p.id, input, SP, db);
  const ver = (ctx: TenantContext = T.ctx) => lembretesDoPaciente(ctx, p.id, SP, { ...db, agora: AGORA });
  const ligar = (id: string, ligado: boolean, ctx: TenantContext = T.ctx) => ligarLembrete(ctx, p.id, id, ligado, db);
  const apagar = (id: string, ctx: TenantContext = T.ctx) => apagarLembrete(ctx, p.id, id, db);
  const comoPaciente = ctxPaciente(T.tenantId, p.id);
  const pacienteDesliga = (id: string) =>
    withTenant(comoPaciente, (tx) => tx.update(lembretesRotina).set({ desligadoPeloPacienteEm: new Date() }).where(eq(lembretesRotina.id, id)).returning(), app.db).then((r) => r[0]);
  const linha = (id: string) => withTenant(T.ctx, (tx) => tx.select().from(lembretesRotina).where(eq(lembretesRotina.id, id)), app.db).then((r) => r[0]);
  return { T, p, salvar, ver, ligar, apagar, comoPaciente, pacienteDesliga, linha };
}

/** Os erros por campo de um LembreteError (qualquer outro erro sobe). */
async function errosDe(p: Promise<unknown>): Promise<Record<string, string>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof LembreteError) return e.erros;
    throw e;
  }
  throw new Error('sem erro');
}

const leiturasAuditadas = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.entidade, 'lembretes'), eq(auditLog.acao, 'ler'))), app.db);

/** Inscrição de push de um vínculo (gravada pela sessão do próprio paciente, como o portal faz). */
const inscrever = (tenantId: string, patientId: string) =>
  withTenant(
    ctxPaciente(tenantId, patientId),
    (tx) => tx.insert(pushSubscriptions).values({ tenantId, patientId, endpoint: `https://push.exemplo.dev/${randomUUID()}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }),
    app.db,
  );

describe('lembretesDoPaciente e salvarLembrete (Plano 17, §5.4)', () => {
  it('salva e lê a sugestão', async () => {
    const { T, p, salvar, ver, linha } = await cenario();
    const primeira = await ver();
    expect(primeira).toMatchObject({ lembretes: [], sugestao: sugestaoInicial(), previstoHoje: 0, pausadoEm: null, planoPublicado: false, aparelhosComNotificacao: 0 });
    expect(await leiturasAuditadas(T, p.id)).toEqual([]); // nada de dado de saúde devolvido

    const { id } = await salvar(primeira.sugestao![0]);
    const v = await ver();
    expect(v.sugestao).toBeNull();
    expect(v.lembretes).toEqual([{ id, ...sugestaoInicial()[0], ligado: true, desligadoPeloPacienteEm: null }]);
    expect(v.previstoHoje).toBe(7); // 08:00–20:00 a cada 2 h
    expect(v.cortadosHoje).toEqual({ total: 0, tipos: [] });
    expect(await leiturasAuditadas(T, p.id)).toEqual([expect.objectContaining({ actorUserId: T.nutriId, entidadeId: null })]);
    expect(await linha(id)).toMatchObject({ criadoPor: T.nutriId, texto: null, ligado: true, tipo: 'agua' });
  });

  it('erros de validação voltam por campo', async () => {
    const { salvar } = await cenario();
    expect(await errosDe(salvar(agua({ inicio: '05:00' })))).toEqual({ inicio: 'Escolha um horário entre 06:00 e 22:00.' });
    expect(await errosDe(salvar(comHorarios('suplemento', ['08:00'], '  ')))).toEqual({ texto: 'Escreva o nome do suplemento.' });
  });

  it('segunda água → erro', async () => {
    const { salvar } = await cenario();
    await salvar(agua());
    expect(await errosDe(salvar(agua({ intervaloMin: 60 })))).toEqual({ geral: 'Este paciente já tem esse lembrete. Edite o que existe.' });
    await salvar(refeicoes());
    expect(await errosDe(salvar(refeicoes({ antecedenciaMin: 15 })))).toEqual({ geral: 'Este paciente já tem esse lembrete. Edite o que existe.' });
  });

  it('6º suplemento → erro (e 6º livre)', async () => {
    const { salvar } = await cenario();
    for (let i = 0; i < 5; i++) await salvar(comHorarios('suplemento', [`${String(6 + i).padStart(2, '0')}:00`], `Suplemento ${i + 1}`));
    expect(await errosDe(salvar(comHorarios('suplemento', ['12:00'])))).toEqual({ geral: 'Você já tem 5 suplementos. Apague um para adicionar outro.' });
    for (let i = 0; i < 5; i++) await salvar(comHorarios('livre', [`1${3 + i}:00`], `Livre ${i + 1}`));
    expect(await errosDe(salvar(comHorarios('livre', ['19:00'])))).toEqual({ geral: 'Você já tem 5 lembretes livres. Apague um para adicionar outro.' });
  });

  it('acima de 24 → erro', async () => {
    const { salvar, ver } = await cenario();
    await salvar(AGUA_17);
    await salvar(comHorarios('suplemento', ['06:30', '07:30', '08:30', '09:30'])); // 21
    expect(await errosDe(salvar(comHorarios('livre', ['10:30', '11:30', '12:30', '13:30'])))).toEqual({ geral: MSG_TETO });
    expect((await ver()).lembretes).toHaveLength(2);
    await salvar(comHorarios('livre', ['10:30', '11:30', '12:30'])); // 24: vale
  });

  it('desligado conta no teto', async () => {
    const { salvar, ligar, pacienteDesliga } = await cenario();
    const a = await salvar(AGUA_17);
    await pacienteDesliga(a.id); // 17, desligados pelo paciente
    const s = await salvar(comHorarios('suplemento', ['06:30', '07:30', '08:30', '09:30']));
    await ligar(s.id, false); // 4, desligados pela equipe
    await salvar(comHorarios('livre', ['10:30', '11:30'])); // 23 avisos
    expect(await errosDe(salvar(comHorarios('livre', ['12:30', '13:30'])))).toEqual({ geral: MSG_TETO });
  });

  it('na edição, o lembrete editado entra no lugar do antigo no teto', async () => {
    const { salvar } = await cenario();
    const a = await salvar(AGUA_17);
    await salvar(comHorarios('suplemento', ['06:30', '07:30', '08:30', '09:30'])); // 21
    // a água a cada 2 h (9 avisos) no lugar da de 1 h: 13
    await salvar({ id: a.id, ...agua({ inicio: '06:00', fim: '22:00', intervaloMin: 120 }) });
    await salvar(comHorarios('livre', ['10:30', '11:30', '12:30', '13:30'])); // 17
    // voltar a água para 1 h passaria de 24 (17 + 4 + 4)
    expect(await errosDe(salvar({ id: a.id, ...AGUA_17 }))).toEqual({ geral: MSG_TETO });
  });

  it('editar troca a configuração e o texto, mas não o tipo', async () => {
    const { salvar, ver, linha } = await cenario();
    const s = await salvar(comHorarios('suplemento', ['08:00']));
    expect(await salvar({ id: s.id, ...comHorarios('suplemento', ['09:00', '21:00'], 'Ômega 3') })).toEqual({ id: s.id });
    expect(await linha(s.id)).toMatchObject({ texto: 'Ômega 3', config: { horarios: ['09:00', '21:00'], dias: TODOS } });
    expect(await errosDe(salvar({ id: s.id, ...comHorarios('livre', ['08:00']) }))).toEqual({ tipo: 'Formulário inválido.' });
    expect(await errosDe(salvar({ id: randomUUID(), ...agua() }))).toEqual({ geral: 'Lembrete não encontrado. Recarregue a página.' });
    expect((await ver()).lembretes).toHaveLength(1);
  });

  it('editar não religa o que o paciente desligou', async () => {
    const { salvar, ver, ligar, pacienteDesliga, linha } = await cenario();
    const a = await salvar(agua());
    const desligado = await pacienteDesliga(a.id);
    expect(desligado.desligadoPeloPacienteEm).not.toBeNull();

    await salvar({ id: a.id, ...agua({ intervaloMin: 60 }) });
    await ligar(a.id, false);
    await ligar(a.id, true);
    expect(await linha(a.id)).toMatchObject({ ligado: true, desligadoPeloPacienteEm: desligado.desligadoPeloPacienteEm, config: { intervaloMin: 60 } });
    const v = await ver();
    expect(v.lembretes[0].desligadoPeloPacienteEm).toEqual(desligado.desligadoPeloPacienteEm);
    expect(v.previstoHoje).toBe(0); // desligado pelo paciente não sai
  });

  it('ligar e desligar pela equipe', async () => {
    const { salvar, ver, ligar } = await cenario();
    const a = await salvar(agua());
    await ligar(a.id, false);
    expect(await ver()).toMatchObject({ lembretes: [{ id: a.id, ligado: false }], previstoHoje: 0 });
    await ligar(a.id, true);
    expect(await ver()).toMatchObject({ lembretes: [{ id: a.id, ligado: true }], previstoHoje: 7 });
  });

  it('apaga o lembrete', async () => {
    const { salvar, ver, apagar } = await cenario();
    const a = await salvar(agua());
    await apagar(a.id);
    expect(await ver()).toMatchObject({ lembretes: [], sugestao: sugestaoInicial() });
    expect(await errosDe(apagar(a.id))).toEqual({ geral: 'Lembrete não encontrado. Recarregue a página.' });
  });

  it('não apaga o lembrete desligado pelo paciente', async () => {
    const { salvar, apagar, pacienteDesliga, linha } = await cenario();
    const a = await salvar(agua());
    await pacienteDesliga(a.id);
    expect(await errosDe(apagar(a.id))).toEqual({ geral: 'O paciente desligou este lembrete. Você pode desligá-lo do seu lado, mas não apagá-lo.' });
    expect(await linha(a.id)).toBeDefined();
  });

  it('paciente bloqueado: nada muda', async () => {
    const { T, p, salvar, ligar, apagar } = await cenario();
    const a = await salvar(agua());
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    await expect(salvar(refeicoes())).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(ligar(a.id, false)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(apagar(a.id)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('outro tenant não vê', async () => {
    const { salvar, ver, ligar, apagar, linha } = await cenario();
    const a = await salvar(agua());
    const outro = await novoTenant(app.db, 'Outra Nutri');
    await expect(ver(outro.ctx)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(salvar(refeicoes(), outro.ctx)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(ligar(a.id, false, outro.ctx)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(apagar(a.id, outro.ctx)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await linha(a.id)).toMatchObject({ ligado: true });
  });

  it('lembrete de outro paciente do mesmo consultório não é alcançado', async () => {
    const { T, salvar, linha } = await cenario();
    const a = await salvar(agua());
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await errosDe(ligarLembrete(T.ctx, outro.id, a.id, false, db))).toEqual({ geral: 'Lembrete não encontrado. Recarregue a página.' });
    expect(await errosDe(apagarLembrete(T.ctx, outro.id, a.id, db))).toEqual({ geral: 'Lembrete não encontrado. Recarregue a página.' });
    expect(await errosDe(salvarLembrete(T.ctx, outro.id, { id: a.id, ...agua() }, SP, db))).toEqual({ geral: 'Lembrete não encontrado. Recarregue a página.' });
    expect(await linha(a.id)).toMatchObject({ ligado: true });
  });

  it('aparelhosComNotificacao conta só as inscrições do vínculo', async () => {
    const { T, p, ver } = await cenario();
    await inscrever(T.tenantId, p.id);
    await inscrever(T.tenantId, p.id);
    const outroPaciente = await novoPaciente(app.db, T.ctx);
    await inscrever(T.tenantId, outroPaciente.id);
    // a mesma pessoa em outro consultório (outro vínculo)
    const outroTenant = await novoTenant(app.db, 'Outra Nutri');
    const outroVinculo = await novoPaciente(app.db, outroTenant.ctx, { email: p.email });
    await inscrever(outroTenant.tenantId, outroVinculo.id);
    expect((await ver()).aparelhosComNotificacao).toBe(2);
  });

  it('pausa geral do paciente aparece e nada é previsto', async () => {
    const { p, salvar, ver, comoPaciente } = await cenario();
    await salvar(agua());
    await withTenant(comoPaciente, (tx) => tx.update(patients).set({ lembretesPausadosEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    const v = await ver();
    expect(v.pausadoEm).toBeInstanceOf(Date);
    expect(v.previstoHoje).toBe(0);
  });
});

describe('refeições do plano publicado', () => {
  it('planoPublicado falso sem plano publicado', async () => {
    const { salvar, ver } = await cenario();
    await salvar(refeicoes());
    expect(await ver()).toMatchObject({ planoPublicado: false, previstoHoje: 0, refeicoesSemHorario: [], refeicoesForaDaJanela: [] });
  });

  it('com plano publicado: avisos das refeições e refeição fora da janela', async () => {
    const { T, p, salvar, ver, ligar } = await cenario();
    await planoPublicado(app.db, T, p.id, {
      refeicoes: [
        { nome: 'Café da manhã', horario: '07:00' },
        { nome: 'Almoço', horario: '12:30' },
        { nome: 'Ceia', horario: '22:30' },
      ],
    });
    const r = await salvar(refeicoes({ diarioDepoisMin: 30 }));
    const v = await ver();
    // (a publicação exige horário em toda refeição; `refeicoesSemHorario` está coberto em slots.test.ts)
    expect(v).toMatchObject({ planoPublicado: true, refeicoesSemHorario: [], refeicoesForaDaJanela: ['Ceia'] });
    expect(v.previstoHoje).toBe(4); // 07:00, 07:30, 12:30, 13:00 (a Ceia das 22:30 e o diário dela ficam fora)
    // o aviso da refeição fora da janela continua com o lembrete desligado pela equipe (é o que a seção mostra ao lado dele)
    await ligar(r.id, false);
    expect(await ver()).toMatchObject({ previstoHoje: 0, refeicoesForaDaJanela: ['Ceia'] });
  });

  it('Plano 19 (RN-247 f): o previsto para hoje (segunda) conta só as refeições de hoje', async () => {
    const { T, p, salvar, ver } = await cenario();
    await planoPublicado(app.db, T, p.id, {
      refeicoes: [
        { nome: 'Café da manhã', horario: '07:00' },
        { nome: 'Almoço', horario: '12:30', dias: [1, 2, 3, 4, 5] },
        { nome: 'Almoço', horario: '13:30', dias: [0, 6] },
        { nome: 'Ceia', horario: '22:30', dias: [6] },
      ],
    });
    await salvar(refeicoes({ diarioDepoisMin: 30 }));
    // 07:00, 07:30, 12:30, 13:00; o Almoço das 13:30 e a Ceia são do fim de semana — o aviso da Ceia é do plano e continua
    expect(await ver()).toMatchObject({ previstoHoje: 4, refeicoesForaDaJanela: ['Ceia'] });
  });

  it('Plano 19: o teto ao salvar conta as refeições de cada dia (seg–sex e sáb–dom não se somam)', async () => {
    const { T, p, salvar } = await cenario();
    await planoPublicado(app.db, T, p.id, {
      refeicoes: [
        ...['07:15', '12:15', '19:15'].map((horario) => ({ nome: 'Refeição', horario, dias: [1, 2, 3, 4, 5] })),
        ...['08:15', '13:15', '20:15'].map((horario) => ({ nome: 'Refeição', horario, dias: [0, 6] })),
      ],
    });
    await salvar(refeicoes({ diarioDepoisMin: 30 })); // 6 por dia (somados, 12)
    await salvar(AGUA_17); // 23 por dia (somados, 29)
    expect(await errosDe(salvar(comHorarios('suplemento', ['06:30', '07:30'])))).toEqual({ geral: MSG_TETO }); // 25
  });

  it('as refeições do plano contam no teto ao salvar', async () => {
    const { T, p, salvar } = await cenario();
    await planoPublicado(app.db, T, p.id, {
      refeicoes: [
        { nome: 'Café da manhã', horario: '07:15' },
        { nome: 'Almoço', horario: '12:15' },
        { nome: 'Jantar', horario: '19:15' },
      ],
    });
    await salvar(refeicoes({ diarioDepoisMin: 30 })); // 6
    await salvar(AGUA_17); // 23
    expect(await errosDe(salvar(comHorarios('suplemento', ['06:30', '07:30'])))).toEqual({ geral: MSG_TETO });
  });
});
