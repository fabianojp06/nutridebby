import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { carregarReferencia, listarReferencias } from '@/modules/alimentos/referencias';
import { MSG_REFERENCIAS } from '@/modules/alimentos/referencias-constantes';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { nutriComDpa } from '../../../../../test/nutri';
import { novoPaciente } from '../../../../../test/pacientes';

// As actions pelo caminho real (requireNutri → Postgres via Testcontainers), como em plano-alimentar/actions.test.ts;
// só o que depende do runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
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

const { excluirReferenciaAction, salvarReferenciaAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());

const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const MULHER = { nome: 'Mulher 19 a 50 anos', fonte: 'DRI/IOM 2006 — conferida pela nutricionista', 'meta.ferro_mg': '18', 'maximo.ferro_mg': '45' };
const redirecionouPara = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  const m = e instanceof Error ? /^redirect (.+)$/.exec(e.message) : null;
  if (!m) throw e ?? new Error('esperava redirect');
  return m[1];
};

async function nutri() {
  const N = await nutriComDpa(db, auth);
  req.headers = new Headers({ cookie: N.cookie });
  return N;
}

describe('salvarReferenciaAction (US-232)', () => {
  it('"Novo perfil" (id nulo): cria e vai para a página do perfil criado; a lista é revalidada', async () => {
    const N = await nutri();
    const url = await redirecionouPara(salvarReferenciaAction(null, {}, formulario(MULHER)));
    const [perfil] = await listarReferencias(N.ctx, db);
    expect(url).toBe(`/painel/planos/referencias/${perfil.id}`);
    expect(perfil).toMatchObject({ nome: 'Mulher 19 a 50 anos', nutrientes: 1 });
    expect(revalidatePath).toHaveBeenCalledWith('/painel/planos/referencias');
  });

  it('sem fonte e sem valor: os erros exatos ao lado dos campos e o formulário volta com o que foi digitado; nada é gravado', async () => {
    const N = await nutri();
    const s = await salvarReferenciaAction(null, {}, formulario({ nome: 'Adulto', fonte: '' }));
    expect(s.erros).toEqual({ fonte: 'Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA).', valores: 'Informe a meta ou o máximo de pelo menos um nutriente.' });
    expect(s.valores).toMatchObject({ nome: 'Adulto', fonte: '', 'meta.ferro_mg': '' });
    expect(await listarReferencias(N.ctx, db)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('alterar fica na página com "Perfil salvo."; nome repetido é recusado no campo', async () => {
    const N = await nutri();
    await redirecionouPara(salvarReferenciaAction(null, {}, formulario(MULHER)));
    await redirecionouPara(salvarReferenciaAction(null, {}, formulario({ ...MULHER, nome: 'Homem 19 a 50 anos' })));
    const homem = (await listarReferencias(N.ctx, db)).find((p) => p.nome === 'Homem 19 a 50 anos')!;
    expect(await salvarReferenciaAction(homem.id, {}, formulario({ ...MULHER, nome: 'Homem 19 a 50 anos', 'meta.ferro_mg': '8' }))).toMatchObject({ ok: MSG_REFERENCIAS.salvo });
    expect((await carregarReferencia(N.ctx, homem.id, db))!.valores).toEqual({ ferro_mg: { meta: 8, maximo: 45 } });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/planos/referencias/${homem.id}`);
    expect((await salvarReferenciaAction(homem.id, {}, formulario(MULHER))).erros).toEqual({ nome: MSG_REFERENCIAS.nomeRepetido });
  });
});

describe('excluirReferenciaAction (US-232 "Excluir perfil em uso", D30)', () => {
  it('depois da confirmação: volta à lista, o rascunho fica "Sem perfil" e o publicado mantém a cópia; perfil de outro consultório → "Perfil não encontrado."', async () => {
    const N = await nutri();
    await redirecionouPara(salvarReferenciaAction(null, {}, formulario(MULHER)));
    const [perfil] = await listarReferencias(N.ctx, db);
    const item = () => [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }];
    const plano = async () => {
      const p = await novoPaciente(db, N.ctx);
      const { id } = await criarRascunho(N.ctx, p.id, { db });
      await salvarRascunho(N.ctx, id, { revisao: 0, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '', referenciaId: perfil.id, refeicoes: item() }, { db });
      return { p, id };
    };
    const pub = await plano();
    await publicarPlano(N.ctx, pub.p.id, pub.id, { db });
    const rascunho = await plano();
    const linha = async (id: string) => (await withTenant(N.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, id)), db))[0];
    const copia = (await linha(pub.id)).referenciaCongelada;
    expect(copia).toMatchObject({ id: perfil.id, nome: 'Mulher 19 a 50 anos' });

    const outra = await nutri();
    expect(await excluirReferenciaAction(perfil.id)).toEqual({ erros: { geral: MSG_REFERENCIAS.naoEncontrado } });
    expect(await listarReferencias(outra.ctx, db)).toEqual([]);

    req.headers = new Headers({ cookie: N.cookie });
    expect(await redirecionouPara(excluirReferenciaAction(perfil.id))).toBe('/painel/planos/referencias');
    expect(revalidatePath).toHaveBeenCalledWith('/painel/planos/referencias');
    expect((await linha(rascunho.id)).referenciaId).toBeNull();
    expect(await linha(pub.id)).toMatchObject({ status: 'publicado', referenciaCongelada: copia });
  });
});
