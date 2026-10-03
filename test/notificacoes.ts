import { getDb } from '@/db/client';
import { encryptionKey } from '@/lib/crypto';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import type { DepsEnvio } from '@/modules/notificacoes/enviar';
import { transporteFalso, type TransporteFalso } from './email';

/**
 * R12: dependências do motor de envio para os testes, num lugar só — tarefas novas acrescentam aqui o padrão do que
 * vier, em vez de remendar os `deps` de cada teste. Relógio parado em `agora`; e-mail em memória (`transport.enviados`);
 * WhatsApp e push desligados (`whatsapp: null`, `push: null`) salvo se o teste passar um provedor; a chave dos links é a
 * do worker (ENCRYPTION_KEY do test/setup.ts).
 */
export function depsDeEnvio(agora: Date, overrides: Partial<Omit<DepsEnvio, 'email'>> & { transport?: TransporteFalso } = {}): DepsEnvio & { transport: TransporteFalso } {
  const { transport = transporteFalso(), ...resto } = overrides;
  return {
    db: resto.db ?? getDb(),
    agora: () => agora,
    appUrl: 'http://localhost:3000',
    chaveLinks: chaveDosLinks(encryptionKey()),
    whatsapp: null,
    push: null,
    ...resto,
    // depois do spread: o transporte devolvido é sempre o que o motor usa (revisão da T5)
    email: { transport, from: 'NutriDebby <nao-responda@nutridebby.test>' },
    transport,
  };
}
