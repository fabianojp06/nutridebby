import { describe, expect, it } from 'vitest';
import type { PatientRow } from '@/db/schema';
import { CADASTRO_VAZIO, CAMPOS_DO_CADASTRO } from '@/modules/pacientes/cadastro';
import { avisoDoConviteWhatsapp, entradaDoFormulario, rotuloDoAcessoNaLista, seloDoPaciente, textoDoAcesso, textoDoConviteWhatsapp, urlDaLista, valoresDoFormulario, valoresDoPaciente } from './valores';

const base = {
  id: 'p', tenantId: 't', userId: null, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', telefoneE164: '+5511912345678',
  email: 'ana@ex.com', origem: 'nutri', whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri', whatsappOptoutEm: null,
  iaRecusadaEm: null, iaAvisoVersao: null, iaAvisoEm: null, iaAvisoCanal: null, iaAvisoEnviadoEm: null, pesoOcultoNoAppEm: null, lembretesPausadosEm: null,
  status: 'ativo', bloqueadoEm: null, anonimizarApos: null, anonimizadoEm: null, createdAt: new Date(), updatedAt: new Date(),
} satisfies PatientRow;

/** Os campos do cadastro complementar vazios, como o formulário os mostra e manda. */
const cadastroVazio = Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, ''])) as Record<(typeof CAMPOS_DO_CADASTRO)[number], string>;

