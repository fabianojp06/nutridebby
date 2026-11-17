import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { lembretesRotina, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { ctxPaciente, novoPaciente } from '../../../../../../../test/pacientes';

// As actions da seção "Lembretes no app" (Plano 17, Tarefa 5) pelo caminho real (requireNutri → Postgres via
// Testcontainers), como ../actions.test.ts; só o runtime do Next é simulado: headers, navegação e revalidatePath.
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

const { apagarLembreteAction, ligarLembreteAction, salvarLembreteAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());

const aba = (patientId: string) => `/painel/pacientes/${patientId}/plano-alimentar`;

function formulario(campos: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
const TODOS = ['0', '1', '2', '3', '4', '5', '6'];
const agua = (extra: Record<string, string | string[]> = {}) => formulario({ tipo: 'agua', inicio: '08:00', fim: '20:00', intervaloMin: '120', dias: TODOS, ...extra });
const suplemento = (extra: Record<string, string | string[]> = {}) => formulario({ tipo: 'suplemento', texto: 'Vitamina D', horarios: ['08:00'], dias: TODOS, ...extra });

async function cenario() {
  const N = await nutriComDpa(db, auth);
  req.headers = new Headers({ cookie: N.cookie });
  const p = await novoPaciente(db, N.ctx);
  const linhas = () => withTenant(N.ctx, (tx) => tx.select().from(lembretesRotina).where(eq(lembretesRotina.patientId, p.id)), db);
  const bloquear = () => withTenant(N.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date() }).where(eq(patients.id, p.id)), db);
  return { N, p, linhas, bloquear };
}

