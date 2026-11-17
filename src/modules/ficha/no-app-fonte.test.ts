import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(helper).toMatch(/withTenant\(\s*\{ tenantId, role: 'paciente', patientId, /);
    expect(helper).toMatch(/current_setting\('app\.role', true\)/);
    expect(helper).toMatch(/papel !== 'paciente'/);
    expect(helper.indexOf("papel !== 'paciente'")).toBeLessThan(helper.indexOf('as TxDePaciente'));
  });

  it('não importa nem chama o registro de leitura nem a liberação das receitas do plano; não cita o cadastro complementar', () => {
    expect(fonte).not.toMatch(/\bauditRead\b/);
    expect(fonte).not.toMatch(/\brecordAudit\b/);
    expect(fonte).not.toMatch(/liberarReceitas|receitas_do_plano/);
    expect(fonte).not.toMatch(/\bpatientCadastro\b|patient_cadastro/);
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
});
