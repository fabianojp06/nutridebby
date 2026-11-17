import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { nutriComDpa } from '../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../test/pacientes';

// pedirNovoPdfAction pelo caminho real (requireNutri → Postgres via Testcontainers), como src/app/painel/actions.test.ts;
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

const { pedirNovoPdfAction, publicarAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());

async function publicado() {
  const N = await nutriComDpa(db, auth);
  req.headers = new Headers({ cookie: N.cookie });
  const p = await novoPaciente(db, N.ctx);
  const { id } = await criarRascunho(N.ctx, p.id, { db });
  await salvarRascunho(N.ctx, id, {
    revisao: 0, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '',
    refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
  }, { db });
  await publicarPlano(N.ctx, p.id, id, { db }); // pdf_status = 'pendente'
  return { N, p, id };
}

describe('pedirNovoPdfAction (US-026 "Gerar o PDF de novo")', () => {
  it('PDF já pendente (aba velha mostrando "falhou"): o motivo e a página revalidada, que passa a mostrar "Seu PDF está sendo preparado"', async () => {
    const { p, id } = await publicado();
    expect(await pedirNovoPdfAction(p.id, id)).toEqual({ erro: 'O PDF já está sendo preparado.' });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/plano-alimentar/${id}`);
  });

  it('PDF já pronto: sem erro e a página revalidada mostra "Baixar PDF"; plano de outro paciente: "Plano não encontrado." sem revalidar', async () => {
    const { N, p, id } = await publicado();
    await withTenant(N.ctx, (tx) => tx.update(mealPlans).set({ pdfStatus: 'pronto' }).where(eq(mealPlans.id, id)), db);
    expect(await pedirNovoPdfAction(p.id, id)).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/plano-alimentar/${id}`);

    revalidatePath.mockClear();
    const outro = await novoPaciente(db, N.ctx);
    expect(await pedirNovoPdfAction(outro.id, id)).toEqual({ erro: 'Plano não encontrado.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('publicarAction (D31, Plano 19: avisos em dois passos)', () => {
  const VET = 'Registre o VET, a distribuição de macro e micronutrientes e as quantidades da prescrição no plano ou no atendimento.';
  async function rascunhoLivre(refeicao: { descricaoLivre: string | null; diasSemana?: number[] }) {
    const N = await nutriComDpa(db, auth);
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    const { id } = await criarRascunho(N.ctx, p.id, { db });
    const almoco = randomUUID();
    await salvarRascunho(N.ctx, id, {
      revisao: 0, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '', modo: 'livre',
      refeicoes: [{ id: almoco, nome: 'Almoço', horario: '12:00', observacao: '', itens: [], ...refeicao }],
    }, { db });
    return { N, p, id, almoco };
  }
  const status = async (N: Awaited<ReturnType<typeof nutriComDpa>>, id: string) =>
    (await withTenant(N.ctx, (tx) => tx.select({ s: mealPlans.status }).from(mealPlans).where(eq(mealPlans.id, id)), db))[0].s;
  const confirmando = (...avisos: string[]) => {
    const fd = new FormData();
    for (const a of avisos) fd.append('confirmarAvisos', a);
    return fd;
  };

  it('com aviso: devolve os avisos e nada é publicado; "Publicar mesmo assim" (os avisos de volta) publica e vai à página do plano', async () => {
    const { N, p, id } = await rascunhoLivre({ descricaoLivre: 'Prato feito', diasSemana: [1, 2, 3, 4, 5, 6] });
    expect(await publicarAction(p.id, id, {}, new FormData())).toEqual({ avisos: [VET, 'Domingo não tem refeições.'] });
    expect(await publicarAction(p.id, id)).toEqual({ avisos: [VET, 'Domingo não tem refeições.'] }); // sem formulário, como antes
    expect(await status(N, id)).toBe('rascunho');
    expect(await publicarAction(p.id, id, {}, confirmando(VET))).toEqual({ avisos: [VET, 'Domingo não tem refeições.'] });
    await expect(publicarAction(p.id, id, {}, confirmando(VET, 'Domingo não tem refeições.'))).rejects.toThrow(`redirect /painel/pacientes/${p.id}/plano-alimentar/${id}?publicado=1`);
    expect(await status(N, id)).toBe('publicado');
  });

  it('erro de um campo: o texto e a chave do campo (o botão vira link para a caixa "O que comer"); erro geral só com o texto', async () => {
    const { N, p, id, almoco } = await rascunhoLivre({ descricaoLivre: null });
    expect(await publicarAction(p.id, id, {}, new FormData())).toEqual({ erro: 'A refeição "Almoço" está sem texto.', campo: `refeicao:${almoco}:descricaoLivre` });
    const outro = await novoPaciente(db, N.ctx);
    expect(await publicarAction(outro.id, id, {}, new FormData())).toEqual({ erro: 'Plano não encontrado.' });
  });
});
