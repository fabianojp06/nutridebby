import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ARQUIVOS_DO_ADMIN = [
  ...readdirSync(path.resolve('src/app/admin'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !d.name.endsWith('.test.ts'))
    .map((d) => path.join(d.parentPath, d.name)),
  path.resolve('src/modules/plataforma/contas.ts'),
  path.resolve('src/modules/plataforma/metricas.ts'),
  path.resolve('src/modules/plataforma/monitoramento.ts'),
  path.resolve('src/modules/plataforma/suspensao.ts'),
];
// Tabelas 🔒 e a porta de entrada para elas: o código do admin não pode citar nenhuma
const PROIBIDO = /\b(withTenant|storedFiles|auditLog|stored_files|audit_log)\b/;

describe('§4.1: o admin nunca consulta tabelas 🔒', () => {
  it.each(ARQUIVOS_DO_ADMIN)('%s não acessa tabelas com tenant_id', (arquivo) => {
    expect(readFileSync(arquivo, 'utf8')).not.toMatch(PROIBIDO);
  });
});
