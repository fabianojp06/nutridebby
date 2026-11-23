import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import { availabilityRules, locaisAtendimento, publicBookingRequests, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MSG_LOCAIS } from './constantes';
import {
  arquivarLocal,
  definirPrincipal,
  excluirLocal,
  garantirLocaisIniciais,
  linkSugerido,
  listarLocais,
  localDaConsulta,
  locaisAtivos,
  locaisParaAgendamento,
  LocalError,
  reativarLocal,
  salvarLocal,
} from './locais';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só para ver, em pg_stat_activity, que a exclusão ficou presa na trava da FK
afterAll(() => Promise.all([app.pool.end(), owner.pool.end()]));
const deps = { db: app.db };

const PRESENCIAL = { tipo: 'presencial', nome: 'Clínica Centro', endereco: 'Rua A, 10', cidade: 'Recife', mostrarEndereco: 'on', agendamentoOnline: 'on' };
const ONLINE = { tipo: 'online', nome: 'Sala Meet', linkSala: 'https://meet.exemplo.test/debby', agendamentoOnline: 'on' };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof LocalError) return e.erros;
    throw e;
  }
  throw new Error('esperava LocalError');
};
const linhas = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select().from(locaisAtendimento).orderBy(locaisAtendimento.createdAt, locaisAtendimento.id), app.db);
const linha = async (T: TenantDeTeste, id: string) => (await linhas(T)).find((l) => l.id === id)!;
const principais = async (T: TenantDeTeste) => (await linhas(T)).filter((l) => l.principal && !l.arquivadoEm).map((l) => l.id);
const regraNoLocal = (T: TenantDeTeste, localId: string, modalidade: 'presencial' | 'online' = 'presencial') =>
  withTenant(T.ctx, (tx) => tx.insert(availabilityRules).values({ tenantId: T.tenantId, diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade, localId }), app.db);

/** O `db` com a contagem das transações abertas por ele (cada withTenant abre uma). */
function contandoTransacoes(db: Db): { db: Db; n: () => number } {
  let n = 0;
  const contado = new Proxy(db, {
    get(alvo, chave, rec) {
      if (chave === 'transaction') return (...a: Parameters<Db['transaction']>) => (n++, alvo.transaction(...a));
      return Reflect.get(alvo, chave, rec);
    },
  });
  return { db: contado, n: () => n };
}

