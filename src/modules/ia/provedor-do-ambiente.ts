import type { WorkerEnv } from '@/env';
import { configIA, type ModoIA } from './modo';
import type { ProvedorIA } from './provedor';
import { provedorFake } from './provedor-fake';
import { provedorSandbox } from './provedor-sandbox';

/**
 * Só o worker importa este arquivo (guarda de grafo, T4). `provedor: null` com `modo: 'anthropic'` = chave ausente →
 * cada tarefa termina como `credencial_invalida` e os admins recebem e-mail (spec §12).
 */
export function provedorIADoAmbiente(env: WorkerEnv): { modo: ModoIA; provedor: ProvedorIA | null } {
  const { modo } = configIA(env);
  switch (modo) {
    case 'sandbox':
      return { modo, provedor: provedorSandbox() };
    case 'fake':
      return { modo, provedor: provedorFake() };
    default:
      return { modo, provedor: null };
  }
}
