import { describe, expect, it } from 'vitest';
import type { AppointmentRow, NotificationRow, PatientRow, TenantRow } from '@/db/schema';
import { sealSecret } from '@/lib/crypto';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import type { ContextoEnvio } from './enviar';
import { FINALIDADE_CONTEUDO, textoWhatsapp } from './mensagens';

const deps = { appUrl: 'https://app.exemplo.com', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)) };
const tenant = { id: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', nomeExibicao: 'Debby Silva', fuso: 'America/Sao_Paulo', enderecoConsultorio: 'Rua das Flores, 10', cancelamentoMinH: 24 } as TenantRow;
const consulta = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', inicio: new Date('2026-10-16T17:00:00Z'), modalidade: 'presencial', linkOnline: null } as AppointmentRow;
const paciente = { nome: 'Ana Souza Lima', email: 'ana@ex.com' } as PatientRow;
const ctx = (tipo: string, extra: Partial<NotificationRow> = {}): ContextoEnvio => ({ n: { tipo, conteudoSelado: null, ...extra } as NotificationRow, paciente, consulta, tenant, agora: new Date('2026-10-15T17:00:00Z') });

describe('textos do WhatsApp (D3)', () => {
  it('lembrete de 24 h: quando com fuso, endereço, "1"/"2" e o link assinado', () => {
    const t = textoWhatsapp(ctx('lembrete_24h'), deps)!;
    expect(t).toContain('Olá, Ana! Lembrete da sua consulta com Debby Silva: sex., 16/10/2026 às 14:00 (horário de Brasília), presencial.');
    expect(t).toContain('Endereço: Rua das Flores, 10');
    expect(t).toContain('Responda 1 para confirmar ou 2 se precisar remarcar.');
    expect(t).toMatch(/Ou use o link: https:\/\/app\.exemplo\.com\/consulta\/[A-Za-z0-9_-]{71}$/);
  });
  it('lembrete de 2 h online: hoje, link da chamada e link da consulta', () => {
    const t = textoWhatsapp({ ...ctx('lembrete_2h'), consulta: { ...consulta, modalidade: 'online', linkOnline: 'https://meet.google.com/abc' } as AppointmentRow }, deps)!;
    expect(t).toContain('Olá, Ana! Sua consulta com Debby Silva é hoje às 14:00 (horário de Brasília).');
    expect(t).toContain('Link da chamada: https://meet.google.com/abc');
    expect(t).toContain('Se não puder ir, avise pelo link: https://app.exemplo.com/consulta/');
  });
  it('respostas a "1" e "2"; texto pronto e cifrado (convite) é aberto; tipo sem texto → null', () => {
    expect(textoWhatsapp(ctx('resposta_confirmacao'), deps)).toBe('Presença confirmada. Até lá!');
    expect(textoWhatsapp(ctx('resposta_remarcar'), deps)).toMatch(/^Tudo bem! Para escolher outro horário, use o link: https:\/\/app\.exemplo\.com\/consulta\/\S+\nSe faltarem menos de 24 h para a consulta, fale direto com Debby Silva\.$/);
    expect(textoWhatsapp(ctx('convite_paciente', { conteudoSelado: sealSecret('Convite pronto', FINALIDADE_CONTEUDO) }), deps)).toBe('Convite pronto');
    expect(textoWhatsapp(ctx('consulta_marcada'), deps)).toBeNull();
  });
});