describe('valores do cadastro', () => {
  it('lê o FormData (checkbox marcado = "on") e devolve o que foi digitado', () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ nome: ' Ana ', dataNascimento: '1991-03-10', sexo: 'F', email: 'A@EX.COM', telefone: '11 91234 5678', whatsappAutorizado: 'on' })) f.set(k, v);
    expect(valoresDoFormulario(f)).toEqual({ nome: ' Ana ', dataNascimento: '1991-03-10', sexo: 'F', email: 'A@EX.COM', telefone: '11 91234 5678', whatsappAutorizado: true, enviarConviteWhatsapp: false, ...cadastroVazio });
    expect(valoresDoFormulario(new FormData())).toEqual({ nome: '', dataNascimento: '', sexo: '', email: '', telefone: '', whatsappAutorizado: false, enviarConviteWhatsapp: false, ...cadastroVazio });
    f.set('enviarConviteWhatsapp', 'on');
    expect(valoresDoFormulario(f).enviarConviteWhatsapp).toBe(true);
  });
  it('Plano 18: os campos do cadastro complementar voltam como digitados (nada se perde), com as quebras da observação', () => {
    const f = new FormData();
    const digitado = { cpf: '529.982.247-25', nomeSocial: 'Joana', estadoCivil: 'casado', cep: '13015-904', uf: 'SP', telefoneFixo: '(11) 3123-4567', observacao: 'linha 1\r\nlinha 2' };
    for (const [k, v] of Object.entries(digitado)) f.set(k, v);
    expect(valoresDoFormulario(f)).toMatchObject({ ...cadastroVazio, ...digitado });
  });
  it('Plano 18: a entrada da ação manda o campo vazio como \'\' e deixa de fora o que o FormData não trouxe (select desabilitado: mantém o gravado)', () => {
    const f = new FormData();
    for (const c of CAMPOS_DO_CADASTRO) f.set(c, '');
    f.set('ocupacao', 'Professora');
    f.delete('uf'); // select desabilitado não vai no FormData
    f.delete('estadoCivil');
    const e = entradaDoFormulario(f);
    expect(e).toMatchObject({ ocupacao: 'Professora', cpf: '', observacao: '' });
    expect('uf' in e).toBe(false);
    expect('estadoCivil' in e).toBe(false);
    // os campos de sempre continuam como hoje ('' quando faltam)
    expect(e).toMatchObject({ nome: '', email: '', whatsappAutorizado: false });
    expect(Object.keys(entradaDoFormulario(new FormData())).filter((k) => (CAMPOS_DO_CADASTRO as readonly string[]).includes(k))).toEqual([]);
  });
  it('preenche a edição a partir do paciente: telefone formatado; WhatsApp marcado só com opt-in sem opt-out', () => {
    expect(valoresDoPaciente(base)).toEqual({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: 'ana@ex.com', telefone: '(11) 91234-5678', whatsappAutorizado: true, enviarConviteWhatsapp: false, ...cadastroVazio });
    expect(valoresDoPaciente({ ...base, whatsappOptoutEm: new Date() }).whatsappAutorizado).toBe(false);
    expect(valoresDoPaciente({ ...base, telefoneE164: null, dataNascimento: null, sexo: null })).toMatchObject({ telefone: '', dataNascimento: '', sexo: '' });
  });
  it('Plano 18: preenche o cadastro complementar formatado (CPF, CEP e telefone fixo); sem cadastro, tudo vazio', () => {
    const cadastro = { ...CADASTRO_VAZIO, cpf: '52998224725', cep: '13015904', telefoneFixo: '+551131234567', nomeSocial: 'Joana Silva', uf: 'SP' as const, observacao: 'a\nb' };
    expect(valoresDoPaciente(base, cadastro)).toMatchObject({
      ...cadastroVazio,
      cpf: '529.982.247-25',
      cep: '13015-904',
      telefoneFixo: '(11) 3123-4567',
      nomeSocial: 'Joana Silva',
      uf: 'SP',
      observacao: 'a\nb',
    });
    expect(valoresDoPaciente(base, null)).toMatchObject(cadastroVazio);
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
    expect(textoDoAcesso({ estado: 'ativo' }, 'America/Sao_Paulo', 'ativo')).toBe('Ativo: o paciente já criou a senha.');
    expect(textoDoAcesso({ estado: 'pendente', expiraEm: new Date('2026-10-08T15:00:00Z') }, 'America/Sao_Paulo', 'ativo')).toBe(
      'Convite enviado por e-mail. Vale até 08/10/2026, 12:00.',
    );
    expect(textoDoAcesso({ estado: 'expirado' }, 'America/Sao_Paulo', 'ativo')).toBe('Convite expirado. Reenvie para o paciente conseguir entrar.');
    expect(textoDoAcesso({ estado: 'sem_convite' }, 'America/Sao_Paulo', 'ativo')).toBe('Nenhum convite pendente.');
  });
  it('Plano 18 (§8.1): a situação do paciente vence o acesso — arquivado e bloqueado ficam sem acesso, mesmo com a senha criada (userId)', () => {
    for (const s of [{ estado: 'ativo' } as const, { estado: 'pendente', expiraEm: new Date('2026-10-08T15:00:00Z') } as const, { estado: 'sem_convite' } as const]) {
      expect(textoDoAcesso(s, 'America/Sao_Paulo', 'arquivado')).toBe('Sem acesso (arquivado)');
      expect(textoDoAcesso(s, 'America/Sao_Paulo', 'bloqueado')).toBe('Sem acesso (bloqueado)');
    }
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

describe('rotuloDoAcessoNaLista (Plano 18, §8.1)', () => {
  const pendente = { estado: 'pendente', expiraEm: new Date('2026-11-20T15:00:00Z') } as const;
  it('rótulo curto de cada situação do convite', () => {
    expect(rotuloDoAcessoNaLista({ status: 'ativo', userId: 'u1', convite: { estado: 'ativo' } })).toBe('Ativo');
    expect(rotuloDoAcessoNaLista({ status: 'ativo', userId: null, convite: pendente })).toBe('Pendente');
    expect(rotuloDoAcessoNaLista({ status: 'ativo', userId: null, convite: { estado: 'expirado' } })).toBe('Expirado');
    expect(rotuloDoAcessoNaLista({ status: 'ativo', userId: null, convite: { estado: 'sem_convite' } })).toBe('Sem convite');
  });
  it('arquivado e bloqueado vencem o userId (já criou a senha) e o convite', () => {
    expect(rotuloDoAcessoNaLista({ status: 'arquivado', userId: 'u1', convite: { estado: 'ativo' } })).toBe('Sem acesso (arquivado)');
    expect(rotuloDoAcessoNaLista({ status: 'arquivado', userId: null, convite: pendente })).toBe('Sem acesso (arquivado)');
    expect(rotuloDoAcessoNaLista({ status: 'bloqueado', userId: 'u1', convite: { estado: 'ativo' } })).toBe('Sem acesso (bloqueado)');
    expect(rotuloDoAcessoNaLista({ status: 'bloqueado', userId: null, convite: { estado: 'sem_convite' } })).toBe('Sem acesso (bloqueado)');
  });
  it('com a senha criada, "Ativo" mesmo sem a situação do convite dizer', () => {
    expect(rotuloDoAcessoNaLista({ status: 'ativo', userId: 'u1', convite: { estado: 'sem_convite' } })).toBe('Ativo');
  });
});

describe('urlDaLista (RN-270)', () => {
  const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);
  it('sempre /painel/pacientes; aba, busca, etiqueta e ordem (a padrão "nome" fica de fora); ok por último', () => {
    expect(urlDaLista({ aba: 'ativos', ordem: 'nome' })).toBe('/painel/pacientes?aba=ativos');
    const u = urlDaLista({ aba: 'todos', busca: 'ana & bia', etiquetaId: 'e1', ordem: 'recentes' }, { ok: 'arquivado' });
    expect(u.startsWith('/painel/pacientes?')).toBe(true);
    expect(params(u)).toEqual({ aba: 'todos', busca: 'ana & bia', etiqueta: 'e1', ordem: 'recentes', ok: 'arquivado' });
    expect(u.endsWith('&ok=arquivado')).toBe(true);
  });
  it('bloqueados vai em situacao=bloqueados (sem aba); "registro" nunca vai para a URL', () => {
    expect(params(urlDaLista({ aba: 'bloqueados', busca: 'x', ordem: 'antigos' }))).toEqual({ situacao: 'bloqueados', busca: 'x', ordem: 'antigos' });
    expect(params(urlDaLista({ aba: 'inativos', ordem: 'registro' }))).toEqual({ aba: 'inativos' });
    expect(urlDaLista({})).toBe('/painel/pacientes?aba=ativos');
  });
  it('o marcador r (D26) vai depois do ok, e só com ok', () => {
    expect(urlDaLista({ aba: 'ativos' }, { ok: 'arquivado', r: '0a1b2c3d' })).toBe('/painel/pacientes?aba=ativos&ok=arquivado&r=0a1b2c3d');
    expect(urlDaLista({ aba: 'ativos' }, { r: '0a1b2c3d' })).toBe('/painel/pacientes?aba=ativos');
  });
  it('busca com espaços nas pontas some quando vazia', () => {
    expect(params(urlDaLista({ aba: 'ativos', busca: '   ' }))).toEqual({ aba: 'ativos' });
  });
});
