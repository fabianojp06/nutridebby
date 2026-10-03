import type { EmailTransport, OutgoingEmail } from '@/email/transport';

export type TransporteFalso = EmailTransport & { enviados: OutgoingEmail[] };

/** Transporte em memória; `falhar` = quantas chamadas seguidas recusar antes de aceitar. */
export function transporteFalso(opts: { falhar?: number } = {}): TransporteFalso {
  let falhas = opts.falhar ?? 0;
  const enviados: OutgoingEmail[] = [];
  return {
    enviados,
    async send(e) {
      if (falhas > 0) {
        falhas--;
        throw new Error('fora do ar');
      }
      enviados.push(e);
    },
  };
}
