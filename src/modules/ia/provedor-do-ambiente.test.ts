import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '@/env';
import { provedorIADoAmbiente } from './provedor-do-ambiente';

// Só constrói o provedor: nenhum teste aqui chama lerDocumento (nada sai da máquina).
const env = (extra: Record<string, string>) => parseWorkerEnv({ ...process.env, ...extra });

describe('provedorIADoAmbiente (T4)', () => {
  it('anthropic com chave → o provedor real; sem chave → null (credencial_invalida no worker)', () => {
    expect(provedorIADoAmbiente(env({ IA_PROVEDOR: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'x'.repeat(40) }))).toMatchObject({
      modo: 'anthropic',
      provedor: { nome: 'anthropic' },
    });
    expect(process.env.ANTHROPIC_API_KEY, 'test/setup.ts apaga a chave do ambiente').toBeUndefined();
    expect(provedorIADoAmbiente(env({ IA_PROVEDOR: 'anthropic' }))).toEqual({ modo: 'anthropic', provedor: null });
  });

  it('IA_DESLIGADA=1 nunca devolve o provedor real, mesmo com chave', () => {
    expect(provedorIADoAmbiente(env({ IA_PROVEDOR: 'anthropic', IA_DESLIGADA: '1', ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'x'.repeat(40) }))).toEqual({
      modo: 'emergencia',
      provedor: null,
    });
  });
});
