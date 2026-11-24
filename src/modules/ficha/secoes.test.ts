import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { consultaDireta, em, pedidoDireto, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { envioNoBanco } from '../../../test/exames-enviados';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { DO_PLANO_18, ehDoPlano18 } from '../../../test/ficha';
import { anamneses, anamnesisTemplates, anthropometry, auditLog, consultations, energyCalcs, exams, mealPlans, patients } from '@/db/schema';
import { TenantContextError, withTenant } from '@/db/tenant';
import { STATUS_OCUPA } from '@/modules/agenda/status';
import { agendaDoPeriodo } from '@/modules/agenda/visoes';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { secoesDoInicio, type SecaoNoInicio } from './inicio';
import { secaoExamesEnviados } from './secoes/exames-enviados';
import type { PacienteDaSecao, SecaoDaFicha, TenantDaSecao } from './tipos';

// Plano 18 (D14, RN-277, RN-278): as seções do Início numa transação `nutri`, só contador e rótulos genéricos, sem trilha.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const FUSO = 'America/Sao_Paulo';
const TUDO_LIGADO: TenantDaSecao = { fuso: FUSO, documentosLiberados: true, examesPacienteAtivadoEm: new Date('2026-09-01T12:00:00Z') };
const comoPaciente = (p: { id: string; status: string; anonimizadoEm: Date | null }): PacienteDaSecao => ({ id: p.id, status: p.status, anonimizadoEm: p.anonimizadoEm });
const secao = (r: SecaoNoInicio[], id: string) => r.find((s) => s.id === id);

async function avaliacao(T: TenantDeTeste, patientId: string, data: string, createdAt?: Date): Promise<string> {
  const [a] = await withTenant(
    T.ctx,
    (tx) => tx.insert(anthropometry).values({ tenantId: T.tenantId, patientId, data, pesoKg: 70, alturaCm: 170, ...(createdAt ? { createdAt } : {}) }).returning({ id: anthropometry.id }),
    app.db,
  );
  return a.id;
}

/** Um registro de cada seção do Plano 18 (anamnese "Anamnese gestante", exame "Glicemia"), para o paciente `patientId`. */
async function umDeCada(T: TenantDeTeste, patientId: string) {
  await avaliacao(T, patientId, '2026-10-12');
  const ids = await withTenant(
    T.ctx,
    async (tx) => {
      const [plano] = await tx
        .insert(mealPlans)
        .values({ tenantId: T.tenantId, patientId, titulo: 'Plano de emagrecimento', status: 'publicado', publicadoEm: new Date('2026-11-10T15:00:00Z') })
        .returning({ id: mealPlans.id });
      const [calc] = await tx
        .insert(energyCalcs)
        .values({ tenantId: T.tenantId, patientId, formula: 'mifflin', pesoKg: 70, alturaCm: 170, idade: 35, sexo: 'F', fatorAtividade: 1.2, tmb: 1400, get: 1680, createdAt: new Date('2026-10-02T01:00:00Z') })
        .returning({ id: energyCalcs.id });
      const [modelo] = await tx
        .insert(anamnesisTemplates)
        .values({ tenantId: T.tenantId, nome: 'Anamnese gestante', schema: { perguntas: [] } })
        .returning({ id: anamnesisTemplates.id });
      const [anamnese] = await tx
        .insert(anamneses)
        .values({ tenantId: T.tenantId, patientId, templateId: modelo.id, templateSnapshot: { nome: 'Anamnese gestante', perguntas: [] }, data: '2026-10-05' })
        .returning({ id: anamneses.id });
      const [atendimento] = await tx
        .insert(consultations)
        .values({ tenantId: T.tenantId, patientId, data: '2026-10-06', orientacoesPaciente: 'Beber água' })
        .returning({ id: consultations.id });
      const [exame] = await tx.insert(exams).values({ tenantId: T.tenantId, patientId, data: '2026-10-07', titulo: 'Glicemia' }).returning({ id: exams.id });
      return { plano: plano.id, calc: calc.id, anamnese: anamnese.id, atendimento: atendimento.id, exame: exame.id };
    },
    app.db,
  );
  const envio = await envioNoBanco(app.db, T.ctx, patientId, { status: 'recebido', nome: 'Glicemia de jejum' });
  const documento = await documentoNoBanco(app.db, T.ctx, patientId, { status: 'assinado', tipo: 'parecer' });
  return { ...ids, envio, documento: documento.id };
}

const linhasDeAuditoria = async (T: TenantDeTeste) =>
  (await withTenant(T.ctx, (tx) => tx.select({ n: count() }).from(auditLog).where(eq(auditLog.tenantId, T.tenantId)), app.db))[0].n;

describe('secoesDoInicio (RN-277, RN-278)', () => {
  it('chaves exatas: cada seção só id, titulo, aba, verTodos, resumo, podeAdicionar; cada item só id, rotulo, data, situacao?, noApp, href', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ids = await umDeCada(T, p.id);
    // só as 8 do Plano 18: as seções de outros planos (o Financeiro do Plano 20) vêm depois e têm os próprios testes
    const r = (await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db })).filter((s) => ehDoPlano18(s.id));
    expect(r.map((s) => s.id)).toEqual([...DO_PLANO_18]);
    for (const s of r) {
      expect(Object.keys(s).sort(), s.id).toEqual(['aba', 'id', 'podeAdicionar', 'resumo', 'titulo', 'verTodos']);
      expect(Object.keys(s.resumo).sort(), s.id).toEqual(['total', 'ultimos']);
      expect(s.resumo.total, s.id).toBe(1);
      for (const item of s.resumo.ultimos) {
        const chaves = Object.keys(item).sort();
        expect(chaves.filter((k) => k !== 'situacao'), s.id).toEqual(['data', 'href', 'id', 'noApp', 'rotulo']);
        expect(item.noApp).toBe(false);
        expect(item.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    const base = `/painel/pacientes/${p.id}`;
    const item = (id: string) => secao(r, id)!.resumo.ultimos[0];
    expect(item('plano-alimentar')).toEqual({ id: ids.plano, rotulo: 'Plano alimentar', data: '2026-11-10', situacao: 'Publicado', noApp: false, href: `plano-alimentar/${ids.plano}` });
    expect(item('antropometria')).toMatchObject({ rotulo: 'Avaliação', data: '2026-10-12', href: 'antropometria' });
    // created_at 02/10 01:00 UTC = 01/10 no fuso de São Paulo (RN-06)
    expect(item('gasto-energetico')).toEqual({ id: ids.calc, rotulo: 'Cálculo', data: '2026-10-01', noApp: false, href: 'gasto-energetico' });
    expect(item('anamneses')).toEqual({ id: ids.anamnese, rotulo: 'Anamnese', data: '2026-10-05', noApp: false, href: `anamnese/${ids.anamnese}` });
    expect(item('atendimentos')).toEqual({ id: ids.atendimento, rotulo: 'Atendimento', data: '2026-10-06', noApp: false, href: `atendimentos/${ids.atendimento}` });
    expect(item('exames')).toEqual({ id: ids.exame, rotulo: 'Exame', data: '2026-10-07', noApp: false, href: 'exames' });
    expect(item('exames-enviados')).toMatchObject({ id: ids.envio, rotulo: 'Envio do paciente', situacao: 'Aguardando revisão', href: `/painel/exames-recebidos/${ids.envio}` });
    expect(item('documentos')).toMatchObject({ id: ids.documento, rotulo: 'Parecer nutricional', situacao: 'Assinado', href: `documentos/${ids.documento}` });
    // "Ver todos": a aba (a de envios é a aba Exames); podeAdicionar padrão true
    expect(secao(r, 'exames-enviados')).toMatchObject({ aba: 'exames', verTodos: `${base}/exames` });
    expect(secao(r, 'anamneses')).toMatchObject({ aba: 'anamnese', verTodos: `${base}/anamnese` });
    expect(r.every((s) => s.podeAdicionar)).toBe(true);
  });

  it('contador e 3 últimos: 5 avaliações → total 5, 3 itens do mais recente ao mais antigo; empate de data desempata por created_at', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await avaliacao(T, p.id, '2026-06-01');
    await avaliacao(T, p.id, '2026-07-01');
    const antiga = await avaliacao(T, p.id, '2026-08-01', new Date('2026-08-01T10:00:00Z'));
    const nova = await avaliacao(T, p.id, '2026-08-01', new Date('2026-08-01T18:00:00Z'));
    const ultima = await avaliacao(T, p.id, '2026-09-01');
    const r = await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db });
    const s = secao(r, 'antropometria')!;
    expect(s.resumo.total).toBe(5);
    expect(s.resumo.ultimos.map((i) => i.id)).toEqual([ultima, nova, antiga]);
    expect(s.resumo.ultimos.map((i) => i.data)).toEqual(['2026-09-01', '2026-08-01', '2026-08-01']);
    expect(secao(r, 'anamneses')!.resumo).toEqual({ total: 0, ultimos: [] });
  });

  it('antropometria: empate de data e de created_at desempata por id desc, como o cabeçalho', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const quando = new Date('2026-10-12T12:00:00Z');
    const ids = [await avaliacao(T, p.id, '2026-10-12', quando), await avaliacao(T, p.id, '2026-10-12', quando), await avaliacao(T, p.id, '2026-10-12', quando)];
    const s = secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }), 'antropometria')!;
    expect(s.resumo.ultimos.map((i) => i.id)).toEqual([...ids].sort().reverse());
  });

  it('sem conteúdo clínico: nem o nome do modelo da anamnese, nem o do exame, nem o título do plano, nem orientações', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await umDeCada(T, p.id);
    const json = JSON.stringify(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }));
    for (const texto of ['gestante', 'Glicemia', 'emagrecimento', 'Beber água']) expect(json).not.toContain(texto);
  });

  it('sem trilha: o Início com as 8 seções não grava audit_log', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await umDeCada(T, p.id);
    const antes = await linhasDeAuditoria(T);
    await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db });
    expect(await linhasDeAuditoria(T)).toBe(antes);
  });

  it('leitura: seção com leitura grava exatamente um "ler" da entidade só quando devolve itens', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    let itens: { id: string; rotulo: string; data: string; href: string }[] = [];
    const teste: SecaoDaFicha = {
      id: 'teste',
      titulo: 'Teste',
      aba: '',
      verTodos: (id) => `/painel/financeiro/lancamentos?paciente=${id}`,
      disponivel: () => true,
      resumo: async () => ({ total: itens.length, ultimos: itens, podeAdicionar: false }),
      leitura: { entidade: 'teste' },
      adicionar: [{ grupo: 'outros', rotulo: 'Nova entrada', destino: { href: '/painel/financeiro/novo' } }],
    };
    const lidas = async () =>
      withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidade, 'teste')), app.db);

    const vazio = await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db, secoes: [teste] });
    expect(vazio).toEqual([{ id: 'teste', titulo: 'Teste', aba: '', verTodos: `/painel/financeiro/lancamentos?paciente=${p.id}`, resumo: { total: 0, ultimos: [] }, podeAdicionar: false }]);
    expect(await lidas()).toEqual([]);

    itens = [
      { id: randomUUID(), rotulo: 'Lançamento', data: '2026-11-01', href: '/painel/financeiro/lancamentos/1' },
      { id: randomUUID(), rotulo: 'Lançamento', data: '2026-10-01', href: '/painel/financeiro/lancamentos/2' },
    ];
    const cheio = await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db, secoes: [teste] });
    expect(cheio[0].resumo.ultimos.every((i) => i.noApp === false)).toBe(true);
    const log = await lidas();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ acao: 'ler', entidade: 'teste', entidadeId: null, patientId: p.id, actorUserId: T.nutriId });
  });

  it('leitura: seção com leitura mas indisponível não grava nem consulta', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    let consultou = false;
    const teste: SecaoDaFicha = {
      id: 'teste-off',
      titulo: 'Teste',
      aba: '',
      disponivel: () => false,
      resumo: async () => {
        consultou = true;
        return { total: 1, ultimos: [{ id: randomUUID(), rotulo: 'X', data: '2026-11-01', href: 'x' }] };
      },
      leitura: { entidade: 'teste-off' },
    };
    expect(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db, secoes: [teste] })).toEqual([]);
    expect(consultou).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidade, 'teste-off')), app.db)).toEqual([]);
  });

  it('documentos desligados: a seção Documentos some', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const r = await secoesDoInicio(T.ctx, { ...TUDO_LIGADO, documentosLiberados: false }, comoPaciente(p), { db: app.db });
    expect(secao(r, 'documentos')).toBeUndefined();
    expect(secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }), 'documentos')!.resumo.total).toBe(1);
  });

  it('envios (RN-192): sem o recebimento ligado, só com algum envio não cancelado', async () => {
    const T = await novoTenant(app.db);
    const desligado: TenantDaSecao = { ...TUDO_LIGADO, examesPacienteAtivadoEm: null };
    const p = await novoPaciente(app.db, T.ctx);
    expect(secao(await secoesDoInicio(T.ctx, desligado, comoPaciente(p), { db: app.db }), 'exames-enviados')).toBeUndefined();
    expect(secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }), 'exames-enviados')!.resumo.total).toBe(0);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    expect(secao(await secoesDoInicio(T.ctx, desligado, comoPaciente(p), { db: app.db }), 'exames-enviados')).toBeUndefined();
    const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito' });
    const s = secao(await secoesDoInicio(T.ctx, desligado, comoPaciente(p), { db: app.db }), 'exames-enviados')!;
    expect(s.resumo).toEqual({ total: 1, ultimos: [expect.objectContaining({ id: aceito, situacao: 'Aceito', href: `/painel/exames-recebidos/${aceito}` })] });
  });

  it('envios: processando, expirado e falhou levam à aba Exames (a revisão diria "Este envio já foi revisado."); recebido, aceito e recusado, à revisão', async () => {
    const T = await novoTenant(app.db);
    const destinos: Array<[string, string]> = [];
    for (const status of ['processando', 'expirado', 'falhou', 'recebido', 'aceito', 'recusado'] as const) {
      const p = await novoPaciente(app.db, T.ctx); // um envio por paciente: o resumo traz só os 3 últimos
      const motivo = status === 'falhou' ? { motivoFalha: 'conversao' } : status === 'recusado' ? { motivoRecusa: 'ilegivel' } : {}; // CHECKs do envio
      const id = await envioNoBanco(app.db, T.ctx, p.id, { status, ...motivo });
      const [item] = secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }), 'exames-enviados')!.resumo.ultimos;
      expect(item.id).toBe(id);
      destinos.push([status, item.href.replace(id, '{id}')]);
    }
    expect(destinos).toEqual([
      ['processando', 'exames'],
      ['expirado', 'exames'],
      ['falhou', 'exames'],
      ['recebido', '/painel/exames-recebidos/{id}'],
      ['aceito', '/painel/exames-recebidos/{id}'],
      ['recusado', '/painel/exames-recebidos/{id}'],
    ]);
  });

  it('envios: titular bloqueado ou anonimizado — a seção some (nunca "(0) Nenhum registro ainda." com envios guardados), como na fila', async () => {
    const T = await novoTenant(app.db);
    const desligado: TenantDaSecao = { ...TUDO_LIGADO, examesPacienteAtivadoEm: null };
    const p = await novoPaciente(app.db, T.ctx);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    const bloqueado = comoPaciente({ ...p, status: 'bloqueado' });
    expect(secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, bloqueado, { db: app.db }), 'exames-enviados')).toBeUndefined();
    expect(secao(await secoesDoInicio(T.ctx, desligado, bloqueado, { db: app.db }), 'exames-enviados')).toBeUndefined();
    // as outras seções continuam (só para consulta)
    expect(secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, bloqueado, { db: app.db }), 'exames')).toBeDefined();
    // anonimizado (arquivado): a seção também some
    const anonimizado = comoPaciente({ ...p, status: 'arquivado', anonimizadoEm: new Date('2026-10-01T12:00:00Z') });
    expect(secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, anonimizado, { db: app.db }), 'exames-enviados')).toBeUndefined();
    // monotonia no total (JSDoc de disponivel): para o titular bloqueado é false com qualquer total
    for (const total of [0, 1, Number.POSITIVE_INFINITY]) expect(secaoExamesEnviados.disponivel(TUDO_LIGADO, bloqueado, total)).toBe(false);
  });

  it('plano: rascunho, publicado e arquivado com a situação, a versão mais nova primeiro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.insert(mealPlans).values([
          { tenantId: T.tenantId, patientId: p.id, titulo: 'A', versao: 1, status: 'arquivado', publicadoEm: new Date('2026-09-02T15:00:00Z') },
          { tenantId: T.tenantId, patientId: p.id, titulo: 'B', versao: 2, status: 'publicado', publicadoEm: new Date('2026-11-10T15:00:00Z') },
          { tenantId: T.tenantId, patientId: p.id, titulo: 'C', versao: 3, status: 'rascunho' },
        ]),
      app.db,
    );
    const s = secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }), 'plano-alimentar')!;
    expect(s.resumo.total).toBe(3);
    expect(s.resumo.ultimos.map((i) => i.situacao)).toEqual(['Rascunho', 'Publicado', 'Arquivado']);
    expect(s.resumo.ultimos.slice(1).map((i) => i.data)).toEqual(['2026-11-10', '2026-09-02']);
  });

  it('outro tenant não vê: paciente de B pelo ctx de A → totais 0', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await umDeCada(B, pb.id);
    const r = (await secoesDoInicio(A.ctx, TUDO_LIGADO, comoPaciente(pb), { db: app.db })).filter((s) => ehDoPlano18(s.id));
    expect(r.map((s) => s.id)).toEqual([...DO_PLANO_18]);
    for (const s of r) expect(s.resumo, s.id).toEqual({ total: 0, ultimos: [] });
  });

  it('papel: só a sessão da nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const SO_DA_NUTRI = 'o Início da ficha é só da sessão da nutricionista';
    await expect(secoesDoInicio(ctxPaciente(T.tenantId, p.id), TUDO_LIGADO, comoPaciente(p), { db: app.db })).rejects.toThrow(TenantContextError);
    await expect(secoesDoInicio(ctxPaciente(T.tenantId, p.id), TUDO_LIGADO, comoPaciente(p), { db: app.db })).rejects.toThrow(SO_DA_NUTRI);
    await expect(secoesDoInicio({ tenantId: T.tenantId, role: 'worker' }, TUDO_LIGADO, comoPaciente(p), { db: app.db })).rejects.toThrow(TenantContextError);
    await expect(secoesDoInicio({ tenantId: T.tenantId, role: 'worker' }, TUDO_LIGADO, comoPaciente(p), { db: app.db })).rejects.toThrow(SO_DA_NUTRI);
  });
});

