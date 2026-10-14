import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { RLS_EXCEPTIONS } from '@/db/rls-guard';

const ARQUIVOS_DO_ADMIN = [
  ...readdirSync(path.resolve('src/app/admin'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.join(d.parentPath, d.name)),
  path.resolve('src/modules/plataforma/contas.ts'),
  path.resolve('src/modules/plataforma/metricas.ts'),
  path.resolve('src/modules/plataforma/monitoramento.ts'),
  path.resolve('src/modules/plataforma/reiniciar-2fa.ts'),
  path.resolve('src/modules/plataforma/suspensao.ts'),
];

/**
 * Item adiado do Plano 02 (T9): a lista de tabelas 🔒 vem do próprio schema — toda tabela com
 * `tenantId` que não está nas exceções de RLS —, pelo nome no código e pelo nome no banco.
 */
const TABELAS_TENANT = Object.entries(schema)
  .filter(([, v]) => is(v, PgTable) && 'tenantId' in getTableColumns(v as PgTable))
  .map(([js, v]) => ({ js, sql: getTableName(v as PgTable) }))
  .filter((t) => !RLS_EXCEPTIONS[t.sql]);
const PROIBIDO = new RegExp(`\\b(withTenant|${TABELAS_TENANT.flatMap((t) => [t.js, t.sql]).join('|')})\\b`);

describe('§4.1: o admin nunca consulta tabelas 🔒', () => {
  it('a lista derivada do schema inclui as tabelas conhecidas', () => {
    expect(TABELAS_TENANT.map((t) => t.sql)).toEqual(expect.arrayContaining(['audit_log', 'stored_files', 'patients']));
  });
  it.each(ARQUIVOS_DO_ADMIN)('%s não acessa tabelas com tenant_id', (arquivo) => {
    expect(readFileSync(arquivo, 'utf8')).not.toMatch(PROIBIDO);
  });
});

/**
 * Todo módulo de src/modules que o admin importa ou é conferido acima (ARQUIVOS_DO_ADMIN) ou tem o motivo aqui (só
 * constante ou função pura usada pelo admin). Sem isto, um módulo novo com withTenant entrava pelo admin sem a guarda
 * (salvarMetricasBase, T9, estava em metricas-sucesso.ts).
 */
const SO_CONSTANTES: Record<string, string> = {
  'src/modules/plataforma/tenant-status.ts': 'ContaNaoEncontradaError e mensagens (o status do tenant não tem tenant_id)',
  'src/modules/plataforma/armazenamento.ts': 'só COTA_BYTES (constante)',
  'src/modules/agenda/presenca.ts': 'só textoTaxa (formatação)',
  'src/modules/ia/textos-legais.ts': 'só IA_ADITIVO_VERSAO (constante: a versão citada na confirmação de "Liberar" a IA)',
};
describe('§4.1: o que o admin importa de src/modules passa pela guarda', () => {
  const ADMIN = ARQUIVOS_DO_ADMIN.filter((f) => f.startsWith(path.resolve('src/app/admin')));
  it.each(ADMIN)('%s', (arquivo) => {
    const modulos = [...readFileSync(arquivo, 'utf8').matchAll(/from '@\/(modules\/[^']+)'/g)].map((m) => `src/${m[1]}.ts`);
    const conferidos = new Set(ARQUIVOS_DO_ADMIN.map((f) => path.relative(process.cwd(), f).split(path.sep).join('/')));
    expect(modulos.filter((m) => !conferidos.has(m) && !(m in SO_CONSTANTES))).toEqual([]);
  });
});

