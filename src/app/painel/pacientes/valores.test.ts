import { describe, expect, it } from 'vitest';
import type { PatientRow } from '@/db/schema';
import { avisoDoConviteWhatsapp, seloDoPaciente, textoDoAcesso, textoDoConviteWhatsapp, valoresDoFormulario, valoresDoPaciente } from './valores';

const base = {
  id: 'p', tenantId: 't', userId: null, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', telefoneE164: '+5511912345678',
  email: 'ana@ex.com', origem: 'nutri', whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri', whatsappOptoutEm: null,
  iaRecusadaEm: null, iaAvisoVersao: null, iaAvisoEm: null, iaAvisoCanal: null, iaAvisoEnviadoEm: null, pesoOcultoNoAppEm: null, lembretesPausadosEm: null,
  status: 'ativo', bloqueadoEm: null, anonimizarApos: null, anonimizadoEm: null, createdAt: new Date(), updatedAt: new Date(),
} satisfies PatientRow;

describe('valores do cadastro', () => {
  it('lê o FormData (checkbox marcado = "on") e devolve o que foi digitado', () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ nome: ' Ana ', dataNascimento: '1991-03-10', sexo: 'F', email: 'A@EX.COM', telefone: '11 91234 5678', whatsappAutorizado: 'on' })) f.set(k, v);
    expect(valoresDoFormulario(f)).toEqual({ nome: ' Ana ', dataNascimento: '1991-03-10', sexo: 'F', email: 'A@EX.COM', telefone: '11 91234 5678', whatsappAutorizado: true, enviarConviteWhatsapp: false });
    expect(valoresDoFormulario(new FormData())).toEqual({ nome: '', dataNascimento: '', sexo: '', email: '', telefone: '', whatsappAutorizado: false, enviarConviteWhatsapp: false });
    f.set('enviarConviteWhatsapp', 'on');
    expect(valoresDoFormulario(f).enviarConviteWhatsapp).toBe(true);
  });
  it('preenche a edição a partir do paciente: telefone formatado; WhatsApp marcado só com opt-in sem opt-out', () => {
    expect(valoresDoPaciente(base)).toEqual({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: 'ana@ex.com', telefone: '(11) 91234-5678', whatsappAutorizado: true, enviarConviteWhatsapp: false });
    expect(valoresDoPaciente({ ...base, whatsappOptoutEm: new Date() }).whatsappAutorizado).toBe(false);
    expect(valoresDoPaciente({ ...base, telefoneE164: null, dataNascimento: null, sexo: null })).toMatchObject({ telefone: '', dataNascimento: '', sexo: '' });
  });
  it('selo: Arquivado, Bloqueado (pedido de exclusão), Completar cadastro', () => {
    expect(seloDoPaciente(base)).toBeNull();
    expect(seloDoPaciente({ ...base, status: 'arquivado' })).toBe('Arquivado');
    expect(seloDoPaciente({ ...base, status: 'bloqueado' })).toBe('Bloqueado (pedido de exclusão)');
    expect(seloDoPaciente({ ...base, origem: 'agendamento_publico', dataNascimento: null })).toBe('Completar cadastro');
  });
});

describe('textoDoAcesso', () => {
  it('descreve cada situação do convite, com a validade no fuso do tenant', () => {
    expect(textoDoAcesso({ estado: 'ativo' }, 'America/Sao_Paulo')).toBe('Ativo: o paciente já criou a senha.');
    expect(textoDoAcesso({ estado: 'pendente', expiraEm: new Date('2026-10-08T15:00:00Z') }, 'America/Sao_Paulo')).toBe(
      'Convite enviado por e-mail. Vale até 08/10/2026, 12:00.',
    );
    expect(textoDoAcesso({ estado: 'expirado' }, 'America/Sao_Paulo')).toBe('Convite expirado. Reenvie para o paciente conseguir entrar.');
    expect(textoDoAcesso({ estado: 'sem_convite' }, 'America/Sao_Paulo')).toBe('Nenhum convite pendente.');
  });
});

describe('textoDoConviteWhatsapp (US-010)', () => {
  const SP = 'America/Sao_Paulo';
  const n = { status: 'pendente', motivoIgnorada: null, agendadaPara: new Date('2026-10-14T13:00:00Z'), enviadaEm: null };
  it('"Convite por WhatsApp: {situação}" no fuso do tenant; sem convite por WhatsApp, nada', () => {
    expect(textoDoConviteWhatsapp(null, SP)).toBeNull();
    expect(textoDoConviteWhatsapp(n, SP)).toBe('Convite por WhatsApp: agendado para qua., 14/10/2026 às 10:00');
    expect(textoDoConviteWhatsapp({ ...n, status: 'enviada', enviadaEm: new Date('2026-10-14T13:00:20Z') }, SP)).toBe('Convite por WhatsApp: enviado em qua., 14/10/2026 às 10:00');
    expect(textoDoConviteWhatsapp({ ...n, status: 'lida' }, SP)).toBe('Convite por WhatsApp: lido');
    // rodada 1: sem "::" — "não enviado" vira parte da frase
    expect(textoDoConviteWhatsapp({ ...n, status: 'ignorada', motivoIgnorada: 'cota_esgotada' }, SP)).toBe('Convite por WhatsApp não enviado: cota de WhatsApp do mês esgotada');
    expect(textoDoConviteWhatsapp({ ...n, status: 'ignorada', motivoIgnorada: 'whatsapp_desconectado' }, SP)).toBe('Convite por WhatsApp não enviado: WhatsApp desconectado');
    expect(textoDoConviteWhatsapp({ ...n, status: 'ignorada', motivoIgnorada: 'convite_aceito' }, SP)).toBe('Convite por WhatsApp não enviado: convite já aceito');
    for (const st of ['pendente', 'enviada', 'lida', 'ignorada']) expect(textoDoConviteWhatsapp({ ...n, status: st, motivoIgnorada: st === 'ignorada' ? 'sem_optin' : null }, SP)).not.toContain('::');
  });
  it('aviso ao lado da opção: WhatsApp fora da plataforma ou consultório desconectado → o convite vai só por e-mail', () => {
    expect(avisoDoConviteWhatsapp({ ligado: false, estado: 'desconectada' })).toBe('O WhatsApp ainda não está disponível na plataforma; o convite vai só por e-mail.');
    expect(avisoDoConviteWhatsapp({ ligado: true, estado: 'desconectada' })).toBe('O WhatsApp do consultório não está conectado; o convite vai só por e-mail.');
    expect(avisoDoConviteWhatsapp({ ligado: true, estado: 'conectando' })).toBe('O WhatsApp do consultório não está conectado; o convite vai só por e-mail.');
    expect(avisoDoConviteWhatsapp({ ligado: true, estado: 'conectada' })).toBeNull();
  });
});