describe('locais de atendimento (US-400)', () => {
  it('cria presencial e online; no online, endereço, cidade e "mostrar o endereço" são ignorados', async () => {
    const T = await novoTenant(app.db);
    const p = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    expect(await linha(T, p.id)).toMatchObject({ nome: 'Clínica Centro', tipo: 'presencial', endereco: 'Rua A, 10', cidade: 'Recife', mostrarEndereco: true, linkSala: null, agendamentoOnline: true, arquivadoEm: null });
    const o = await salvarLocal(T.ctx, null, { ...ONLINE, endereco: 'Rua B, 2', cidade: 'Olinda', mostrarEndereco: 'on' }, deps);
    expect(await linha(T, o.id)).toMatchObject({ nome: 'Sala Meet', tipo: 'online', endereco: null, cidade: null, mostrarEndereco: false, linkSala: 'https://meet.exemplo.test/debby', agendamentoOnline: true, principal: false });
    // o primeiro local de um consultório sem principal vira o principal (o segundo, não)
    expect(await principais(T)).toEqual([p.id]);
    // edição: nome aparado, endereço vazio vira nulo, checkboxes desmarcados
    await salvarLocal(T.ctx, p.id, { tipo: 'presencial', nome: '  Clínica Norte ', endereco: ' ', cidade: '' }, deps);
    expect(await linha(T, p.id)).toMatchObject({ nome: 'Clínica Norte', endereco: null, cidade: null, mostrarEndereco: false, agendamentoOnline: false, principal: true });
  });

  it('"Já existe um local com este nome." sem diferença de maiúsculas (também na edição); arquivado não conta', async () => {
    const T = await novoTenant(app.db);
    const a = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    expect(await erros(salvarLocal(T.ctx, null, { ...ONLINE, nome: 'CLÍNICA centro' }, deps))).toEqual({ nome: MSG_LOCAIS.nomeRepetido });
    const b = await salvarLocal(T.ctx, null, { ...ONLINE, nome: 'Outro' }, deps);
    expect(await erros(salvarLocal(T.ctx, b.id, { ...ONLINE, nome: 'clínica centro' }, deps))).toEqual({ nome: MSG_LOCAIS.nomeRepetido });
    await salvarLocal(T.ctx, b.id, { ...ONLINE, nome: 'Outro' }, deps); // o próprio nome não conflita com ele mesmo
    await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Antigo' }, deps).then((x) => arquivarLocal(T.ctx, x.id, deps));
    await expect(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'antigo' }, deps)).resolves.toHaveProperty('id');
    expect((await linhas(T)).filter((l) => l.id === a.id)).toHaveLength(1);
  });

  it('"O nome tem de 2 a 60 caracteres." com 1 e 61; 2 e 60 passam', async () => {
    const T = await novoTenant(app.db);
    expect(await erros(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'A' }, deps))).toEqual({ nome: MSG_LOCAIS.nomeTamanho });
    expect(await erros(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'A'.repeat(61) }, deps))).toEqual({ nome: MSG_LOCAIS.nomeTamanho });
    expect(await erros(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: '   ' }, deps))).toEqual({ nome: MSG_LOCAIS.nomeTamanho });
    await expect(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'AB' }, deps)).resolves.toHaveProperty('id');
    await expect(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'B'.repeat(60) }, deps)).resolves.toHaveProperty('id');
  });

  it('sala sem https:// e agendamento pelo paciente num online sem sala: mensagens; tipo e tamanhos', async () => {
    const T = await novoTenant(app.db);
    expect(await erros(salvarLocal(T.ctx, null, { ...ONLINE, linkSala: 'http://meet.exemplo.test/x' }, deps))).toEqual({ linkSala: MSG_LOCAIS.link });
    expect(await erros(salvarLocal(T.ctx, null, { ...ONLINE, linkSala: 'https://meet exemplo' }, deps))).toEqual({ linkSala: MSG_LOCAIS.link });
    expect(await erros(salvarLocal(T.ctx, null, { ...ONLINE, linkSala: '' }, deps))).toEqual({ agendamentoOnline: MSG_LOCAIS.agendamentoSemSala });
    await expect(salvarLocal(T.ctx, null, { ...ONLINE, linkSala: '', agendamentoOnline: '' }, deps)).resolves.toHaveProperty('id');
    expect(await erros(salvarLocal(T.ctx, null, { ...ONLINE, nome: 'X1', linkSala: `https://m.test/${'a'.repeat(500)}` }, deps))).toEqual({ linkSala: MSG_LOCAIS.linkLongo });
    expect(await erros(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'X2', endereco: 'a'.repeat(301) }, deps))).toEqual({ endereco: MSG_LOCAIS.enderecoLongo });
    expect(await erros(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'X3', cidade: 'a'.repeat(81) }, deps))).toEqual({ cidade: MSG_LOCAIS.cidadeLonga });
    expect(await erros(salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'X4', tipo: 'drive-thru' }, deps))).toEqual({ tipo: MSG_LOCAIS.tipo });
  });

  it('"Definir como principal" troca numa transação: duas trocas ao mesmo tempo terminam com um principal só', async () => {
    const T = await novoTenant(app.db);
    await listarLocais(T.ctx, { arquivados: false }, deps); // cria o "Consultório" principal (AG-D45)
    const [consultorio] = await principais(T);
    const b = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Sala B' }, deps);
    const c = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Sala C' }, deps);
    await definirPrincipal(T.ctx, b.id, deps);
    expect(await principais(T)).toEqual([b.id]);
    expect((await linha(T, consultorio)).principal).toBe(false);
    // conexões do pool já abertas: sem isso, a 1ª troca termina antes de a 2ª conseguir conexão e a corrida nem acontece
    await Promise.all([listarLocais(T.ctx, { arquivados: false }, deps), listarLocais(T.ctx, { arquivados: false }, deps)]);
    const r = await Promise.allSettled([definirPrincipal(T.ctx, consultorio, deps), definirPrincipal(T.ctx, c.id, deps)]);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
    const fim = await principais(T);
    expect(fim).toHaveLength(1);
    expect([consultorio, c.id]).toContain(fim[0]);
    // arquivado não vira principal
    const d = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Sala D' }, deps);
    await arquivarLocal(T.ctx, d.id, deps);
    expect(await erros(definirPrincipal(T.ctx, d.id, deps))).toEqual({ geral: MSG_LOCAIS.naoEncontrado });
    expect(await principais(T)).toEqual(fim);
  });

  it('arquivar: o principal não se arquiva; arquivar desliga o agendamento pelo paciente; reativar o devolve sem agendamento', async () => {
    const T = await novoTenant(app.db);
    const p = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    expect(await erros(arquivarLocal(T.ctx, p.id, deps))).toEqual({ geral: MSG_LOCAIS.principalNaoArquiva });
    const o = await salvarLocal(T.ctx, null, ONLINE, deps);
    await arquivarLocal(T.ctx, o.id, deps);
    expect(await linha(T, o.id)).toMatchObject({ agendamentoOnline: false, arquivadoEm: expect.any(Date) });
    expect((await listarLocais(T.ctx, { arquivados: false }, deps)).locais.map((l) => l.id)).toEqual([p.id]);
    expect((await listarLocais(T.ctx, { arquivados: true }, deps)).locais.map((l) => l.id)).toEqual([o.id]);
    await reativarLocal(T.ctx, o.id, deps);
    expect(await linha(T, o.id)).toMatchObject({ agendamentoOnline: false, arquivadoEm: null });
    // reativar com o nome já usado por um ativo: a mensagem do nome
    await arquivarLocal(T.ctx, o.id, deps);
    await salvarLocal(T.ctx, null, { ...ONLINE, nome: 'sala meet' }, deps);
    expect(await erros(reativarLocal(T.ctx, o.id, deps))).toEqual({ geral: MSG_LOCAIS.nomeRepetido });
  });

  it('excluir: sem uso sai; em uso, a mensagem — também quando o uso nasce entre a conferência e o DELETE (23503)', async () => {
    const T = await novoTenant(app.db);
    const principal = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    const livre = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Livre' }, deps);
    await excluirLocal(T.ctx, livre.id, deps);
    expect((await linhas(T)).map((l) => l.id)).toEqual([principal.id]);
    // consulta
    const comConsulta = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Com consulta' }, deps);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-12-01T13:00:00Z'), 60, { localId: comConsulta.id });
    expect(await erros(excluirLocal(T.ctx, comConsulta.id, deps))).toEqual({ geral: MSG_LOCAIS.emUso });
    // regra
    const comRegra = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Com regra' }, deps);
    await regraNoLocal(T, comRegra.id);
    expect(await erros(excluirLocal(T.ctx, comRegra.id, deps))).toEqual({ geral: MSG_LOCAIS.emUso });
    // o principal não se exclui (a tela não oferece; o servidor recusa)
    expect(await erros(excluirLocal(T.ctx, principal.id, deps))).toEqual({ geral: MSG_LOCAIS.principalNaoArquiva });
    // corrida: outra transação grava a regra no local e segura o commit; a exclusão confere (não vê), apaga e fica presa na FK
    const corrida = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Corrida' }, deps);
    const outra = await app.pool.connect();
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query(`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade, local_id) values ($1, 3, '08:00', '09:00', 60, 'presencial', $2)`, [T.tenantId, corrida.id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const resultado = erros(excluirLocal(T.ctx, corrida.id, deps));
      for (let i = 0; ; i++) {
        const presa = await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid]);
        if (presa.rowCount) break;
        if (i > 200) throw new Error('a exclusão não ficou presa na trava da FK');
        await new Promise((r) => setTimeout(r, 25));
      }
      await outra.query('commit');
      expect(await resultado).toEqual({ geral: MSG_LOCAIS.emUso });
    } finally {
      outra.release();
    }
    expect((await linhas(T)).map((l) => l.id)).toContain(corrida.id);
  });

  it('tipo: muda sem uso; com consulta, regra ou pedido é recusado', async () => {
    const T = await novoTenant(app.db);
    const p = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    const l = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Muda' }, deps);
    await salvarLocal(T.ctx, l.id, { ...ONLINE, nome: 'Muda' }, deps);
    expect(await linha(T, l.id)).toMatchObject({ tipo: 'online', endereco: null, cidade: null, linkSala: ONLINE.linkSala });
    await regraNoLocal(T, l.id, 'online');
    expect(await erros(salvarLocal(T.ctx, l.id, { ...PRESENCIAL, nome: 'Muda' }, deps))).toEqual({ tipo: MSG_LOCAIS.tipoFixo });
    // sem o campo (a tela mostra o tipo como texto), o tipo gravado continua
    await salvarLocal(T.ctx, l.id, { nome: 'Muda 2', linkSala: '' }, deps);
    expect(await linha(T, l.id)).toMatchObject({ tipo: 'online', nome: 'Muda 2', linkSala: null });
    expect((await listarLocais(T.ctx, { arquivados: false }, deps)).locais.map((x) => [x.id, x.emUso])).toEqual([
      [p.id, false],
      [l.id, true],
    ]);
    // consulta e pedido da pessoa nova também prendem o tipo (e contam como uso na tela)
    const comConsulta = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Com consulta' }, deps);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-12-03T13:00:00Z'), 60, { localId: comConsulta.id });
    expect(await erros(salvarLocal(T.ctx, comConsulta.id, { ...ONLINE, nome: 'Com consulta' }, deps))).toEqual({ tipo: MSG_LOCAIS.tipoFixo });
    const comPedido = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Com pedido' }, deps);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.insert(publicBookingRequests).values({
          id: crypto.randomUUID(), tenantId: T.tenantId, tokenHash: crypto.randomUUID(), codigoHash: 'x', email: 'pessoa@exemplo.test', nome: 'Pessoa Nova', inicio: new Date('2026-12-04T13:00:00Z'),
          modalidade: 'presencial', localId: comPedido.id, termoVersao: '1.0', expiraEm: new Date('2026-12-04T13:10:00Z'),
        }),
      app.db,
    );
    expect(await erros(salvarLocal(T.ctx, comPedido.id, { ...ONLINE, nome: 'Com pedido' }, deps))).toEqual({ tipo: MSG_LOCAIS.tipoFixo });
    expect((await listarLocais(T.ctx, { arquivados: false }, deps)).locais.filter((x) => x.emUso).map((x) => x.id)).toEqual([l.id, comConsulta.id, comPedido.id]);
  });

  it('id que não é uuid ou de outro consultório: "não encontrado", sem mexer em nada', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const a = await salvarLocal(A.ctx, null, PRESENCIAL, deps);
    await salvarLocal(A.ctx, null, { ...PRESENCIAL, nome: 'Outro' }, deps);
    for (const f of [
      () => salvarLocal(B.ctx, a.id, PRESENCIAL, deps),
      () => definirPrincipal(B.ctx, a.id, deps),
      () => arquivarLocal(B.ctx, a.id, deps),
      () => reativarLocal(B.ctx, a.id, deps),
      () => excluirLocal(B.ctx, a.id, deps),
      () => salvarLocal(A.ctx, 'nao-e-uuid', PRESENCIAL, deps),
    ]) expect(await erros(f())).toEqual({ geral: MSG_LOCAIS.naoEncontrado });
    expect((await linhas(A)).map((l) => [l.nome, l.principal, l.arquivadoEm])).toEqual([
      ['Clínica Centro', true, null],
      ['Outro', false, null],
    ]);
  });

  it('a sessão de paciente (e qualquer papel fora da nutricionista) para antes de abrir a transação (RN-400)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = contandoTransacoes(app.db);
    const paciente = ctxPaciente(T.tenantId, p.id);
    const id = crypto.randomUUID();
    for (const f of [
      () => listarLocais(paciente, { arquivados: false }, { db: c.db }),
      () => salvarLocal(paciente, null, PRESENCIAL, { db: c.db }),
      () => definirPrincipal(paciente, id, { db: c.db }),
      () => arquivarLocal(paciente, id, { db: c.db }),
      () => reativarLocal(paciente, id, { db: c.db }),
      () => excluirLocal(paciente, id, { db: c.db }),
      () => listarLocais({ tenantId: T.tenantId, role: 'worker' }, { arquivados: false }, { db: c.db }),
    ]) await expect(f()).rejects.toThrow('locais de atendimento: só a sessão da nutricionista');
    expect(c.n()).toBe(0);
  });
});

