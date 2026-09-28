import 'server-only';
import { headers } from 'next/headers';
import { getEnv } from '@/env';
import { clientIp } from './ip';

/** IP de quem fez a requisição atual (Server Components e Server Actions). */
export async function requestIp(): Promise<string | null> {
  return clientIp(await headers(), getEnv().TRUSTED_PROXIES);
}