describe('Plano 23 (US-411, §4.4): a seção "Consultas" do Início', () => {
  // a seção lê o relógio do banco: as datas saem de "hoje" no fuso
  const hoje = hojeNoFuso(FUSO);
  const dia = (n: number) => somarDias(hoje, n);
  const consultasDe = async (T: TenantDeTeste, p: { id: string; status: string; anonimizadoEm: Date | null }) =>
    secao(await secoesDoInicio(T.ctx, TUDO_LIGADO, comoPaciente(p), { db: app.db }), 'consultas')!;

  it('até 3 próximas em ordem crescente, com "Primeira consulta" ou "Retorno" e a situação; o total bate com as futuras da Lista filtrada pelo paciente (RN-411); sem trilha', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const agendada = await consultaDireta(app.db, T.ctx, p.id, em(dia(3), '10:00'), 60);
    const confirmada = await consultaDireta(app.db, T.ctx, p.id, em(dia(5), '10:00'), 60, { status: 'confirmada', confirmadaVia: 'link' });
    const pedido = await pedidoDireto(app.db, T, p.id, em(dia(2), '10:00'));
    await consultaDireta(app.db, T.ctx, p.id, em(dia(20), '10:00'), 60);
    await consultaDireta(app.db, T.ctx, p.id, em(dia(1), '10:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: new Date() });
    await consultaDireta(app.db, T.ctx, p.id, em(dia(-3), '10:00'), 60); // passou sem presença: não é futura
    await consultaDireta(app.db, T.ctx, p.id, em(dia(400), '10:00'), 60); // fora da Lista do paciente (12 meses)
    const antes = await linhasDeAuditoria(T);
    const s = await consultasDe(T, p);
    expect(await linhasDeAuditoria(T)).toBe(antes);
    expect(s).toMatchObject({ titulo: 'Consultas', aba: '', verTodos: `/painel/agenda?visao=lista&paciente=${p.id}`, podeAdicionar: true });
    expect(s.resumo.total).toBe(4);
    expect(s.resumo.ultimos).toEqual([
      { id: pedido, rotulo: 'Primeira consulta', data: dia(2), situacao: 'Pedido a responder', noApp: false, href: `/painel/agenda/consultas/${pedido}` },
      { id: agendada, rotulo: 'Primeira consulta', data: dia(3), situacao: 'Agendada', noApp: false, href: `/painel/agenda/consultas/${agendada}` },
      { id: confirmada, rotulo: 'Primeira consulta', data: dia(5), situacao: 'Confirmada', noApp: false, href: `/painel/agenda/consultas/${confirmada}` },
    ]);
    // RN-411: a Lista filtrada pelo paciente (o "Ver todos") tem as mesmas futuras que a seção conta
    const agora = new Date();
    const lista = await agendaDoPeriodo(T.ctx, tenantAgenda(T), { visao: 'lista', data: hoje, paciente: p.id, horas24: false, retorno: false, aniversario: false }, { db: app.db, agora });
    const futuras = lista.itens.filter((i) => (STATUS_OCUPA as readonly string[]).includes(i.status) && i.fim.getTime() > agora.getTime());
    expect(futuras.length).toBe(s.resumo.total);
  });

  it('sem consulta futura e com previsão, abre com o item "Retorno previsto" (a do atendimento mais novo, AG-D76); com consulta futura, a previsão some e a consulta é "Retorno"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const [velho, ultimo] = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .insert(consultations)
          .values([
            { tenantId: T.tenantId, patientId: p.id, data: dia(-60), retornoPrevistoEm: dia(-10) },
            { tenantId: T.tenantId, patientId: p.id, data: dia(-30), retornoPrevistoEm: dia(10) },
          ])
          .returning({ id: consultations.id }),
      app.db,
    );
    expect(velho).toBeDefined();
    const s = await consultasDe(T, p);
    expect(s.resumo).toEqual({ total: 1, ultimos: [{ id: ultimo.id, rotulo: 'Retorno previsto', data: dia(10), noApp: false, href: `/painel/agenda/nova?paciente=${p.id}` }] });
    const futura = await consultaDireta(app.db, T.ctx, p.id, em(dia(15), '09:00'), 60);
    expect((await consultasDe(T, p)).resumo).toEqual({
      total: 1,
      ultimos: [{ id: futura, rotulo: 'Retorno', data: dia(15), situacao: 'Agendada', noApp: false, href: `/painel/agenda/consultas/${futura}` }],
    });
  });

  it('AG-D76: previsão para 10/12 e um atendimento mais novo (05/12) sem previsão → sem o item "Retorno previsto"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-11-01', retornoPrevistoEm: '2026-12-10' }), app.db);
    expect((await consultasDe(T, p)).resumo.ultimos.map((i) => [i.rotulo, i.data])).toEqual([['Retorno previsto', '2026-12-10']]);
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-12-05' }), app.db);
    expect((await consultasDe(T, p)).resumo).toEqual({ total: 0, ultimos: [] });
  });

  it('consulta futura depois do corte da Lista (13 meses): não entra no total, mas tira o item "Retorno previsto" (como o marcador da agenda)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, data: dia(-30), retornoPrevistoEm: dia(10) }), app.db);
    expect((await consultasDe(T, p)).resumo.total).toBe(1);
    await consultaDireta(app.db, T.ctx, p.id, em(dia(395), '10:00'), 60);
    expect((await consultasDe(T, p)).resumo).toEqual({ total: 0, ultimos: [] });
  });

  it('nada: total 0 e sem itens; outro consultório não vê', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect((await consultasDe(T, p)).resumo).toEqual({ total: 0, ultimos: [] });
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await consultaDireta(app.db, B.ctx, pb.id, em(dia(3), '10:00'), 60);
    expect((await consultasDe(T, pb)).resumo).toEqual({ total: 0, ultimos: [] });
  });
});