describe('garantirLocaisIniciais (AG-D45, RN-410a)', () => {
  const tenantDe = async (T: TenantDeTeste) => (await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0];

  it('consultório sem local: duas chamadas ao mesmo tempo criam o "Consultório" (principal, presencial, com agendamento e o endereço do Perfil) uma vez', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ enderecoConsultorio: 'Rua do Perfil, 5' }).where(eq(tenants.id, T.tenantId));
    const tenant = await tenantDe(T);
    await Promise.all([withTenant(T.ctx, async () => undefined, app.db), withTenant(T.ctx, async () => undefined, app.db)]);
    await Promise.all([withTenant(T.ctx, (tx) => garantirLocaisIniciais(tx, tenant), app.db), withTenant(T.ctx, (tx) => garantirLocaisIniciais(tx, tenant), app.db)]);
    expect((await linhas(T)).map((l) => ({ nome: l.nome, tipo: l.tipo, endereco: l.endereco, principal: l.principal, agendamentoOnline: l.agendamentoOnline }))).toEqual([
      { nome: 'Consultório', tipo: 'presencial', endereco: 'Rua do Perfil, 5', principal: true, agendamentoOnline: true },
    ]);
    // idempotente: com local, não cria outro
    await withTenant(T.ctx, (tx) => garantirLocaisIniciais(tx, tenant), app.db);
    expect(await linhas(T)).toHaveLength(1);
  });

  it('regra "ambas" sem local vira presencial + par online quando há local online ativo; sem online, fica presencial; as outras vão para o local do tipo', async () => {
    const T = await novoTenant(app.db);
    const tenant = await tenantDe(T);
    const ids = await withTenant(
      T.ctx,
      async (tx) => {
        const [c] = await tx.insert(locaisAtendimento).values({ tenantId: T.tenantId, nome: 'Consultório', tipo: 'presencial', agendamentoOnline: true, principal: true }).returning();
        const [v] = await tx.insert(locaisAtendimento).values({ tenantId: T.tenantId, nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.exemplo.test/x' }).returning();
        const base = { tenantId: T.tenantId, inicio: '08:00', fim: '12:00', duracaoMin: 60 };
        const [ambas] = await tx.insert(availabilityRules).values({ ...base, diaSemana: 1, modalidade: 'ambas' }).returning();
        const [online] = await tx.insert(availabilityRules).values({ ...base, diaSemana: 2, modalidade: 'online' }).returning();
        const [presencial] = await tx.insert(availabilityRules).values({ ...base, diaSemana: 3, modalidade: 'presencial' }).returning();
        return { c: c.id, v: v.id, ambas: ambas.id, online: online.id, presencial: presencial.id };
      },
      app.db,
    );
    await withTenant(T.ctx, (tx) => garantirLocaisIniciais(tx, tenant), app.db);
    await withTenant(T.ctx, (tx) => garantirLocaisIniciais(tx, tenant), app.db); // idempotente: a cópia não dobra
    const regras = await withTenant(T.ctx, (tx) => tx.select().from(availabilityRules).orderBy(availabilityRules.diaSemana, availabilityRules.modalidade), app.db);
    expect(regras.map((r) => [r.diaSemana, r.modalidade, r.localId])).toEqual([
      [1, 'online', ids.v],
      [1, 'presencial', ids.c],
      [2, 'online', ids.v],
      [3, 'presencial', ids.c],
    ]);
    expect(regras.find((r) => r.id === ids.ambas)).toMatchObject({ modalidade: 'presencial', localId: ids.c });

    // sem local online ativo: "ambas" fica presencial (sem cópia); a online sem local espera
    const U = await novoTenant(app.db);
    await withTenant(
      U.ctx,
      (tx) =>
        tx.insert(availabilityRules).values([
          { tenantId: U.tenantId, diaSemana: 1, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'ambas' },
          { tenantId: U.tenantId, diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'online' },
        ]),
      app.db,
    );
    await withTenant(U.ctx, async (tx) => garantirLocaisIniciais(tx, await tenantDe(U)), app.db);
    const [consultorio] = await linhas(U);
    expect((await withTenant(U.ctx, (tx) => tx.select().from(availabilityRules).orderBy(availabilityRules.diaSemana), app.db)).map((r) => [r.diaSemana, r.modalidade, r.localId])).toEqual([
      [1, 'presencial', consultorio.id],
      [2, 'online', null],
    ]);
    expect(await withTenant(U.ctx, (tx) => tx.select().from(availabilityRules).where(and(isNull(availabilityRules.localId), eq(availabilityRules.modalidade, 'ambas'))), app.db)).toEqual([]);
  });
});

