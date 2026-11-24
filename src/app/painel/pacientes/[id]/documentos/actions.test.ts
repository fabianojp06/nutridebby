import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { criarReceita, criarSolicitacao, lerDocumento } from '@/modules/documentos/documentos';
import { listarItensSalvos, listarModelosPrescricao, MSG_MODELOS, salvarModeloPrescricao } from '@/modules/documentos/modelos';
import { DECLARACAO_SOLICITACAO } from '@/modules/documentos/solicitacao';
import { criarExame } from '@/modules/pacientes/exames';
import { documentoNoBanco } from '../../../../../../test/documentos';
import { nutriComDpa } from '../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../test/pacientes';

// As ações pelo caminho real (requireNutri → Postgres via Testcontainers), como plano-alimentar/actions.test.ts; só o
// que depende do runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
const req = vi.hoisted(() => ({ headers: new Headers() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { apagarRascunhoAction, cancelarAction, carregarModeloAction, criarParecerAction, criarSolicitacaoAction, entreguePessoalmenteAction, pedirNovoPdfAction, prepararAction, prepararParecerAction, prepararSolicitacaoAction, reenviarLinkAction, retificarAction, salvarComoModeloAction, salvarItemAction, salvarParecerAction, salvarRascunhoAction, salvarSolicitacaoAction, voltarAEditarAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());
const MUDOU = { erros: { geral: 'Este documento mudou de situação. Recarregue a página.' } };

async function consultorio() {
  const N = await nutriComDpa(db, auth);
  // perfil completo: o preparo copia o carimbo (US-143)
  await db
    .update(tenants)
    .set({ documentosLiberados: true, crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678' })
    .where(eq(tenants.id, N.tenantId));
  req.headers = new Headers({ cookie: N.cookie });
  const p = await novoPaciente(db, N.ctx);
  return { N, p };
}

describe('ações do documento: o erro volta ao formulário; o sinal de sucesso só quando deu certo', () => {
  it('"Apagar rascunho" de um documento que outra aba já preparou: o motivo, sem "Rascunho apagado." nem revalidar', async () => {
    const { N, p } = await consultorio();
    const preparando = await documentoNoBanco(db, N.ctx, p.id, { status: 'preparando' });
    expect(await apagarRascunhoAction(p.id, preparando.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    await expect(apagarRascunhoAction(p.id, rascunho.id, {})).rejects.toThrow(`redirect /painel/pacientes/${p.id}/documentos?apagado=1`);
  });

  it('"Gerar o PDF de novo" e "Voltar a editar" fora do estado: o motivo, sem revalidar; no estado certo, ok', async () => {
    const { N, p } = await consultorio();
    const preparando = await documentoNoBanco(db, N.ctx, p.id, { status: 'preparando' }); // pdf_status nulo: nada a pedir de novo
    expect(await pedirNovoPdfAction(p.id, preparando.id, {})).toEqual(MUDOU);
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    expect(await voltarAEditarAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await voltarAEditarAction(p.id, preparando.id, {})).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
  });

  it('"Reenviar link" e "Entregue pessoalmente" fora do estado: o motivo, sem "Link reenviado." nem revalidar; no estado certo, o sinal', async () => {
    const { N, p } = await consultorio(); // paciente ativo, sem conta, com e-mail
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    expect(await reenviarLinkAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(await entreguePessoalmenteAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    const assinado = await documentoNoBanco(db, N.ctx, p.id, { status: 'assinado' });
    await expect(reenviarLinkAction(p.id, assinado.id, {})).rejects.toThrow(`redirect /painel/pacientes/${p.id}/documentos/${assinado.id}?link=1`);
    expect(await entreguePessoalmenteAction(p.id, assinado.id, {})).toEqual({ ok: true });
  });

  it('"Cancelar documento" (US-149): sem motivo e fora de "assinado", o erro volta sem revalidar; com motivo, cancelado e revalida', async () => {
    const { N, p } = await consultorio();
    const motivo = (m: string) => {
      const f = new FormData();
      f.set('motivo', m);
      return f;
    };
    const assinado = await documentoNoBanco(db, N.ctx, p.id, { status: 'assinado' });
    expect(await cancelarAction(p.id, assinado.id, {}, motivo('   '))).toEqual({ erros: { motivo: 'Escreva o motivo do cancelamento (até 500 caracteres).' } });
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    expect(await cancelarAction(p.id, rascunho.id, {}, motivo('Dose errada'))).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await cancelarAction(p.id, assinado.id, {}, motivo('Dose errada'))).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
    expect(await lerDocumento(N.ctx, p.id, assinado.id, db)).toMatchObject({ status: 'cancelado', motivoCancelamento: 'Dose errada', canceladoEm: expect.any(Date) });
  });
});

// Revisão da T6: o editor e o preparo são um só formulário; "Preparar para assinatura" envia o que está na tela.
const vitD = (quantidade: string, posologia = '1 cápsula ao dia, no almoço') => ({
  tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade, unidade: 'mg' }], forma: 'Cápsula', via: 'oral', posologia,
});
function formulario(campos: { itens: unknown[]; justificativa: string; declaracao?: boolean }): FormData {
  const f = new FormData();
  f.set('conteudo', JSON.stringify({ itens: campos.itens, orientacoes: '' }));
  f.set('justificativa', campos.justificativa);
  if (campos.declaracao) f.set('declaracao', 'on');
  return f;
}

describe('"Preparar para assinatura" prepara o que está na tela (revisão da T6)', () => {
  it('a dose trocada e a justificativa digitadas, sem "Salvar rascunho", vão para o preparo', async () => {
    const { N, p } = await consultorio();
    const id = await criarReceita(N.ctx, p.id, { db });
    expect(await salvarRascunhoAction(p.id, id, {}, formulario({ itens: [vitD('500')], justificativa: '' }))).toEqual({ ok: true });
    // na tela: 50 mg e a justificativa, sem salvar
    expect(await prepararAction(p.id, id, {}, formulario({ itens: [vitD('50')], justificativa: 'Exposição solar baixa', declaracao: true }))).toEqual({ ok: true });
    const d = await lerDocumento(N.ctx, p.id, id, db);
    expect(d).toMatchObject({ status: 'preparando', justificativa: 'Exposição solar baixa', conteudo: { itens: [{ composicao: [{ nome: 'Vitamina D3', quantidade: 50 }] }] } });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
  });

  it('campo inválido na tela: o erro volta ao campo do editor e o documento continua rascunho, com o que estava salvo', async () => {
    const { N, p } = await consultorio();
    const id = await criarReceita(N.ctx, p.id, { db });
    expect(await salvarRascunhoAction(p.id, id, {}, formulario({ itens: [vitD('500')], justificativa: 'Exposição solar baixa' }))).toEqual({ ok: true });
    revalidatePath.mockClear();
    const r = await prepararAction(p.id, id, {}, formulario({ itens: [vitD('50', '')], justificativa: 'Exposição solar baixa', declaracao: true }));
    expect(r.erros?.['itens.0.posologia']).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
    const d = await lerDocumento(N.ctx, p.id, id, db);
    expect(d).toMatchObject({ status: 'rascunho', conteudo: { itens: [{ composicao: [{ quantidade: 500 }] }] } });
  });

  it('sem a declaração: "Confirme a declaração para continuar." e o documento continua rascunho', async () => {
    const { N, p } = await consultorio();
    const id = await criarReceita(N.ctx, p.id, { db });
    expect(await prepararAction(p.id, id, {}, formulario({ itens: [vitD('50')], justificativa: 'Exposição solar baixa' }))).toEqual({ erros: { declaracao: 'Confirme a declaração para continuar.' } });
    expect((await lerDocumento(N.ctx, p.id, id, db))?.status).toBe('rascunho');
  });
});

describe('parecer nutricional pelas ações (US-141)', () => {
  const editor = (o: { exameIds: string[]; avaliacao: string; declaracao?: boolean }) => {
    const f = new FormData();
    f.set('conteudo', JSON.stringify({ exameIds: o.exameIds, avaliacao: o.avaliacao }));
    if (o.declaracao) f.set('declaracao', 'on');
    return f;
  };
  const exame = (ctx: Parameters<typeof criarExame>[0], patientId: string) =>
    criarExame(ctx, { fuso: 'America/Sao_Paulo' }, patientId, { titulo: 'Hemograma', data: '2026-09-01', valores: [{ nome: 'Hemoglobina', valor: '13,5', unidade: 'g/dL', referencia: '12 a 16' }], arquivo: null }, { db, now: new Date('2026-10-01T15:00:00Z') });

  it('"Novo parecer nutricional" abre o rascunho; o erro de exame alheio e o do preparo voltam ao campo; com exame e avaliação, prepara', async () => {
    const { N, p } = await consultorio();
    const destino = await criarParecerAction(p.id).catch((e: Error) => e.message);
    expect(destino).toMatch(new RegExp(`^redirect /painel/pacientes/${p.id}/documentos/[0-9a-f-]{36}$`));
    const id = String(destino).split('/').at(-1)!;
    const outro = await novoPaciente(db, N.ctx);
    expect(await salvarParecerAction(p.id, id, {}, editor({ exameIds: [await exame(N.ctx, outro.id)], avaliacao: 'x' }))).toEqual({ erros: { exames: 'Um dos exames selecionados foi excluído. Revise a seleção.' } });
    expect(await prepararParecerAction(p.id, id, {}, editor({ exameIds: [], avaliacao: 'x', declaracao: true }))).toEqual({ erros: { exames: 'Selecione ao menos um exame.' } });
    revalidatePath.mockClear();
    expect(await prepararParecerAction(p.id, id, {}, editor({ exameIds: [await exame(N.ctx, p.id)], avaliacao: 'Baixa reserva de ferro.', declaracao: true }))).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
    expect((await lerDocumento(N.ctx, p.id, id, db))?.status).toBe('preparando');
  });

  it('paciente bloqueado: "Novo parecer nutricional" volta para a lista com ?bloqueado=1', async () => {
    const { N } = await consultorio();
    const b = await novoPaciente(db, N.ctx, { status: 'bloqueado' });
    await expect(criarParecerAction(b.id)).rejects.toThrow(`redirect /painel/pacientes/${b.id}/documentos?bloqueado=1`);
  });
});

describe('retificar pelas ações (US-148, US-149)', () => {
  it('"Retificar" abre a versão nova (ou a que já existe); "Cancelar documento" com ela em andamento devolve o texto da US-149; preparar sem motivo, o erro do campo', async () => {
    const { N, p } = await consultorio();
    const v1 = await documentoNoBanco(db, N.ctx, p.id, { status: 'assinado' });
    const destino = await retificarAction(p.id, v1.id, {}).catch((e: Error) => e.message);
    expect(destino).toMatch(new RegExp(`^redirect /painel/pacientes/${p.id}/documentos/[0-9a-f-]{36}$`));
    await expect(retificarAction(p.id, v1.id, {})).rejects.toThrow(String(destino)); // uma por vez: a mesma
    const motivo = new FormData();
    motivo.set('motivo', 'Dose errada');
    expect(await cancelarAction(p.id, v1.id, {}, motivo)).toEqual({ erros: { geral: 'Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar.' } });
    const v2 = String(destino).split('/').at(-1)!;
    const f = formulario({ itens: [vitD('50')], justificativa: 'Exposição solar baixa', declaracao: true });
    expect(await prepararAction(p.id, v2, {}, f)).toEqual({ erros: { motivoRetificacao: 'Escreva o motivo da retificação (até 500 caracteres).' } });
    f.set('motivoRetificacao', 'Dose corrigida');
    expect(await prepararAction(p.id, v2, {}, f)).toEqual({ ok: true });
    expect(await lerDocumento(N.ctx, p.id, v2, db)).toMatchObject({ status: 'preparando', versao: 2, motivoRetificacao: 'Dose corrigida' });
  });

  it('"Retificar" de um documento que não é a versão em vigor: o motivo, sem redirecionar', async () => {
    const { N, p } = await consultorio();
    const cancelado = await documentoNoBanco(db, N.ctx, p.id, { status: 'cancelado' });
    expect(await retificarAction(p.id, cancelado.id, {})).toEqual(MUDOU);
  });
});

// Plano 22 (T8, US-377, RN-389, RN-398): as ações da solicitação no molde das da receita e do parecer
describe('solicitação de exames pelas ações (US-377)', () => {
  const editor = (o: { exames: unknown[]; indicacaoClinica?: string; orientacoes?: string; declaracao?: boolean }) => {
    const f = new FormData();
    f.set('conteudo', JSON.stringify({ exames: o.exames, indicacaoClinica: o.indicacaoClinica ?? '', orientacoes: o.orientacoes ?? '' }));
    if (o.declaracao) f.set('declaracao', 'on');
    return f;
  };
  const EXAMES = [{ nome: 'Hemograma completo', painel: true }, { nome: 'Glicemia de jejum' }];

  it('"Nova solicitação de exames" abre o rascunho; salvar e preparar o que está na tela; o erro volta ao campo', async () => {
    const { N, p } = await consultorio();
    const destino = await criarSolicitacaoAction(p.id).catch((e: Error) => e.message);
    expect(destino).toMatch(new RegExp(`^redirect /painel/pacientes/${p.id}/documentos/[0-9a-f-]{36}$`));
    const id = String(destino).split('/').at(-1)!;
    expect((await lerDocumento(N.ctx, p.id, id, db))?.tipo).toBe('solicitacao_exames');
    expect(await salvarSolicitacaoAction(p.id, id, {}, editor({ exames: [{ nome: 'Glicose' }, { nome: 'glicose' }] }))).toEqual({ erros: { 'exames.1.nome': 'Este exame já está na lista.' } });
    expect(await salvarSolicitacaoAction(p.id, id, {}, editor({ exames: EXAMES, indicacaoClinica: 'Acompanhar a dieta.' }))).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
    expect(await prepararSolicitacaoAction(p.id, id, {}, editor({ exames: [], declaracao: true }))).toEqual({ erros: { exames: 'Inclua ao menos um exame.' } });
    expect(await prepararSolicitacaoAction(p.id, id, {}, editor({ exames: EXAMES }))).toEqual({ erros: { declaracao: 'Confirme a declaração para continuar.' } });
    // na tela: um exame a mais, sem "Salvar rascunho"
    expect(await prepararSolicitacaoAction(p.id, id, {}, editor({ exames: [...EXAMES, { nome: 'Ferritina' }], declaracao: true }))).toEqual({ ok: true });
    expect(await lerDocumento(N.ctx, p.id, id, db)).toMatchObject({ status: 'preparando', conteudo: { exames: [...EXAMES, { nome: 'Ferritina' }], declaracao: DECLARACAO_SOLICITACAO } });
  });

  it('o editor da solicitação não grava numa receita (e vice-versa): o motivo, sem revalidar', async () => {
    const { N, p } = await consultorio();
    const receita = await criarReceita(N.ctx, p.id, { db });
    const sol = await criarSolicitacao(N.ctx, p.id, { db });
    revalidatePath.mockClear();
    expect(await salvarSolicitacaoAction(p.id, receita, {}, editor({ exames: EXAMES }))).toEqual(MUDOU);
    expect(await salvarRascunhoAction(p.id, sol, {}, formulario({ itens: [], justificativa: '' }))).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('sem documentos_liberados (RN-398): criar, salvar e preparar respondem 404, como a receita', async () => {
    const { N, p } = await consultorio();
    const id = await criarSolicitacao(N.ctx, p.id, { db });
    await db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, N.tenantId));
    await expect(criarSolicitacaoAction(p.id)).rejects.toThrow('notFound');
    await expect(salvarSolicitacaoAction(p.id, id, {}, editor({ exames: EXAMES }))).rejects.toThrow('notFound');
    await expect(prepararSolicitacaoAction(p.id, id, {}, editor({ exames: EXAMES, declaracao: true }))).rejects.toThrow('notFound');
    expect((await lerDocumento(N.ctx, p.id, id, db))?.conteudo).toMatchObject({ exames: [] });
  });

  it('paciente bloqueado: "Nova solicitação de exames" volta para a lista com ?bloqueado=1', async () => {
    const { N } = await consultorio();
    const b = await novoPaciente(db, N.ctx, { status: 'bloqueado' });
    await expect(criarSolicitacaoAction(b.id)).rejects.toThrow(`redirect /painel/pacientes/${b.id}/documentos?bloqueado=1`);
  });
});

// Plano 22 (T10b, US-379, RN-393, RN-394, R22-11): "Salvar item", "Salvar como modelo" e "Carregar modelo" na receita
describe('itens salvos e modelos na receita pelas ações (US-379)', () => {
  const comNome = (nome: string, campos: Record<string, string>) => {
    const f = new FormData();
    f.set('nome', nome);
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  };
  const carregar = (modeloId: string, modo: string, itens: unknown[], justificativa: string, orientacoes = '') => {
    const f = new FormData();
    f.set('conteudo', JSON.stringify({ itens, orientacoes }));
    f.set('justificativa', justificativa);
    f.set('modeloId', modeloId);
    f.set('modo', modo);
    return f;
  };

  it('"Salvar item" e "Salvar como modelo" gravam na biblioteca sem salvar o rascunho; o erro do nome volta ao diálogo', async () => {
    const { N, p } = await consultorio();
    const id = await criarReceita(N.ctx, p.id, { db });
    expect(await salvarItemAction(p.id, id, {}, comNome('Vitamina D', { item: JSON.stringify(vitD('2000')) }))).toMatchObject({ ok: true });
    const r = await salvarItemAction(p.id, id, {}, comNome('vitamina d', { item: JSON.stringify(vitD('2000')) }));
    expect(r.erros).toEqual({ nome: MSG_MODELOS.erros.itemRepetido });
    expect(r.valores).toEqual({ nome: 'vitamina d' });
    // a justificativa do rascunho não vai para o modelo (nem é enviada)
    const conteudo = JSON.stringify({ itens: [vitD('2000')], orientacoes: '- Tomar no almoço' });
    expect(await salvarComoModeloAction(p.id, id, {}, comNome('Rotina', { conteudo }))).toMatchObject({ ok: true });
    expect((await salvarComoModeloAction(p.id, id, {}, comNome('', { conteudo }))).erros?.nome).toBe(MSG_MODELOS.erros.nome);
    const [m] = await listarModelosPrescricao(N.ctx, { db });
    expect(m).toMatchObject({ nome: 'Rotina', itens: 1 });
    expect(await listarItensSalvos(N.ctx, 'suplementos', { db })).toHaveLength(1);
    // o rascunho não foi salvo nem mudou
    expect((await lerDocumento(N.ctx, p.id, id, db))?.conteudo).toMatchObject({ itens: [] });
  });

  it('"Carregar modelo" com o que está na tela: grava pelo caminho do salvar e devolve o conteúdo gravado, com a justificativa digitada', async () => {
    const { N, p } = await consultorio();
    const id = await criarReceita(N.ctx, p.id, { db });
    const [t] = await db.select().from(tenants).where(eq(tenants.id, N.tenantId));
    const modeloId = await salvarModeloPrescricao(N.ctx, t, null, { nome: 'Rotina', itens: [vitD('2000', '1 ao dia'), vitD('1000', '2 ao dia')], orientacoes: '**Do modelo**' }, { db });
    const r = await carregarModeloAction(p.id, id, carregar(modeloId, 'acrescentar', [vitD('50', 'digitado')], 'Exposição solar baixa'));
    expect(r.erros).toBeUndefined();
    expect(r.conteudo?.itens.map((i) => i.posologia)).toEqual(['digitado', '1 ao dia', '2 ao dia']);
    expect(r.conteudo?.orientacoes).toBe('**Do modelo**');
    const d = await lerDocumento(N.ctx, p.id, id, db);
    expect(d).toMatchObject({ status: 'rascunho', justificativa: 'Exposição solar baixa' });
    expect((d?.conteudo as { itens: unknown[] }).itens).toHaveLength(3);
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
    // 19 na tela + 2 do modelo: a mensagem dos 20 e nada muda
    revalidatePath.mockClear();
    const muitos = await carregarModeloAction(p.id, id, carregar(modeloId, 'acrescentar', Array.from({ length: 19 }, () => vitD('50')), 'Outra'));
    expect(muitos).toEqual({ erros: { itens: MSG_MODELOS.passaDe20 } });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await lerDocumento(N.ctx, p.id, id, db))?.justificativa).toBe('Exposição solar baixa');
    // substituir troca os itens
    expect((await carregarModeloAction(p.id, id, carregar(modeloId, 'substituir', [vitD('50', 'digitado')], 'Exposição solar baixa'))).conteudo?.itens).toHaveLength(2);
  });

  it('"Carregar modelo" numa retificação: o motivo digitado vai junto e é gravado; sem o campo (fora da retificação), o motivo gravado não muda', async () => {
    const { N, p } = await consultorio();
    const v1 = await documentoNoBanco(db, N.ctx, p.id, { status: 'assinado' });
    const v2 = String(await retificarAction(p.id, v1.id, {}).catch((e: Error) => e.message)).split('/').at(-1)!;
    const [t] = await db.select().from(tenants).where(eq(tenants.id, N.tenantId));
    const modeloId = await salvarModeloPrescricao(N.ctx, t, null, { nome: 'Rotina', itens: [vitD('2000', '1 ao dia')], orientacoes: '' }, { db });
    const comMotivo = carregar(modeloId, 'acrescentar', [vitD('50', 'digitado')], 'Exposição solar baixa');
    comMotivo.set('motivoRetificacao', 'Dose corrigida');
    expect((await carregarModeloAction(p.id, v2, comMotivo)).erros).toBeUndefined();
    expect(await lerDocumento(N.ctx, p.id, v2, db)).toMatchObject({ versao: 2, motivoRetificacao: 'Dose corrigida', justificativa: 'Exposição solar baixa' });
    // o formulário fora da retificação não manda o campo: o motivo gravado fica como estava
    expect((await carregarModeloAction(p.id, v2, carregar(modeloId, 'substituir', [], 'Exposição solar baixa'))).erros).toBeUndefined();
    expect((await lerDocumento(N.ctx, p.id, v2, db))?.motivoRetificacao).toBe('Dose corrigida');
    // o motivo inválido volta ao campo e nada muda
    const longo = carregar(modeloId, 'acrescentar', [], 'Exposição solar baixa');
    longo.set('motivoRetificacao', 'x'.repeat(501));
    expect(await carregarModeloAction(p.id, v2, longo)).toEqual({ erros: { motivoRetificacao: 'Escreva o motivo da retificação (até 500 caracteres).' } });
    expect((await lerDocumento(N.ctx, p.id, v2, db))?.motivoRetificacao).toBe('Dose corrigida');
  });

  it('sem documentos_liberados (RN-398): "Salvar item", "Salvar como modelo" e "Carregar modelo" respondem 404 e nada é gravado', async () => {
    const { N, p } = await consultorio();
    const id = await criarReceita(N.ctx, p.id, { db });
    await db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, N.tenantId));
    await expect(salvarItemAction(p.id, id, {}, comNome('Vitamina D', { item: JSON.stringify(vitD('2000')) }))).rejects.toThrow('notFound');
    await expect(salvarComoModeloAction(p.id, id, {}, comNome('Rotina', { conteudo: JSON.stringify({ itens: [vitD('2000')], orientacoes: '' }) }))).rejects.toThrow('notFound');
    await expect(carregarModeloAction(p.id, id, carregar('00000000-0000-4000-8000-000000000001', 'acrescentar', [], ''))).rejects.toThrow('notFound');
    expect(await listarItensSalvos(N.ctx, 'suplementos', { db })).toEqual([]);
    expect(await listarModelosPrescricao(N.ctx, { db })).toEqual([]);
  });
});
