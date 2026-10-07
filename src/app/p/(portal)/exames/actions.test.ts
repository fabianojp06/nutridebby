import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';

// Só a ação: sessão, módulo (o cancelamento de verdade é testado em src/modules/portal/exames-enviados.test.ts) e cache simulados.
const estado = vi.hoisted(() => ({ revalidados: [] as string[], falha: null as unknown }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => void estado.revalidados.push(p) }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {} }) }));
vi.mock('@/modules/portal/exames-enviados', async () => {
  const { EnvioError } = await vi.importActual<typeof import('@/modules/portal/exames-enviados')>('@/modules/portal/exames-enviados');
  return {
    EnvioError,
    cancelarMeuEnvio: vi.fn(async () => {
      if (estado.falha) throw estado.falha;
    }),
  };
});
const { cancelarEnvioAction } = await import('./actions');
const { EnvioError } = await import('@/modules/portal/exames-enviados');
const ID = '00000000-0000-4000-8000-0000000000e1';
const cancelar = () => cancelarEnvioAction(ID, {}, new FormData());

describe('cancelarEnvioAction (US-161)', () => {
  beforeEach(() => {
    estado.revalidados = [];
    estado.falha = null;
  });

  it('cancelado: a lista é refeita', async () => {
    expect(await cancelar()).toEqual({});
    expect(estado.revalidados).toEqual(['/p/exames']);
  });

  it('ainda processando: "Aguarde o processamento terminar."', async () => {
    estado.falha = new EnvioError(409, { geral: MSG_ENVIO.aguarde });
    expect(await cancelar()).toEqual({ erro: MSG_ENVIO.aguarde });
  });

  it('já não está aguardando (cancelado em outra aba, revisado, expirado): sem erro em branco; a lista é refeita com a situação atual', async () => {
    estado.falha = new EnvioError(404, {});
    expect(await cancelar()).toEqual({});
    expect(estado.revalidados).toEqual(['/p/exames']);
  });

  it('erro inesperado sobe (vai para a página de erro)', async () => {
    estado.falha = new Error('banco fora');
    await expect(cancelar()).rejects.toThrow('banco fora');
  });
});
