import { getDb } from '@/db/client';
import { encryptionKey } from '@/lib/crypto';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import type { DepsEnvio } from '@/modules/notificacoes/enviar';
import { transporteFalso, type TransporteFalso } from './email';

/**
 * R12: dependências do motor de envio para os testes, num lugar só — as Tarefas 10, 11 e 13 acrescentam aqui o padrão
 * de WhatsApp e push, em vez de remendar os `deps` de cada teste. Relógio parado em `agora`; e-mail em memória
 * (`transport.enviados`); a chave dos links é a do worker (ENCRYPTION_KEY do test/setup.ts).
 */
export function depsDeEnvio(agora: Date, overrides: Partial<DepsEnvio> & { transport?: TransporteFalso } = {}): DepsEnvio & { transport: TransporteFalso } {
  const { transport = transporteFalso(), ...resto } = overrides;
  return {
    db: resto.db ?? getDb(),
    agora: () => agora,
    appUrl: 'http://localhost:3000',
    chaveLinks: chaveDosLinks(encryptionKey()),
    email: { transport, from: 'NutriDebby <nao-responda@nutridebby.test>' },
    ...resto,
    transport,
  };
}
