import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { stopBoss } from '@/jobs/boss';
import { consultorioDoChat, mensagemDoDono, naSessao, pacienteDoChat, recadoPara } from '../../../test/mensagens';
import { novoPaciente, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb, type Db } from '@/db/client';
import { caixaDeMensagens, contadorDeMensagens, pacientesParaNovaConversa } from './caixa';
import { conversaNoPainel } from './conversa';
import { enviarComoNutri, enviarComoPaciente } from './envio';

/** Plano 25, T3 (US-442, RN-453, RN-459, RN-463; CH-D42, CH-D66): caixa, contador e "Nova conversa" — sem texto e sem auditRead. */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  // T4: o envio dispara o motor de avisos (pg-boss) e enfileira e-mail
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});

const consultorio = () => consultorioDoChat(app.db, owner.pool);
const lidas = async (T: TenantDeTeste) => (await naSessao(app.db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`))[0].n;
const semTransacao = () => {
  const transaction = vi.fn(() => {
    throw new Error('abriu transação');
  });
  return { db: { transaction } as unknown as Db, transaction };
};

describe('Plano 25 — caixaDeMensagens (US-442, CH-D42)', () => {
  it('lista conversas liberadas ou com mensagem individual; a só de recado fica fora; risco não lido no topo; nunca o texto', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(app.db, T, { nome: 'Ana Souza' });
    const bia = await pacienteDoChat(app.db, T, { nome: 'Bia Lima' });
    const caio = await pacienteDoChat(app.db, T, { nome: 'Caio Reis', liberar: false });
    const davi = await pacienteDoChat(app.db, T, { nome: 'Davi Melo' }); // liberada, sem mensagem
    await enviarComoPaciente(ana.P, { texto: 'meu peito dói' }, app.db); // risco
    await enviarComoNutri(T.ctx, bia.p, { texto: 'Oi, Bia' }, app.db); // a mais recente
    await recadoPara(app.db, T, [ana.p, bia.p, caio.p]); // Caio: só recado → fora da caixa
    await enviarComoNutri(T.ctx, bia.p, { texto: 'Mais uma' }, app.db);
    const antes = await lidas(T);
    const r = await caixaDeMensagens(T.ctx, { filtro: 'todas' }, app.db);
    expect(r.haMais).toBe(false);
    expect(r.itens.map((i) => [i.nome, i.tipo, i.naoLidas, i.riscoNaoLido])).toEqual([
      ['Ana Souza', 'recado', 1, true],
      ['Bia Lima', 'nutri', 0, false],
      ['Davi Melo', null, 0, false],
    ]);
    for (const i of r.itens) expect(Object.keys(i).sort()).toEqual(['naoLidas', 'nome', 'patientId', 'quando', 'riscoNaoLido', 'tipo']);
    expect(r.itens[0].quando).toBeInstanceOf(Date);
    expect(r.itens[2].quando).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/peito|Oi, Bia|Feriado|Mais uma/);
    expect(r.itens.map((i) => i.patientId)).not.toContain(caio.p);
    expect(davi.p).toBe(r.itens[2].patientId);

    // "Não lidas": só a da Ana; abrir a conversa tira o selo e a conta
    expect((await caixaDeMensagens(T.ctx, { filtro: 'nao-lidas' }, app.db)).itens.map((i) => i.nome)).toEqual(['Ana Souza']);
    expect(await lidas(T)).toBe(antes); // caixa sem auditRead
    await conversaNoPainel(T.ctx, ana.p, {}, app.db);
    expect((await caixaDeMensagens(T.ctx, { filtro: 'nao-lidas' }, app.db)).itens).toEqual([]);
    const depois = await caixaDeMensagens(T.ctx, { filtro: 'todas' }, app.db);
    expect(depois.itens.map((i) => [i.nome, i.riscoNaoLido])).toEqual([
      ['Bia Lima', false],
      ['Ana Souza', false],
      ['Davi Melo', false],
    ]);
  });

  it('tipo da última: mensagem do paciente, imagem e PDF; busca pelo nome sem acento', async () => {
    const T = await consultorio();
    const joao = await pacienteDoChat(app.db, T, { nome: 'João Araújo' });
    await enviarComoPaciente(joao.P, { texto: 'Oi' }, app.db);
    const r = await caixaDeMensagens(T.ctx, { filtro: 'todas', busca: 'joao arau' }, app.db);
    expect(r.itens.map((i) => [i.nome, i.tipo])).toEqual([['João Araújo', 'paciente']]);
    expect((await caixaDeMensagens(T.ctx, { filtro: 'todas', busca: 'maria' }, app.db)).itens).toEqual([]);
    // o anexo vem antes do autor (pela sessão do dono: o envio de anexo é da T8)
    const caminho = `${T.tenantId}/chat_anexo/${crypto.randomUUID()}.pdf`;
    await owner.pool.query(`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values ($1, $2, 'chat_anexo', $3, 10, 'application/pdf')`, [T.tenantId, joao.p, caminho]);
    await owner.pool.query(
      `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, anexo_status, anexo_path, anexo_tipo, anexo_nome, anexo_bytes)
       values ($1, $2, 'nutri', $3, 'x', 'x', 'pronto', $4, 'pdf', 'plano.pdf', 10)`,
      [T.tenantId, joao.p, T.nutriId, caminho],
    );
    expect((await caixaDeMensagens(T.ctx, { filtro: 'todas' }, app.db)).itens[0].tipo).toBe('pdf');
  });

  it('paginação: 50 por página com haMais', async () => {
    const T = await consultorio();
    const ps = await Promise.all(Array.from({ length: 51 }, (_, i) => pacienteDoChat(app.db, T, { nome: `Paciente ${String(i).padStart(2, '0')}` })));
    for (const c of ps) await mensagemDoDono(owner.pool, T, c);
    const p1 = await caixaDeMensagens(T.ctx, { filtro: 'todas' }, app.db);
    expect([p1.itens.length, p1.haMais]).toEqual([50, true]);
    const p2 = await caixaDeMensagens(T.ctx, { filtro: 'todas', pagina: 2 }, app.db);
    expect([p2.itens.length, p2.haMais]).toEqual([1, false]);
    expect(new Set([...p1.itens, ...p2.itens].map((i) => i.patientId)).size).toBe(51);
  });

  it('só a sessão nutri: Error antes da transação', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const { db, transaction } = semTransacao();
    await expect(caixaDeMensagens(c.P, { filtro: 'todas' }, db)).rejects.toThrow('mensagens: só a sessão nutri');
    await expect(contadorDeMensagens(c.P, db)).rejects.toThrow('mensagens: só a sessão nutri');
    await expect(pacientesParaNovaConversa(c.P, {}, db)).rejects.toThrow('mensagens: só a sessão nutri');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('Plano 25 — contadorDeMensagens (RN-459)', () => {
  it('conversas com mensagem do paciente não lida (não mensagens); recado e mensagens da nutricionista não contam; sem auditRead', async () => {
    const T = await consultorio();
    const a = await pacienteDoChat(app.db, T);
    const b = await pacienteDoChat(app.db, T);
    expect(await contadorDeMensagens(T.ctx, app.db)).toBe(0);
    await enviarComoPaciente(a.P, { texto: '1' }, app.db);
    await enviarComoPaciente(a.P, { texto: '2' }, app.db);
    await enviarComoPaciente(b.P, { texto: '3' }, app.db);
    await enviarComoNutri(T.ctx, b.p, { texto: 'resposta' }, app.db);
    await recadoPara(app.db, T, [a.p, b.p]);
    expect(await contadorDeMensagens(T.ctx, app.db)).toBe(2);
    expect(await lidas(T)).toBe(0);
    await conversaNoPainel(T.ctx, a.p, {}, app.db);
    expect(await contadorDeMensagens(T.ctx, app.db)).toBe(1);
  });
});

describe('Plano 25 — pacientesParaNovaConversa (CH-D66)', () => {
  it('titulares ativos não anonimizados, com ou sem conversa, em ordem alfabética do nome de registro; temConta; chaves fechadas; sem auditRead', async () => {
    const T = await consultorio();
    const bia = await pacienteDoChat(app.db, T, { nome: 'Bia Lima' });
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const arquivado = await novoPaciente(app.db, T.ctx, { nome: 'Arquivado Silva' });
    await owner.pool.query("update patients set status = 'arquivado' where id = $1", [arquivado.id]);
    const bloqueado = await novoPaciente(app.db, T.ctx, { nome: 'Bloqueado Silva' });
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = $1", [bloqueado.id]);
    const anonimizado = await novoPaciente(app.db, T.ctx, { nome: 'Anônimo' });
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01', anonimizado_em = now() where id = $1", [anonimizado.id]);
    const r = await pacientesParaNovaConversa(T.ctx, {}, app.db);
    expect(r).toEqual({
      itens: [
        { id: ana.id, nome: 'Ana Souza', temConta: false },
        { id: bia.p, nome: 'Bia Lima', temConta: true },
      ],
      haMais: false,
    });
    expect((await pacientesParaNovaConversa(T.ctx, { busca: 'bia' }, app.db)).itens.map((i) => i.nome)).toEqual(['Bia Lima']);
    expect((await pacientesParaNovaConversa(T.ctx, { busca: '%' }, app.db)).itens).toEqual([]); // % literal
    expect(await lidas(T)).toBe(0);
  });

  it('51 pacientes → 50 e haMais; a página 2 traz o resto', async () => {
    const T = await consultorio();
    for (let i = 0; i < 51; i++) await novoPaciente(app.db, T.ctx, { nome: `Paciente ${String(i).padStart(2, '0')}` });
    const p1 = await pacientesParaNovaConversa(T.ctx, {}, app.db);
    expect([p1.itens.length, p1.haMais, p1.itens[0].nome]).toEqual([50, true, 'Paciente 00']);
    const p2 = await pacientesParaNovaConversa(T.ctx, { pagina: 2 }, app.db);
    expect(p2).toEqual({ itens: [expect.objectContaining({ nome: 'Paciente 50' })], haMais: false });
  });
});
