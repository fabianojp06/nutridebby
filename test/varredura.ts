import { vi } from 'vitest';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import type { TenantDeTeste } from './pacientes';

/**
 * SUS-105: as varreduras dos jobs do worker (expiração, anonimização, limpeza) passam por todos os tenants de
 * `listarTenantsParaVarredura`, e o banco do Vitest é um só para todos os arquivos: milhares de tenants dos outros testes
 * (~14 s por chamada com 3000 tenants, SUS-103) e as linhas deles ao alcance da varredura. A próxima chamada passa só
 * pelos tenants dados — os do próprio teste; um `{ id, fuso }` cru serve para provar o tenant com erro.
 *
 * O arquivo de teste precisa do mock com a implementação real por baixo (o vi.mock só vale no próprio arquivo):
 *   vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
 *     const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
 *     return { ...real, listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
 *   });
 */
export function varreduraSo(...alvos: (Pick<TenantDeTeste, 'tenantId' | 'tenant'> | { id: string; fuso: string })[]): void {
  if (!vi.isMockFunction(listarTenantsParaVarredura)) throw new Error('varreduraSo: falta o vi.mock de @/modules/plataforma/tenant-status no arquivo de teste');
  vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce(alvos.map((t) => ('tenantId' in t ? { id: t.tenantId, fuso: t.tenant.fuso } : t)));
}
