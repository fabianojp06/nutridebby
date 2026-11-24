import { afterAll, describe, expect, it, vi } from 'vitest';
import { novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { listarCatalogo } from '@/modules/exames/catalogo';
import { MSG_EXAMES } from '@/modules/exames/constantes';

// Plano 22 (T3, US-370): as actions do catálogo pelo caminho real (módulo → Postgres do Testcontainers); só a sessão
// (requireNutri) e o runtime do Next são simulados. Papel errado: o requireNutri de verdade redireciona (simulado aqui).
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  requireNutri: async () => {
    if (sessao.atual === 'paciente') throw new Error('redirect /p');
    return sessao.atual;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { adicionarNomesParaComecarAction, excluirExameDoCatalogoAction, salvarExameDoCatalogoAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

async function consultorio(): Promise<TenantDeTeste> {
  const T = await novoTenant(db);
  sessao.atual = { ctx: T.ctx, tenant: T.tenant };
  return T;
}
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const destino = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const E = MSG_EXAMES.erros;

describe('actions do catálogo de exames (US-370)', () => {
  it('erro: devolve as mensagens e os valores digitados (faixas e textos de várias linhas) — nada some', async () => {
    const T = await consultorio();
    const f = form({
      nome: 'Vitamina D',
      unidade: '',
      sinonimos: '25-OH vitamina D\r\n25-hidroxivitamina D',
      componentes: '',
      modeloNotaAbaixo: 'Investigar exposição solar.',
      modeloNotaAcima: '',
      'faixas.0.sexo': 'F',
      'faixas.0.idadeMin': '18',
      'faixas.0.idadeMax': '',
      'faixas.0.aPartirDe': '',
      'faixas.0.abaixoDe': '20',
      'faixas.0.categoria': 'Deficiência',
      'faixas.0.fonte': 'D',
    });
    const s = await salvarExameDoCatalogoAction(null, {}, f);
    expect(s.erros).toEqual({ 'faixas.0.fonte': E.fonte });
    expect(s.valores).toEqual({
      nome: 'Vitamina D',
      unidade: '',
      sinonimos: '25-OH vitamina D\r\n25-hidroxivitamina D',
      componentes: '',
      modeloNotaAbaixo: 'Investigar exposição solar.',
      modeloNotaAcima: '',
      'faixas.0.sexo': 'F',
      'faixas.0.idadeMin': '18',
      'faixas.0.idadeMax': '',
      'faixas.0.aPartirDe': '',
      'faixas.0.abaixoDe': '20',
      'faixas.0.categoria': 'Deficiência',
      'faixas.0.fonte': 'D',
    });
    expect(s.envio).toEqual(expect.any(Number));
    // com a fonte, falta a unidade
    f.set('faixas.0.fonte', 'Diretriz X, 2024');
    expect((await salvarExameDoCatalogoAction(null, {}, f)).erros).toEqual({ faixas: E.semUnidade });
    expect(await listarCatalogo(T.ctx, { db })).toEqual([]);
  });

  it('sucesso: grava e redireciona para a lista com "Exame salvo." (ok=salvo e o marcador)', async () => {
    const T = await consultorio();
    const f = form({ nome: 'Ferritina', unidade: 'ng/mL', sinonimos: 'ferritina sérica', componentes: '', modeloNotaAbaixo: '', modeloNotaAcima: '' });
    expect(await destino(salvarExameDoCatalogoAction(null, {}, f))).toMatch(/^redirect \/painel\/exames\/catalogo\?ok=salvo&r=[0-9a-f]{8}$/);
    const [e] = await listarCatalogo(T.ctx, { db });
    expect(e).toMatchObject({ nome: 'Ferritina', unidade: 'ng/mL', sinonimos: ['ferritina sérica'] });
    // editar o mesmo
    f.set('unidade', 'µg/L');
    expect(await destino(salvarExameDoCatalogoAction(e.id, {}, f))).toMatch(/^redirect \/painel\/exames\/catalogo\?ok=salvo&r=/);
    expect((await listarCatalogo(T.ctx, { db }))[0].unidade).toBe('µg/L');
    // excluir
    expect(await destino(excluirExameDoCatalogoAction(e.id))).toMatch(/^redirect \/painel\/exames\/catalogo\?ok=excluido&r=[0-9a-f]{8}$/);
    expect(await listarCatalogo(T.ctx, { db })).toEqual([]);
  });

  it('"Adicionar ao catálogo": nenhum marcado → a mensagem; marcados → redireciona com a quantidade; limite → a mensagem do limite', async () => {
    const T = await consultorio();
    expect(await adicionarNomesParaComecarAction({}, new FormData())).toEqual({ erro: MSG_EXAMES.catalogo.nenhumMarcado, envio: expect.any(Number) });
    const f = new FormData();
    f.append('nome', 'TSH');
    f.append('nome', 'Hemograma completo');
    expect(await destino(adicionarNomesParaComecarAction({}, f))).toMatch(/^redirect \/painel\/exames\/catalogo\?ok=adicionados&n=2&r=[0-9a-f]{8}$/);
    expect((await listarCatalogo(T.ctx, { db })).map((e) => e.nome).sort()).toEqual(['Hemograma completo', 'TSH']);
  });

  it('papel errado: o requireNutri redireciona e nada é gravado', async () => {
    const T = await consultorio();
    sessao.atual = 'paciente';
    expect(await destino(salvarExameDoCatalogoAction(null, {}, form({ nome: 'Ferritina' })))).toBe('redirect /p');
    expect(await destino(adicionarNomesParaComecarAction({}, form({ nome: 'TSH' })))).toBe('redirect /p');
    expect(await destino(excluirExameDoCatalogoAction('0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b'))).toBe('redirect /p');
    expect(await listarCatalogo(T.ctx, { db })).toEqual([]);
  });
});