describe('aviso do link do Perfil (RN-410a, P23-I1)', () => {
  it('avisoLinkDivergente: link padrão não nulo e diferente da sala do local "Videoconferência"', async () => {
    const T = await novoTenant(app.db);
    const sala = 'https://sala.exemplo.test/debby';
    await app.db.update(tenants).set({ linkOnlinePadrao: sala }).where(eq(tenants.id, T.tenantId));
    const aviso = async () => (await listarLocais(T.ctx, { arquivados: false }, deps)).avisoLinkDivergente;
    expect(await aviso()).toBe(false); // sem "Videoconferência": nada a conferir
    const v = await salvarLocal(T.ctx, null, { ...ONLINE, nome: 'Videoconferência', linkSala: sala }, deps);
    expect(await aviso()).toBe(false);
    await app.db.update(tenants).set({ linkOnlinePadrao: 'https://sala.exemplo.test/nova' }).where(eq(tenants.id, T.tenantId));
    expect(await aviso()).toBe(true);
    await salvarLocal(T.ctx, v.id, { ...ONLINE, nome: 'Videoconferência', linkSala: '', agendamentoOnline: '' }, deps);
    expect(await aviso()).toBe(true);
    await app.db.update(tenants).set({ linkOnlinePadrao: null }).where(eq(tenants.id, T.tenantId));
    expect(await aviso()).toBe(false);
  });
});

