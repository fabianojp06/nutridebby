import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppointmentRow, NotificationRow, PatientRow, TenantRow } from '@/db/schema';
import { sealSecret } from '@/lib/crypto';
import { chaveDosLinks, lerLinkConsulta } from '@/modules/agenda/link-consulta';
import type { ContextoEnvio } from './enviar';
import { dadosDaConsulta, emailDaNotificacao, emailMascarado, FINALIDADE_CONTEUDO, primeiroNome, pushDaNotificacao, textoConviteWhatsapp, textoWhatsapp } from './mensagens';

const deps = { appUrl: 'https://app.exemplo.com', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)) };
const tenant = { id: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', nomeExibicao: 'Debby Silva', fuso: 'America/Sao_Paulo', enderecoConsultorio: 'Rua das Flores, 10', cancelamentoMinH: 24 } as TenantRow;
const consulta = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', inicio: new Date('2026-10-16T17:00:00Z'), modalidade: 'presencial', linkOnline: null } as AppointmentRow;
const paciente = { nome: 'Ana Souza Lima', email: 'ana@ex.com' } as PatientRow;
const ctx = (tipo: string, extra: Partial<NotificationRow> = {}): ContextoEnvio => ({ n: { tipo, conteudoSelado: null, ...extra } as NotificationRow, paciente, consulta, tenant, agora: new Date('2026-10-15T17:00:00Z') });

const online = (c: ContextoEnvio): ContextoEnvio => ({ ...c, consulta: { ...consulta, modalidade: 'online', linkOnline: 'https://meet.google.com/abc' } as AppointmentRow });
/** Nada de endereço de acesso no WhatsApp (decisão do dono, fechamento): nem o link assinado da consulta, nem o da chamada. */
const SEM_URL = /https?:|\/consulta\/|meet\.google|www\./;

describe('textos do WhatsApp (D3; decisão do dono no fechamento: sem link — o número nunca foi verificado)', () => {
  it('lembrete de 24 h: quando com fuso, modalidade, endereço e "1"/"2" — sem link', () => {
    expect(textoWhatsapp(ctx('lembrete_24h'))).toBe(
      'Olá, Ana! Lembrete da sua consulta com Debby Silva: sex., 16/10/2026 às 14:00 (horário de Brasília), presencial.\nEndereço: Rua das Flores, 10\n\nResponda 1 para confirmar ou 2 se precisar remarcar.',
    );
  });
  it('online: o link da chamada fica no e-mail (mascarado no texto)', () => {
    expect(textoWhatsapp(online(ctx('lembrete_24h')))).toBe(
      'Olá, Ana! Lembrete da sua consulta com Debby Silva: sex., 16/10/2026 às 14:00 (horário de Brasília), online.\nO link da chamada foi enviado para o seu e-mail a***@ex.com.\n\nResponda 1 para confirmar ou 2 se precisar remarcar.',
    );
    expect(textoWhatsapp(online(ctx('lembrete_2h')))).toBe(
      'Olá, Ana! Sua consulta com Debby Silva é hoje às 14:00 (horário de Brasília), online.\nO link da chamada foi enviado para o seu e-mail a***@ex.com.\n\nResponda 1 para confirmar ou 2 se precisar remarcar.',
    );
  });
  it('lembrete de 2 h: hoje, modalidade, endereço e "1"/"2" — sem link', () => {
    expect(textoWhatsapp(ctx('lembrete_2h'))).toBe('Olá, Ana! Sua consulta com Debby Silva é hoje às 14:00 (horário de Brasília), presencial.\nEndereço: Rua das Flores, 10\n\nResponda 1 para confirmar ou 2 se precisar remarcar.');
    expect(textoWhatsapp({ ...ctx('lembrete_2h'), tenant: { ...tenant, enderecoConsultorio: null } as TenantRow })).toBe('Olá, Ana! Sua consulta com Debby Silva é hoje às 14:00 (horário de Brasília), presencial.\n\nResponda 1 para confirmar ou 2 se precisar remarcar.');
  });
  it('respostas a "1" e "2" ("2": um e-mail novo leva o link para remarcar, mascarado no texto); texto pronto e cifrado (convite) é aberto; tipo sem texto → null', () => {
    expect(textoWhatsapp(ctx('resposta_confirmacao'))).toBe('Presença confirmada. Até lá!');
    expect(textoWhatsapp(ctx('resposta_remarcar'))).toBe('Tudo bem! Enviamos o link para remarcar para o seu e-mail a***@ex.com.\nSe faltarem menos de 24 h para a consulta, fale direto com Debby Silva.');
    expect(textoWhatsapp(ctx('convite_paciente', { conteudoSelado: sealSecret('Convite pronto', FINALIDADE_CONTEUDO) }))).toBe('Convite pronto');
    expect(textoWhatsapp(ctx('consulta_marcada'))).toBeNull();
  });
  it('nenhum texto do WhatsApp leva URL (link da consulta ou da chamada), presencial ou online', () => {
    for (const tipo of ['lembrete_24h', 'lembrete_2h', 'resposta_confirmacao', 'resposta_remarcar', 'convite_paciente']) {
      for (const c of [ctx(tipo), online(ctx(tipo))]) expect(textoWhatsapp(c) ?? '', tipo).not.toMatch(SEM_URL);
    }
  });
});

describe('e-mail da consulta (o link fica aqui)', () => {
  it('lembretes e marcação levam o link assinado (que confere com o e-mail atual do paciente) e o link da chamada; cancelamento, sem link', async () => {
    for (const tipo of ['lembrete_24h', 'lembrete_2h', 'consulta_marcada']) {
      const m = emailDaNotificacao(online(ctx(tipo)), deps)!;
      expect(m, tipo).toMatchObject({ tipo: 'consulta', para: 'ana@ex.com', modalidade: 'online', local: 'https://meet.google.com/abc' });
      const token = /^https:\/\/app\.exemplo\.com\/consulta\/([A-Za-z0-9_-]{71})$/.exec(m.tipo === 'consulta' ? (m.link ?? '') : '')![1];
      expect(await lerLinkConsulta(token, deps.chaveLinks, new Date('2026-10-15T00:00:00Z'), async () => ({ email: 'ana@ex.com' }))).not.toBeNull();
      expect(await lerLinkConsulta(token, deps.chaveLinks, new Date('2026-10-15T00:00:00Z'), async () => ({ email: 'outra@ex.com' }))).toBeNull();
    }
    expect(emailDaNotificacao(ctx('consulta_cancelada'), deps)).toMatchObject({ link: null });
  });
  it('"2" no WhatsApp (US-035): e-mail novo ao e-mail ATUAL do paciente, com o link assinado atual e o prazo do consultório', async () => {
    const corrigido = { ...ctx('resposta_remarcar'), paciente: { ...paciente, email: 'ana.nova@ex.com' } as PatientRow };
    const m = emailDaNotificacao(corrigido, deps)!;
    expect(m).toMatchObject({ tipo: 'consulta', evento: 'resposta_remarcar', para: 'ana.nova@ex.com', nome: 'Ana', nutri: 'Debby Silva', prazoH: 24 });
    const token = /^https:\/\/app\.exemplo\.com\/consulta\/([A-Za-z0-9_-]{71})$/.exec(m.tipo === 'consulta' ? (m.link ?? '') : '')![1];
    expect(await lerLinkConsulta(token, deps.chaveLinks, new Date('2026-10-15T00:00:00Z'), async () => ({ email: 'ana.nova@ex.com' }))).not.toBeNull();
    expect(await lerLinkConsulta(token, deps.chaveLinks, new Date('2026-10-15T00:00:00Z'), async () => ({ email: 'ana@ex.com' }))).toBeNull();
    expect(emailDaNotificacao(ctx('resposta_confirmacao'), deps)).toBeNull(); // "1": só a resposta no WhatsApp
  });
});

describe('convite por WhatsApp (US-010; decisão do dono na rodada 1: só aviso, sem link)', () => {
  it('e-mail mascarado: primeira letra + "***" + "@" + domínio', () => {
    expect(emailMascarado('ana.souza@ex.com')).toBe('a***@ex.com');
    expect(emailMascarado('b@novo.com.br')).toBe('b***@novo.com.br');
    expect(emailMascarado('sem-arroba')).toBe('***');
    expect(emailMascarado('@ex.com')).toBe('***');
  });
  it('um texto só (conta nova ou existente), sem link nem token, com o e-mail mascarado', () => {
    const t = textoConviteWhatsapp({ nome: ' Ana Souza Lima', nutri: 'Debby Silva', email: 'ana@ex.com' });
    expect(t).toBe('Olá, Ana! Debby Silva convidou você para o NutriDebby. Enviamos o convite para o seu e-mail a***@ex.com (vale por 7 dias).');
    expect(t).not.toMatch(/https?:|\/convite\//);
  });
  it('no envio, o texto sai do paciente e do consultório atuais (sem consulta, sem texto guardado)', () => {
    const esperado = 'Olá, Ana! Debby Silva convidou você para o NutriDebby. Enviamos o convite para o seu e-mail a***@ex.com (vale por 7 dias).';
    expect(textoWhatsapp({ ...ctx('convite_paciente'), consulta: null })).toBe(esperado);
    expect(textoWhatsapp({ ...ctx('convite_paciente'), consulta: null, paciente: { ...paciente, email: 'bia@novo.com' } as PatientRow })).toBe(esperado.replace('a***@ex.com', 'b***@novo.com'));
  });
});

describe('texto do push (D19: sem dado de saúde; fechamento: neutro, sem o nome da nutricionista na tela de bloqueio)', () => {
  const link = /^https:\/\/app\.exemplo\.com\/consulta\/[A-Za-z0-9_-]{71}$/;
  it('lembretes: só o horário; o toque abre o link da consulta', () => {
    expect(pushDaNotificacao(ctx('lembrete_24h'), deps)).toEqual({ titulo: 'Lembrete de consulta', corpo: 'Você tem uma consulta amanhã às 14:00.', url: expect.stringMatching(link) });
    // D7: o de 24 h adiado para as 08:00 do dia da consulta diz "hoje"
    expect(pushDaNotificacao({ ...ctx('lembrete_24h'), agora: new Date('2026-10-16T11:00:00Z') }, deps)).toEqual({ titulo: 'Lembrete de consulta', corpo: 'Sua consulta é hoje às 14:00.', url: expect.stringMatching(link) });
    expect(pushDaNotificacao(ctx('lembrete_2h'), deps)).toEqual({ titulo: 'Lembrete de consulta', corpo: 'Sua consulta é hoje às 14:00.', url: expect.stringMatching(link) });
  });
  it('marcação e cancelamento (este sem link); tipo sem push ou sem consulta → null', () => {
    expect(pushDaNotificacao(ctx('consulta_marcada'), deps)).toEqual({ titulo: 'Consulta marcada', corpo: 'Sua consulta foi marcada para sex., 16/10/2026 às 14:00 (horário de Brasília).', url: expect.stringMatching(link) });
    expect(pushDaNotificacao(ctx('consulta_cancelada'), deps)).toEqual({ titulo: 'Consulta cancelada', corpo: 'Sua consulta de sex., 16/10/2026 às 14:00 (horário de Brasília) foi cancelada.', url: null });
    expect(pushDaNotificacao(ctx('resposta_confirmacao'), deps)).toBeNull();
    expect(pushDaNotificacao(ctx('convite_paciente'), deps)).toBeNull();
    expect(pushDaNotificacao({ ...ctx('lembrete_24h'), consulta: null }, deps)).toBeNull();
  });
  it('push sem consulta: teste, comentário e plano novo — textos neutros, toque abre a tela do portal NO consultório do aviso (?v=, D7, D8, US-025)', () => {
    const semConsulta = (tipo: string): ContextoEnvio => ({ ...ctx(tipo), consulta: null });
    expect(pushDaNotificacao(semConsulta('push_teste'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Notificações ativadas ✅', url: `https://app.exemplo.com/p/inicio?v=${tenant.id}` });
    expect(pushDaNotificacao(semConsulta('comentario_diario'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Sua nutricionista comentou seu diário', url: `https://app.exemplo.com/p/diario?v=${tenant.id}` });
    expect(pushDaNotificacao(semConsulta('plano_novo'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Seu novo plano alimentar está disponível', url: `https://app.exemplo.com/p/plano?v=${tenant.id}` });
    expect(pushDaNotificacao(semConsulta('conteudo_novo'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Sua nutricionista publicou um novo conteúdo', url: `https://app.exemplo.com/p/conteudos?v=${tenant.id}` });
    // US-145 / RN-152: o documento novo, sem dizer o tipo
    expect(pushDaNotificacao(semConsulta('documento_novo'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Você tem um novo documento.', url: `https://app.exemplo.com/p/documentos?v=${tenant.id}` });
    // US-149 / D11: o cancelamento, também sem dizer o tipo nem o motivo
    expect(pushDaNotificacao(semConsulta('documento_atualizado'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Um documento seu foi atualizado.', url: `https://app.exemplo.com/p/documentos?v=${tenant.id}` });
    expect(pushDaNotificacao(semConsulta('toString'), deps)).toBeNull();
    for (const tipo of ['push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado']) {
      const corpo = pushDaNotificacao(semConsulta(tipo), deps)!.corpo; // o título é o nome do app ("NutriDebby")
      for (const dado of ['Ana', 'Souza', 'Debby', 'Silva']) expect(corpo, dado).not.toContain(dado);
    }
  });
  it('Plano 12 (C-05): exame revisado e expirado — o mesmo texto neutro, sem "exame"; o toque abre /p/exames do consultório', () => {
    const semConsulta = (tipo: string): ContextoEnvio => ({ ...ctx(tipo), consulta: null });
    for (const tipo of ['exame_revisado', 'exame_expirado']) {
      const p = pushDaNotificacao(semConsulta(tipo), deps)!;
      expect(p).toEqual({ titulo: 'NutriDebby', corpo: 'Há uma atualização para você no app.', url: `https://app.exemplo.com/p/exames?v=${tenant.id}` });
      expect(p.corpo.toLowerCase()).not.toContain('exame');
      for (const dado of ['Ana', 'Souza', 'Debby', 'Silva']) expect(p.corpo, dado).not.toContain(dado);
    }
  });
  it('Plano 15 (D24 = b, RNF-166): a dúvida vista — o mesmo texto neutro, sem "IA", "dúvida" nem "nutricionista"; o toque abre /p/plano/ia do consultório', () => {
    const p = pushDaNotificacao({ ...ctx('duvida_vista'), consulta: null }, deps)!;
    expect(p).toEqual({ titulo: 'NutriDebby', corpo: 'Há uma atualização para você no app.', url: `https://app.exemplo.com/p/plano/ia?v=${tenant.id}` });
    for (const proibido of [/\bIA\b/, /d[úu]vida/i, /nutricionista/i, /nutri\b/i]) expect(JSON.stringify({ titulo: p.titulo, corpo: p.corpo }), String(proibido)).not.toMatch(proibido);
    for (const dado of ['Ana', 'Souza', 'Debby', 'Silva']) expect(p.corpo, dado).not.toContain(dado);
  });
  it('nada do paciente, da nutricionista nem da consulta além do horário (nome, endereço, modalidade, link da chamada)', () => {
    for (const c of [ctx('lembrete_24h'), ctx('lembrete_2h'), ctx('consulta_marcada'), ctx('consulta_cancelada'), online(ctx('lembrete_24h'))]) {
      const p = pushDaNotificacao(c, deps)!;
      const texto = JSON.stringify({ titulo: p.titulo, corpo: p.corpo });
      for (const dado of ['Ana', 'Souza', 'Debby', 'Silva', 'Rua das Flores', 'presencial', 'online', 'meet.google.com']) expect(texto, dado).not.toContain(dado);
    }
  });
});

describe('Plano 23 (T4): o local da consulta nas mensagens (US-402, RN-406, RN-407; push sem local, D19)', () => {
  const CENTRO = { nome: 'Clínica Centro', tipo: 'presencial' as const, endereco: 'Av. Central, 500' };
  const noCentro = (c: ContextoEnvio): ContextoEnvio => ({ ...c, consulta: { ...c.consulta!, localId: '7d3f6a2e-1c4b-4e8a-9b0d-2f6e8c1a5b3d' } as AppointmentRow, local: CENTRO });

  it('lembrete por e-mail e WhatsApp com o endereço de "Clínica Centro" (não o do Perfil); o WhatsApp não leva o nome do local', () => {
    for (const tipo of ['lembrete_24h', 'lembrete_2h', 'consulta_marcada']) {
      expect(emailDaNotificacao(noCentro(ctx(tipo)), deps), tipo).toMatchObject({ modalidade: 'presencial', local: 'Av. Central, 500' });
    }
    for (const tipo of ['lembrete_24h', 'lembrete_2h']) {
      const w = textoWhatsapp(noCentro(ctx(tipo)))!;
      expect(w, tipo).toContain('Endereço: Av. Central, 500');
      expect(w, tipo).not.toContain('Rua das Flores');
      expect(w, tipo).not.toContain('Clínica Centro');
    }
  });

  it('consulta sem local (antiga) → endereço do Perfil; local presencial sem endereço → nenhum endereço (nunca o do Perfil no lugar do local)', () => {
    expect(dadosDaConsulta({ consulta, tenant }).local).toBe('Rua das Flores, 10');
    expect(dadosDaConsulta({ consulta, tenant, local: null }).local).toBe('Rua das Flores, 10');
    const semEndereco = noCentro(ctx('lembrete_24h'));
    semEndereco.local = { ...CENTRO, endereco: null };
    expect(emailDaNotificacao(semEndereco, deps)).toMatchObject({ local: null });
    expect(textoWhatsapp(semEndereco)).not.toContain('Endereço:');
  });

  it('online num local: o e-mail leva o link da própria consulta (a sala copiada), nunca outro; o WhatsApp não leva link', () => {
    const c: ContextoEnvio = { ...online(ctx('lembrete_24h')), local: { nome: 'Videoconferência', tipo: 'online', endereco: null } };
    expect(emailDaNotificacao(c, deps)).toMatchObject({ modalidade: 'online', local: 'https://meet.google.com/abc' });
    expect(textoWhatsapp(c)).not.toMatch(SEM_URL);
    expect(textoWhatsapp(c)).not.toContain('Videoconferência');
  });

  it('push só com o horário: nem nome nem endereço do local', () => {
    for (const tipo of ['lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada']) {
      const p = pushDaNotificacao(noCentro(ctx(tipo)), deps)!;
      const texto = JSON.stringify({ titulo: p.titulo, corpo: p.corpo });
      for (const dado of ['Clínica Centro', 'Av. Central', 'Rua das Flores', 'presencial']) expect(texto, `${tipo} ${dado}`).not.toContain(dado);
    }
  });
});

describe('primeiroNome (R11: um lugar só)', () => {
  it('primeira palavra, sem espaços em volta; nome vazio fica como veio', () => {
    expect(primeiroNome('  Ana   Souza Lima ')).toBe('Ana');
    expect(primeiroNome('   ')).toBe('   ');
  });
  it('nenhum outro arquivo de src/ recorta o primeiro nome por conta própria', () => {
    const fontes = readdirSync(path.resolve('src'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => path.join(d.parentPath, d.name));
    const comCopia = fontes.filter((f) => /\.split\(\/\\s\+\/\)\[0\]/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(path.resolve('src'), f));
    expect(comCopia).toEqual([path.join('modules', 'notificacoes', 'mensagens.ts')]);
  });
});
