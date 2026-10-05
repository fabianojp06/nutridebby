import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { criarReceita, lerDocumento } from '@/modules/documentos/documentos';
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

const { apagarRascunhoAction, entreguePessoalmenteAction, pedirNovoPdfAction, prepararAction, reenviarLinkAction, salvarRascunhoAction, voltarAEditarAction } = await import('./actions');

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