describe('leituras para as outras telas', () => {
  it('locaisAtivos (sessão nutri): ativos, principal primeiro; linkSugerido só do online com sala', async () => {
    const T = await novoTenant(app.db);
    const a = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    const o = await salvarLocal(T.ctx, null, ONLINE, deps);
    const arq = await salvarLocal(T.ctx, null, { ...PRESENCIAL, nome: 'Arquivado' }, deps);
    await arquivarLocal(T.ctx, arq.id, deps);
    await definirPrincipal(T.ctx, o.id, deps);
    const ativos = await withTenant(T.ctx, (tx) => locaisAtivos(tx), app.db);
    expect(ativos.map((l) => l.id)).toEqual([o.id, a.id]);
    expect(linkSugerido(ativos[0])).toBe(ONLINE.linkSala);
    expect(linkSugerido(ativos[1])).toBeNull();
    expect(linkSugerido({ tipo: 'online', linkSala: null })).toBeNull();
  });

  it('locaisParaAgendamento no publico: só a projeção, sem linkSala nas chaves; localDaConsulta do próprio paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await salvarLocal(T.ctx, null, PRESENCIAL, deps);
    const o = await salvarLocal(T.ctx, null, ONLINE, deps);
    const publico = await withTenant({ tenantId: T.tenantId, role: 'publico' }, (tx) => locaisParaAgendamento(tx), app.db);
    expect(publico.map((l) => l.id)).toEqual([p.id, o.id]);
    for (const l of publico) expect(Object.keys(l).sort()).toEqual(['agendamentoOnline', 'cidade', 'criadoEm', 'endereco', 'id', 'nome', 'principal', 'tipo']);
    expect(publico[0]).toMatchObject({ nome: 'Clínica Centro', tipo: 'presencial', cidade: 'Recife', endereco: 'Rua A, 10', principal: true, agendamentoOnline: true });
    expect(JSON.stringify(publico)).not.toContain('meet.exemplo.test');
    const ana = await novoPaciente(app.db, T.ctx);
    const consulta = await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-12-02T13:00:00Z'), 60, { localId: p.id });
    const doPaciente = await withTenant(ctxPaciente(T.tenantId, ana.id), (tx) => localDaConsulta(tx, consulta), app.db);
    expect(doPaciente).toEqual({ nome: 'Clínica Centro', tipo: 'presencial', cidade: 'Recife', endereco: 'Rua A, 10' });
    expect(await withTenant(ctxPaciente(T.tenantId, ana.id), (tx) => localDaConsulta(tx, crypto.randomUUID()), app.db)).toBeNull();
    // a sessão nutri não lê pela projeção (a função devolve vazio fora do publico/paciente)
    expect(await withTenant(T.ctx, (tx) => locaisParaAgendamento(tx), app.db)).toEqual([]);
  });
});
