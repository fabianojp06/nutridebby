import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWorkerEnv } from '@/env';
import { provedorIADoAmbiente } from './provedor-do-ambiente';

// Restrição global: nenhum teste instancia o provedorAnthropic real sem fetch falso. Aqui ele é trocado por um dublê
// que só registra a chave recebida e falha se alguém tentar ler um documento (nada sai da máquina, nem por engano).
const { montado } = vi.hoisted(() => ({ montado: vi.fn() }));
vi.mock('./provedor-anthropic', () => ({
  provedorAnthropic: (o: { apiKey: string }) => {
    montado(o);
    return {
      nome: 'anthropic',
      lerDocumento: () => {
        throw new Error('sem rede');
      },
    };
  },
}));

const CHAVE = 'sk-ant-api03-' + 'x'.repeat(40);
const env = (extra: Record<string, string>) => parseWorkerEnv({ ...process.env, ...extra });

describe('provedorIADoAmbiente (T4)', () => {
  beforeEach(() => montado.mockClear());

  it('anthropic com chave → o provedor anthropic com a chave do ambiente; sem chave → null (credencial_invalida no worker)', () => {
    expect(provedorIADoAmbiente(env({ IA_PROVEDOR: 'anthropic', ANTHROPIC_API_KEY: CHAVE }))).toMatchObject({
      modo: 'anthropic',
      provedor: { nome: 'anthropic' },
    });
    expect(montado).toHaveBeenCalledTimes(1);
    expect(montado.mock.calls[0]![0]).toEqual({ apiKey: CHAVE });

    expect(process.env.ANTHROPIC_API_KEY, 'test/setup.ts apaga a chave do ambiente').toBeUndefined();
    expect(provedorIADoAmbiente(env({ IA_PROVEDOR: 'anthropic' }))).toEqual({ modo: 'anthropic', provedor: null });
    expect(montado).toHaveBeenCalledTimes(1);
  });

  it('IA_DESLIGADA=1 nunca devolve o provedor real, mesmo com chave', () => {
    expect(provedorIADoAmbiente(env({ IA_PROVEDOR: 'anthropic', IA_DESLIGADA: '1', ANTHROPIC_API_KEY: CHAVE }))).toEqual({
      modo: 'emergencia',
      provedor: null,
    });
    expect(montado).not.toHaveBeenCalled();
  });
});
