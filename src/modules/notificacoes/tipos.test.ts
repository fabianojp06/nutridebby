import { describe, expect, it } from 'vitest';
import { situacaoDaNotificacao } from './tipos';

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
