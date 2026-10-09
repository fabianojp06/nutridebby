import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWorkerEnv } from '@/env';
import { provedorIADoAmbiente } from './provedor-do-ambiente';

// Restrição global: nenhum teste instancia o provedorAnthropic real sem fetch falso. Aqui ele é trocado por um dublê
// que só registra a chave recebida e falha se alguém tentar ler um documento (nada sai da máquina, nem por engano).
const { montado, montadoBedrock } = vi.hoisted(() => ({ montado: vi.fn(), montadoBedrock: vi.fn() }));
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

// Plano 14A: o mesmo para o provedor do Bedrock — o dublê só registra as opções recebidas
vi.mock('./provedor-bedrock', () => ({
  provedorBedrock: (o: unknown) => {
    montadoBedrock(o);
    return {
      nome: 'bedrock-eu',
      lerDocumento: () => {
        throw new Error('sem rede');
      },
    };
  },
}));

const CHAVE = 'sk-ant-api03-' + 'x'.repeat(40);
const env = (extra: Record<string, string>) => parseWorkerEnv({ ...process.env, ...extra });

describe('provedorIADoAmbiente (T4)', () => {
  beforeEach(() => {
    montado.mockClear();
    montadoBedrock.mockClear();
  });

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

  it('bedrock-eu com as duas chaves e a região → o provedor do Bedrock com elas; sem chave → null (credencial_invalida)', () => {
    const AK = 'AKIA' + 'Q'.repeat(16);
    const SK = 'k'.repeat(40);
    const base = { IA_PROVEDOR: 'bedrock-eu', IA_BEDROCK_REGIAO: 'eu-west-3', IA_MODELO_LEITURA: 'claude-sonnet-5-5' };
    expect(provedorIADoAmbiente(env({ ...base, AWS_ACCESS_KEY_ID: AK, AWS_SECRET_ACCESS_KEY: SK }))).toMatchObject({ modo: 'bedrock-eu', provedor: { nome: 'bedrock-eu' } });
    expect(montadoBedrock.mock.calls[0]![0]).toEqual({ regiao: 'eu-west-3', accessKeyId: AK, secretAccessKey: SK });
    expect(provedorIADoAmbiente(env(base))).toEqual({ modo: 'bedrock-eu', provedor: null });
    expect(montadoBedrock).toHaveBeenCalledTimes(1);
  });
});
