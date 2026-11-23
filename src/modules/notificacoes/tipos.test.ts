import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ROTULO_TIPO, situacaoDaNotificacao, TIPOS_DA_AGENDA, TIPOS_FORA_DA_RECEPCAO } from './tipos';

const SP = 'America/Sao_Paulo';
const base = { agendadaPara: new Date('2026-10-15T17:00:00Z'), enviadaEm: null, motivoIgnorada: null };

describe('situação do lembrete em texto', () => {
  it('agendado, enviado, entregue, lido, falhou e os motivos de não envio', () => {
    expect(situacaoDaNotificacao({ ...base, status: 'pendente' }, SP)).toBe('Agendado para qui., 15/10/2026 às 14:00');
    expect(situacaoDaNotificacao({ ...base, status: 'enviada', enviadaEm: new Date('2026-10-15T17:00:30Z') }, SP)).toBe('Enviado em qui., 15/10/2026 às 14:00');
    expect(situacaoDaNotificacao({ ...base, status: 'lida' }, SP)).toBe('Lido');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'horario_silencioso' }, SP)).toBe('Não enviado: horário silencioso (21h–8h)');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'cota_esgotada' }, SP)).toBe('Não enviado: cota de WhatsApp do mês esgotada');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'consulta_remarcada' }, SP)).toBe('Não enviado: consulta remarcada');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'convite_aceito' }, SP)).toBe('Não enviado: convite já aceito');
  });
});

describe('ROTULO_TIPO (W-1)', () => {
  it('tem rótulo para todo tipo do CHECK de notifications', () => {
    for (const t of ['lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado', 'duvida_vista'])
      expect(ROTULO_TIPO[t as keyof typeof ROTULO_TIPO], t).toBeTruthy();
  });
});

/**
 * Plano 26 (RN-507, RE-D57): todo tipo do CHECK de notifications tem decisão para a recepção — está em TIPOS_DA_AGENDA (a
 * condição recepcao_cond_notificacoes_da_agenda deixa ler e gravar) ou em TIPOS_FORA_DA_RECEPCAO. Tipo novo de outro plano sem
 * decisão quebra aqui, em vez de ficar calado dentro ou fora.
 */
describe('tipos da agenda × política × CHECK (Plano 26, RN-507)', () => {
  const owner = makeDb(inject('ownerDatabaseUrl'));
  afterAll(() => owner.pool.end());
  const literais = (expr: string | null) => [...(expr ?? '').matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]).filter((t) => t !== 'recepcao');

  it('TIPOS_DA_AGENDA = a lista da política (USING e WITH CHECK) e ⊂ CHECK; agenda + fora = o CHECK inteiro, sem repetição', async () => {
    const { rows: pol } = await owner.pool.query<{ qual: string; with_check: string }>(
      `select qual, with_check from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'recepcao_cond_notificacoes_da_agenda'`,
    );
    expect(pol).toHaveLength(1);
    expect(literais(pol[0].qual).sort()).toEqual([...TIPOS_DA_AGENDA].sort());
    expect(literais(pol[0].with_check).sort()).toEqual([...TIPOS_DA_AGENDA].sort());
    const { rows: chk } = await owner.pool.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_tipo_valido'`,
    );
    const doCheck = literais(chk[0].def).sort();
    expect(doCheck.length).toBeGreaterThan(0);
    for (const t of TIPOS_DA_AGENDA) expect(doCheck, t).toContain(t);
    expect([...TIPOS_DA_AGENDA, ...TIPOS_FORA_DA_RECEPCAO].sort()).toEqual(doCheck);
    expect(TIPOS_FORA_DA_RECEPCAO).toContain('convite_paciente'); // a recepção não envia convite (RE-D37)
  });
});
