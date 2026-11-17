import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MSG_NO_APP } from './textos';

// Plano 18 (D16, RN-279, RN-281; Review Focus 1 e 2): o contexto do paciente sem login abre só em `no-app.ts`, por um
// helper que não sai do arquivo; ali dentro só contagens e ids — sem registro de leitura, sem a liberação das receitas do
// plano, sem o cadastro complementar —, e só `no-app.ts` marca uma transação como `TxDePaciente`.
const NO_APP = path.resolve('src/modules/ficha/no-app.ts');
const fonte = readFileSync(NO_APP, 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const codigo = semComentarios(fonte);

describe('no-app.ts (guardas de fonte)', () => {
  it('o helper do contexto do paciente (`comoPaciente`) existe e não é exportado; só `noAppDoPaciente` (e os tipos) saem', () => {
    expect(codigo).toMatch(/^async function comoPaciente</m);
    expect(codigo).not.toMatch(/export\s+(async\s+)?function\s+comoPaciente\b/);
    expect(codigo).not.toMatch(/export\s*\{[^}]*\bcomoPaciente\b/);
    expect(codigo).not.toMatch(/export\s+(const|let)\s+comoPaciente\b/);
    const exportados = [...codigo.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|type|class)\s+(\w+)/gm)].map((m) => m[1]).sort();
    expect(exportados).toEqual(['EstadoNoApp', 'NoApp', 'noAppDoPaciente']);
  });

  it('o contexto do paciente confere o papel na própria transação antes de virar `TxDePaciente`', () => {
    const helper = codigo.slice(codigo.indexOf('async function comoPaciente'), codigo.indexOf('export async function noAppDoPaciente'));
    // o contexto é o de paciente SEM login (`semConta: true`), não uma sessão de paciente com ator
    expect(helper).toMatch(/withTenant\(\s*\{ tenantId, role: 'paciente', patientId, semConta: true \}/);
    expect(helper).toMatch(/current_setting\('app\.role', true\)/);
    expect(helper).toMatch(/papel !== 'paciente'/);
    expect(helper.indexOf("papel !== 'paciente'")).toBeLessThan(helper.indexOf('as TxDePaciente'));
  });

  it('imports em lista fechada (nada que audite por padrão nem módulo de UI); acréscimo aqui, de propósito e com revisão', () => {
    const imports = [...fonte.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2]);
    expect(fonte).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    expect(imports.sort()).toEqual(
      [
        'drizzle-orm',
        '@/db/client',
        '@/db/schema',
        '@/db/tenant',
        '@/modules/pacientes/base',
        '@/modules/pacientes/convite-paciente',
        '@/modules/pacientes/datas',
        './secoes',
        './textos',
        './tipos',
      ].sort(),
    );
  });

  it('não importa nem chama o registro de leitura nem a liberação das receitas do plano; não cita o cadastro complementar', () => {
    expect(fonte).not.toMatch(/\bauditRead\b/);
    expect(fonte).not.toMatch(/\brecordAudit\b/);
    expect(fonte).not.toMatch(/liberarReceitas|receitas_do_plano/);
    expect(fonte).not.toMatch(/\bpatientCadastro\b|patient_cadastro/);
  });

  it('minimização: arquivado, bloqueado e anonimizado saem (`semAcesso`) antes de qualquer outra leitura', () => {
    const corpo = codigo.slice(codigo.indexOf('export async function noAppDoPaciente'));
    const saida = corpo.indexOf("p.status === 'arquivado' || p.status === 'bloqueado' || p.anonimizadoEm");
    expect(saida).toBeGreaterThan(0);
    for (const leitura of ['pesoOcultoNoAppEm', '.from(tenants)', '.from(accessEvents)', '.from(pushSubscriptions)', '.from(mealPlans)', '.from(lembretesRotina)', 'situacaoDoAcesso(', 'comoPaciente('])
      expect(corpo.indexOf(leitura), leitura).toBeGreaterThan(saida);
    expect(corpo).toMatch(/if \(doPainel\.fechado\) return semAcesso\(doPainel\.fechado\);/);
  });

  it('`noAppDoPaciente` recusa todo papel que não seja `nutri` antes de qualquer consulta', () => {
    const corpo = codigo.slice(codigo.indexOf('export async function noAppDoPaciente'));
    expect(corpo).toMatch(/if \(ctx\.role !== 'nutri'\) throw new TenantContextError/);
    expect(corpo.indexOf("ctx.role !== 'nutri'")).toBeLessThan(corpo.indexOf('withTenant('));
  });

  it('só `no-app.ts` cria `TxDePaciente` (nenhum outro arquivo de src faz o cast)', () => {
    const fontes = (readdirSync(path.resolve('src'), { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /\bas\s+TxDePaciente\b/.test(semComentarios(readFileSync(path.join('src', f), 'utf8'))))
      .map((f) => f.split(path.sep).join('/'));
    expect(fontes).toEqual(['modules/ficha/no-app.ts']);
  });

  it('textos exatos da spec §8.5 (regra 4): cada texto da tabela de situações e do esboço sai igual de MSG_NO_APP', () => {
    const spec = readFileSync(path.resolve('docs/superpowers/specs/2026-11-16-nutridebby-18-ficha-cadastro-design.md'), 'utf8');
    const secao = spec.slice(spec.indexOf('### 8.5 '), spec.indexOf('## 9. '));
    const a = MSG_NO_APP.acesso;
    const entreAspas = [
      a.naoEntrou,
      a.reenviar,
      a.arquivado,
      a.bloqueado,
      a.nuncaAcessou,
      MSG_NO_APP.notificacoes.desligadas,
      MSG_NO_APP.plano.nenhum,
      MSG_NO_APP.plano.listaDeCompras,
      MSG_NO_APP.plano.receitas(1),
      MSG_NO_APP.lembretes.ligados(1),
      MSG_NO_APP.lembretes.pausados,
      MSG_NO_APP.iaNutri.ligada,
      MSG_NO_APP.iaNutri.desligada,
      MSG_NO_APP.evolucao.gorduraAparece,
      MSG_NO_APP.evolucao.gorduraNaoAparece,
    ];
    for (const t of entreAspas) expect(secao, t).toContain(`"${t}`);
    // o esboço (linhas "{rótulo}   {texto}" separadas por " · ")
    for (const t of [
      MSG_NO_APP.intro('Joana Silva'),
      a.ativo,
      a.ultimoAcessoEm('14/11/2026'),
      MSG_NO_APP.notificacoes.ativas(1),
      MSG_NO_APP.notificacoes.whatsapp,
      MSG_NO_APP.plano.publicadoEm('10/11/2026'),
      MSG_NO_APP.plano.receitas(3),
      MSG_NO_APP.evolucao.avaliacoes(5),
      MSG_NO_APP.evolucao.pesoOculto,
      MSG_NO_APP.atendimentos(7),
      MSG_NO_APP.conteudosNaBiblioteca(12),
      MSG_NO_APP.envios(1),
      MSG_NO_APP.diario(9),
    ])
      expect(secao, t).toContain(t);
  });
});
