import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { patientCadastro, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { CAMPOS_DO_CADASTRO, MSG_CADASTRO } from '@/modules/pacientes/cadastro';

// Plano 18 (US-260, RN-261): as ações do formulário de cadastro pelo caminho real (criarPaciente/atualizarPaciente →
// Postgres via Testcontainers); só a sessão (requireNutri) e o runtime do Next são simulados.
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => sessao.atual }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { atualizarPacienteAction, criarPacienteAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => vi.mocked(revalidatePath).mockClear());

const CPF = '529.982.247-25';
async function consultorio(): Promise<TenantDeTeste> {
  const T = await novoTenant(db);
  sessao.atual = { ctx: T.ctx, tenant: T.tenant };
  return T;
}
const comCpf = async (T: TenantDeTeste, extra: Partial<typeof patients.$inferInsert> = {}) => {
  const p = await novoPaciente(db, T.ctx, extra);
  await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, cpf: '52998224725' }), db);
  return p;
};
/** O formulário em seções: todos os campos do cadastro, vazio = ''. */
function formulario(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const c of CAMPOS_DO_CADASTRO) f.set(c, '');
  const campos = { nome: 'Bia Lima', dataNascimento: '1990-05-20', sexo: 'F', email: `bia-${randomUUID().slice(0, 8)}@ex.com`, telefone: '', ...extra };
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const destino = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

describe('criarPacienteAction (Plano 18)', () => {
  it('CPF repetido: erros.cpf, cpfExistenteId do outro e tudo o que foi digitado de volta', async () => {
    const T = await consultorio();
    const ana = await comCpf(T);
    const f = formulario({ cpf: CPF, nomeSocial: 'Bia', estadoCivil: 'casado', cep: '13015-904', uf: 'SP', observacao: 'linha 1\r\nlinha 2' });
    const s = await criarPacienteAction({}, f);
    expect(s.erros).toEqual({ cpf: MSG_CADASTRO.cpfRepetido });
    expect(s.cpfExistenteId).toBe(ana.id);
    expect(s.valores).toMatchObject({ nome: 'Bia Lima', cpf: CPF, nomeSocial: 'Bia', estadoCivil: 'casado', cep: '13015-904', uf: 'SP', observacao: 'linha 1\r\nlinha 2' });
    // nada gravado
    expect(await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, String(f.get('email')))), db)).toEqual([]);
  });

  it('o outro bloqueado por pedido de exclusão: a mensagem, sem cpfExistenteId (sem o link)', async () => {
    const T = await consultorio();
    await comCpf(T, { status: 'bloqueado', bloqueadoEm: new Date() });
    const s = await criarPacienteAction({}, formulario({ cpf: CPF }));
    expect(s.erros).toEqual({ cpf: MSG_CADASTRO.cpfRepetido });
    expect(s).not.toHaveProperty('cpfExistenteId');
    expect(s.valores).toMatchObject({ cpf: CPF });
  });

  it('CPF inválido: só o erro do campo, sem cpfExistenteId; cadastro válido vai para o Início do paciente', async () => {
    const T = await consultorio();
    const s = await criarPacienteAction({}, formulario({ cpf: '111.111.111-11' }));
    expect(s.erros).toEqual({ cpf: MSG_CADASTRO.cpfInvalido });
    expect(s).not.toHaveProperty('cpfExistenteId');
    const msg = await destino(criarPacienteAction({}, formulario({ cpf: CPF, estadoCivil: 'casado', cep: '13015-904' })));
    expect(msg).toMatch(/^redirect \/painel\/pacientes\/[0-9a-f-]{36}$/);
    const id = msg!.split('/').at(-1)!;
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, id)), db);
    expect(c).toMatchObject({ cpf: '52998224725', estadoCivil: 'casado', cep: '13015904' });
  });
});

describe('atualizarPacienteAction (Plano 18)', () => {
  it('CPF repetido na edição: erros.cpf e cpfExistenteId; select desabilitado (fora do FormData) mantém o gravado', async () => {
    const T = await consultorio();
    const ana = await comCpf(T);
    const bia = await novoPaciente(db, T.ctx, { nome: 'Bia Lima' });
    await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: bia.id, uf: 'RJ', ocupacao: 'Professora' }), db);
    const s = await atualizarPacienteAction(bia.id, {}, formulario({ email: bia.email, cpf: CPF }));
    expect(s).toMatchObject({ erros: { cpf: MSG_CADASTRO.cpfRepetido }, cpfExistenteId: ana.id, valores: { cpf: CPF } });
    expect(revalidatePath).not.toHaveBeenCalled();

    const f = formulario({ email: bia.email, ocupacao: 'Engenheira' });
    f.delete('uf');
    expect(await atualizarPacienteAction(bia.id, {}, f)).toEqual({ ok: true });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, bia.id)), db);
    expect(c).toMatchObject({ uf: 'RJ', ocupacao: 'Engenheira', cpf: null });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${bia.id}`, 'layout');
  });
});
