import type { WorkerEnv } from '@/env';
import { configIA, type ModoIA } from './modo';
import type { ProvedorIA } from './provedor';
import { provedorAnthropic } from './provedor-anthropic';
import { provedorBedrock } from './provedor-bedrock';
import { provedorFake } from './provedor-fake';
import { provedorSandbox } from './provedor-sandbox';

/**
 * Só o worker importa este arquivo (guarda de grafo, T4). `provedor: null` com `modo: 'anthropic'` ou `'bedrock-eu'` = chave ausente →
 * cada tarefa termina como `credencial_invalida` e os admins recebem e-mail (spec §12).
 */
export function provedorIADoAmbiente(env: WorkerEnv): { modo: ModoIA; provedor: ProvedorIA | null } {
  const { modo } = configIA(env);
  switch (modo) {
    case 'sandbox':
      return { modo, provedor: provedorSandbox() };
    case 'fake':
      return { modo, provedor: provedorFake() };
    case 'anthropic':
      return { modo, provedor: env.ANTHROPIC_API_KEY ? provedorAnthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null };
    case 'bedrock-eu':
      // §12 / RNF-107: sem as duas chaves (ou sem a região, que o ambiente já exige), provedor nulo → credencial_invalida
      return {
        modo,
        provedor:
          env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.IA_BEDROCK_REGIAO
            ? provedorBedrock({ regiao: env.IA_BEDROCK_REGIAO, accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY })
            : null,
      };
    default:
      return { modo, provedor: null };
  }
}
