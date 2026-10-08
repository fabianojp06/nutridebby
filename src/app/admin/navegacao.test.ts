import { describe, expect, it } from 'vitest';
import { abaAtual } from './navegacao';

describe('abas do admin (P16-17)', () => {
  it('"Contas" na lista e nas páginas de conta; "Servidor" e "Segurança" nas próprias páginas', () => {
    expect(abaAtual('/admin')).toBe('/admin');
    expect(abaAtual('/admin/contas/nova')).toBe('/admin');
    expect(abaAtual('/admin/contas/7d1f0e9a-0000-4000-8000-000000000000')).toBe('/admin');
    expect(abaAtual('/admin/servidor')).toBe('/admin/servidor');
    expect(abaAtual('/admin/seguranca')).toBe('/admin/seguranca');
    expect(abaAtual('/admin/servidores')).toBeNull();
    expect(abaAtual('/painel')).toBeNull();
  });
});