describe('salvarLembreteAction (Plano 17, Tarefa 5)', () => {
  it('salva, revalida a aba e devolve o id e a mensagem de sucesso', async () => {
    const { p, linhas } = await cenario();
    const r = await salvarLembreteAction(p.id, {}, agua());
    const [linha] = await linhas();
    expect(r).toEqual({ ok: 'Lembrete salvo.', id: linha.id, envio: expect.any(Number) });
    expect(linha).toMatchObject({ tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: [0, 1, 2, 3, 4, 5, 6] }, texto: null, ligado: true });
    expect(revalidatePath).toHaveBeenCalledWith(aba(p.id));

    // edição pelo id do formulário (o tipo não muda); "Não pedir" do diário chega vazio
    const { id: idRefeicoes } = (await salvarLembreteAction(p.id, {}, formulario({ tipo: 'refeicoes', antecedenciaMin: '15', diarioDepoisMin: '' }))) as { id: string };
    expect(await salvarLembreteAction(p.id, {}, formulario({ id: idRefeicoes, tipo: 'refeicoes', antecedenciaMin: '30', diarioDepoisMin: '60' }))).toMatchObject({ ok: 'Lembrete salvo.', id: idRefeicoes });
    expect((await linhas()).find((l) => l.id === idRefeicoes)?.config).toEqual({ antecedenciaMin: 30, diarioDepoisMin: 60 });
  });

  it('os erros de LembreteError voltam por campo, com o que foi digitado; nada é gravado nem revalidado', async () => {
    const { p, linhas } = await cenario();
    const r = await salvarLembreteAction(p.id, {}, agua({ inicio: '05:00', fim: '23:00', intervaloMin: '45', dias: [] }));
    expect(r.erros).toEqual({
      inicio: 'Escolha um horário entre 06:00 e 22:00.',
      fim: 'Escolha um horário entre 06:00 e 22:00.',
      intervaloMin: 'Escolha um intervalo da lista.',
      dias: 'Escolha ao menos um dia da semana.',
    });
    expect(r.valores).toMatchObject({ tipo: 'agua', inicio: '05:00', fim: '23:00', intervaloMin: '45', dias: [] });
    expect(r.ok).toBeUndefined();

    expect((await salvarLembreteAction(p.id, {}, suplemento({ texto: '  ', horarios: ['08:00', '08:00'] }))).erros).toEqual({
      texto: 'Escreva o nome do suplemento.',
      horarios: 'Há dois horários iguais. Remova um deles.',
    });
    // as regras do módulo (Tarefa 3) chegam em `geral`
    await salvarLembreteAction(p.id, {}, agua());
    expect((await salvarLembreteAction(p.id, {}, agua({ intervaloMin: '60' }))).erros).toEqual({ geral: 'Este paciente já tem esse lembrete. Edite o que existe.' });
    expect((await salvarLembreteAction(p.id, {}, agua({ id: 'nao-e-um-id' }))).erros).toEqual({ geral: 'Lembrete não encontrado. Recarregue a página.' });
    expect(await linhas()).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledTimes(1); // só o salvamento que deu certo
  });

  it('sessão de outro consultório não salva, não liga e não apaga: 404, nada muda', async () => {
    const { p, linhas } = await cenario();
    const r = await salvarLembreteAction(p.id, {}, agua());
    const id = (r as { id: string }).id;

    const outra = await nutriComDpa(db, auth);
    req.headers = new Headers({ cookie: outra.cookie });
    await expect(salvarLembreteAction(p.id, {}, suplemento())).rejects.toThrow('notFound');
    await expect(salvarLembreteAction(p.id, {}, agua({ id, intervaloMin: '60' }))).rejects.toThrow('notFound');
    await expect(ligarLembreteAction(p.id, id, false)).rejects.toThrow('notFound');
    await expect(apagarLembreteAction(p.id, id)).rejects.toThrow('notFound');

    expect(await linhas()).toEqual([expect.objectContaining({ id, tipo: 'agua', ligado: true, config: expect.objectContaining({ intervaloMin: 120 }) })]);
  });

  it('paciente bloqueado: o motivo em `geral` e nada é gravado', async () => {
    const { p, linhas, bloquear } = await cenario();
    const { id } = (await salvarLembreteAction(p.id, {}, agua())) as { id: string };
    await bloquear();
    revalidatePath.mockClear();
    expect((await salvarLembreteAction(p.id, {}, suplemento())).erros).toEqual({ geral: MSG_BLOQUEADO });
    expect(await ligarLembreteAction(p.id, id, false)).toEqual({ erro: MSG_BLOQUEADO });
    expect(await apagarLembreteAction(p.id, id)).toEqual({ erro: MSG_BLOQUEADO });
    expect(await linhas()).toEqual([expect.objectContaining({ id, ligado: true })]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('ligarLembreteAction e apagarLembreteAction (Plano 17, Tarefa 5)', () => {
  it('liga, desliga e apaga, com a mensagem de cada um e a aba revalidada', async () => {
    const { p, linhas } = await cenario();
    const { id } = (await salvarLembreteAction(p.id, {}, suplemento())) as { id: string };
    expect(await ligarLembreteAction(p.id, id, false)).toEqual({ ok: 'Lembrete desligado.' });
    expect((await linhas())[0].ligado).toBe(false);
    expect(await ligarLembreteAction(p.id, id, true)).toEqual({ ok: 'Lembrete ligado.' });
    expect((await linhas())[0].ligado).toBe(true);
    expect(await apagarLembreteAction(p.id, id)).toEqual({ ok: 'Lembrete apagado.' });
    expect(await linhas()).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith(aba(p.id));
    // já apagado (outra aba): a mensagem do módulo
    expect(await apagarLembreteAction(p.id, id)).toEqual({ erro: 'Lembrete não encontrado. Recarregue a página.' });
    expect(await ligarLembreteAction(p.id, id, true)).toEqual({ erro: 'Lembrete não encontrado. Recarregue a página.' });
  });

  it('o que o paciente desligou: a equipe desliga do lado dela (sem limpar a escolha dele), mas não apaga', async () => {
    const { N, p, linhas } = await cenario();
    const { id } = (await salvarLembreteAction(p.id, {}, agua())) as { id: string };
    await withTenant(ctxPaciente(N.tenantId, p.id), (tx) => tx.update(lembretesRotina).set({ desligadoPeloPacienteEm: new Date() }).where(eq(lembretesRotina.id, id)), db);
    expect(await ligarLembreteAction(p.id, id, false)).toEqual({ ok: 'Lembrete desligado.' });
    expect(await apagarLembreteAction(p.id, id)).toEqual({ erro: 'O paciente desligou este lembrete. Você pode desligá-lo do seu lado, mas não apagá-lo.' });
    expect(await linhas()).toEqual([expect.objectContaining({ id, ligado: false, desligadoPeloPacienteEm: expect.any(Date) })]);
  });

  it('`ligado` que não é booleano (formulário adulterado) não liga', async () => {
    const { p, linhas } = await cenario();
    const { id } = (await salvarLembreteAction(p.id, {}, agua())) as { id: string };
    await ligarLembreteAction(p.id, id, false);
    expect(await ligarLembreteAction(p.id, id, 'true' as unknown as boolean)).toEqual({ ok: 'Lembrete desligado.' });
    expect((await linhas())[0].ligado).toBe(false);
  });
});
