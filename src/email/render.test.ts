import { describe, expect, it } from 'vitest';
import { renderEmail } from './templates';

describe('modelos de e-mail (INT-02)', () => {
  it('convite da nutricionista: assunto, nome, link no botão e no texto, validade de 72 h', () => {
    const link = 'https://app.exemplo.com/convite/tok123';
    const r = renderEmail({ tipo: 'convite_nutri', para: 'debby@exemplo.com', nome: 'Debby Silva', link });
    expect(r.subject).toBe('Seu acesso ao NutriDebby');
    expect(r.html.startsWith('<!doctype html>')).toBe(true);
    expect(r.html).toContain('Olá, Debby Silva!');
    expect(r.html).toContain(`href="${link}"`);
    expect(r.html).toContain('72 horas');
    expect(r.text).toContain(link);
    expect(r.text).toContain('72 horas');
  });
  it('redefinição de senha: 1 hora e uso único', () => {
    const r = renderEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'https://x.dev/r/1' });
    expect(r.subject).toBe('Redefinição de senha');
    expect(r.text).toContain('1 hora');
    expect(r.text).toContain('só pode ser usado uma vez');
  });
  it('escapa HTML vindo de dados', () => {
    const r = renderEmail({ tipo: 'convite_nutri', para: 'x@y.dev', nome: 'Ana <script>alert(1)</script>', link: 'https://x.dev/c/1' });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
  });
  it('alertas do admin', () => {
    expect(renderEmail({ tipo: 'alerta_disco', para: 'a@b.dev', percentual: 71, painelUrl: 'https://x.dev/admin' }).subject).toBe(
      'Alerta: disco da VPS em 71%',
    );
    const b = renderEmail({ tipo: 'alerta_backup', para: 'a@b.dev', detalhe: 'banco sem backup desde 01/10/2026', painelUrl: 'https://x.dev/admin' });
    expect(b.subject).toBe('Alerta: backup diário não concluído');
    expect(b.text).toContain('banco sem backup desde 01/10/2026');
  });
});

describe('convite_paciente (US-010)', () => {
  const base = { tipo: 'convite_paciente' as const, para: 'ana@ex.com', nome: 'Ana Souza', nutri: 'Debby Silva', link: 'http://localhost:3000/convite/paciente/abc' };
  it('conta nova: criar a senha, 7 dias, uso único, link no texto e no botão', () => {
    const r = renderEmail({ ...base, contaExistente: false });
    expect(r.subject).toBe('Convite de Debby Silva no NutriDebby');
    for (const t of ['Olá, Ana Souza!', 'Debby Silva convidou você para acompanhar seu tratamento pelo NutriDebby.', 'O link vale por 7 dias e só pode ser usado uma vez.', base.link]) {
      expect(r.text).toContain(t);
    }
    expect(r.html).toContain('Criar minha senha');
    expect(r.html).toContain(`href="${base.link}"`);
  });
  it('quem já tem conta: "Entre com sua conta existente para ver os dados da nutricionista <A>"', () => {
    const r = renderEmail({ ...base, contaExistente: true });
    expect(r.text).toContain('Entre com sua conta existente para ver os dados da nutricionista Debby Silva.');
    expect(r.html).toContain('Entrar e aceitar o convite');
  });
});

describe('exclusao_atendida (US-018)', () => {
  it('explica o que foi apagado e o que fica guardado por obrigação legal, com a data da anonimização', () => {
    const r = renderEmail({ tipo: 'exclusao_atendida', para: 'ana@ex.com', nome: 'Ana Souza', nutri: 'Debby Silva', anonimizarApos: '15/09/2046' });
    expect(r.subject).toBe('Seu pedido de exclusão de dados foi atendido');
    for (const t of ['Debby Silva atendeu o seu pedido de exclusão de dados', 'Foram apagados agora', 'LGPD, art. 16, I', 'até 15/09/2046']) expect(r.text).toContain(t);
    // Plano 06: o que o atendimento apaga e encerra também está no aviso ao titular
    for (const t of ['as fotos do diário alimentar', 'as notificações no aparelho', 'Suas consultas futuras foram canceladas', 'não tem mais acesso ao portal deste acompanhamento'])
      expect(r.text).toContain(t);
  });
});

describe('exportacao_pronta (US-018)', () => {
  it('link de 24 h, sem nenhum dado do paciente', () => {
    const r = renderEmail({ tipo: 'exportacao_pronta', para: 'debby@ex.com', link: 'http://localhost:3000/painel/pacientes/p/exportacoes/e' });
    expect(r.subject).toBe('Exportação de dados pronta');
    expect(r.text).toContain('24 horas');
    expect(r.html).toContain('href="http://localhost:3000/painel/pacientes/p/exportacoes/e"');
    expect(r.text).toContain('pede que você entre no painel');
  });

  it('US-046: pedida pelo titular, o link pede que ele entre no portal', () => {
    const r = renderEmail({ tipo: 'exportacao_pronta', para: 'ana@ex.com', link: 'http://localhost:3000/p/meus-dados/exportacoes/e', titular: true });
    expect(r.subject).toBe('Exportação de dados pronta');
    expect(r.text).toContain('O link vale por 24 horas e pede que você entre no portal.');
    expect(r.text).not.toContain('painel');
    expect(r.html).toContain('href="http://localhost:3000/p/meus-dados/exportacoes/e"');
  });
});

describe('pedido_exclusao_registrado (US-046)', () => {
  it('assunto da spec, nome da nutricionista, prazo de resposta e o que fica guardado', () => {
    const r = renderEmail({ tipo: 'pedido_exclusao_registrado', para: 'ana@ex.com', nutri: 'Debby Silva', prazo: '20/10/2026' });
    expect(r.subject).toBe('Seu pedido foi registrado');
    expect(r.text).toContain('Recebemos seu pedido de exclusão de dados. Debby Silva tem até 20/10/2026 para responder.');
    expect(r.text).toContain('o prontuário clínico é guardado de forma bloqueada pelo prazo exigido');
    expect(r.html).toContain('Debby Silva tem até 20/10/2026 para responder.');
  });
});

describe('plano_novo (US-025)', () => {
  it('assunto da spec, link para "Meu plano", nenhum dado do plano', () => {
    const r = renderEmail({ tipo: 'plano_novo', para: 'ana@ex.com', link: 'http://localhost:3000/p/plano' });
    expect(r.subject).toBe('Seu novo plano alimentar está disponível');
    expect(r.html).toContain('href="http://localhost:3000/p/plano"');
    expect(r.html).toContain('Ver meu plano');
    expect(r.text).toContain('http://localhost:3000/p/plano');
  });
});

describe('documento_novo e documento_link (US-145, RN-152, RN-158)', () => {
  it('neutros: primeiro nome e consultório, sem tipo de documento, item ou produto; o link no botão e no texto', () => {
    const novo = renderEmail({ tipo: 'documento_novo', para: 'ana@ex.com', nome: 'Ana', consultorio: 'Consultório Debby', link: 'https://x.dev/p/documentos?v=t' });
    expect(novo.subject).toBe('Você tem um novo documento');
    expect(novo.text).toContain('Olá, Ana. Consultório Debby disponibilizou um novo documento para você. Para ver, entre no app: https://x.dev/p/documentos?v=t');
    expect(novo.html).toContain('href="https://x.dev/p/documentos?v=t"');
    expect(novo.html).toContain('Ver meus documentos');
    const link = renderEmail({ tipo: 'documento_link', para: 'bia@ex.com', nome: 'Bia', consultorio: 'Consultório Debby', link: 'https://x.dev/documento/tok' });
    expect(link.subject).toBe('Você tem um novo documento');
    expect(link.text).toContain('Olá, Bia. Consultório Debby disponibilizou um novo documento para você.');
    expect(link.text).toContain('Para abrir, use o link abaixo. Vamos enviar um código de 6 dígitos para este e-mail. O link vale por 30 dias.');
    expect(link.html).toContain('href="https://x.dev/documento/tok"');
    expect(link.html).toContain('Abrir documento');
    for (const r of [novo, link]) for (const dado of ['receita', 'Receita', 'suplemento', 'Vitamina']) expect(r.subject + r.text + r.html, dado).not.toContain(dado);
  });
});

describe('documento_atualizado (US-149, D11)', () => {
  it('assunto e corpo da spec, botão "Ver meus documentos"; neutro: sem tipo de documento nem motivo', () => {
    const r = renderEmail({ tipo: 'documento_atualizado', para: 'ana@ex.com', nome: 'Ana', consultorio: 'Consultório Debby', link: 'https://x.dev/p/documentos?v=t' });
    expect(r.subject).toBe('Um documento seu foi atualizado');
    expect(r.text).toContain('Olá, Ana. Consultório Debby atualizou um documento seu. Para ver, entre no app: https://x.dev/p/documentos?v=t');
    expect(r.html).toContain('href="https://x.dev/p/documentos?v=t"');
    expect(r.html).toContain('Ver meus documentos');
    for (const dado of ['receita', 'Receita', 'cancel', 'Cancel']) expect(r.subject + r.text + r.html, dado).not.toContain(dado);
  });
});

describe('consulta (US-031, US-033, US-034)', () => {
  it('consulta: lembretes de 24 h e 2 h, marcada e cancelada (com o fuso no texto)', () => {
    const base = { tipo: 'consulta' as const, para: 'ana@ex.com', nome: 'Ana', nutri: 'Debby Silva', quando: 'sex., 16/10/2026 às 14:00 (horário de Brasília)', hora: '14:00', modalidade: 'presencial' as const, local: 'Rua das Flores, 10', link: 'https://x.dev/consulta/tok' };
    const l24 = renderEmail({ ...base, evento: 'lembrete_24h' });
    expect(l24.subject).toBe('Lembrete: sua consulta é amanhã às 14:00');
    expect(l24.text).toContain('Este é um lembrete da sua consulta com Debby Silva: sex., 16/10/2026 às 14:00 (horário de Brasília).');
    expect(l24.text).toContain('Endereço: Rua das Flores, 10');
    expect(l24.text).toContain('Confirmar presença ou remarcar: https://x.dev/consulta/tok');
    expect(l24.html).toContain('href="https://x.dev/consulta/tok"');
    expect(renderEmail({ ...base, evento: 'lembrete_2h', modalidade: 'online', local: 'https://meet.google.com/x' }).text).toContain('Link da chamada: https://meet.google.com/x');
    expect(renderEmail({ ...base, evento: 'consulta_marcada' }).subject).toBe('Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)');
    const c = renderEmail({ ...base, evento: 'consulta_cancelada', link: null });
    expect(c.subject).toBe('Consulta cancelada: sex., 16/10/2026 às 14:00 (horário de Brasília)');
    expect(c.text).not.toContain('/consulta/');
    expect(c.html).not.toContain('/consulta/');
  });
  it('"2" no WhatsApp (US-035): e-mail com o link para remarcar e o prazo', () => {
    const base = { tipo: 'consulta' as const, para: 'ana@ex.com', nome: 'Ana', nutri: 'Debby Silva', quando: 'sex., 16/10/2026 às 14:00 (horário de Brasília)', hora: '14:00', modalidade: 'presencial' as const, local: 'Rua das Flores, 10', link: 'https://x.dev/consulta/tok' };
    const r = renderEmail({ ...base, evento: 'resposta_remarcar', prazoH: 24 });
    expect(r.subject).toBe('Remarcar sua consulta: sex., 16/10/2026 às 14:00 (horário de Brasília)');
    expect(r.text).toBe(
      [
        'Olá, Ana!',
        'Você pediu pelo WhatsApp para remarcar sua consulta com Debby Silva de sex., 16/10/2026 às 14:00 (horário de Brasília).',
        'Escolher outro horário: https://x.dev/consulta/tok',
        'Se faltarem menos de 24 h para a consulta, fale direto com Debby Silva.',
      ].join('\n\n'),
    );
    expect(r.html).toContain('href="https://x.dev/consulta/tok"');
  });
});

describe('aviso_agenda (US-032, D18)', () => {
  it('aviso à nutricionista: assunto sem nome do paciente; nome e horário no corpo', () => {
    const r = renderEmail({ tipo: 'aviso_agenda', para: 'debby@ex.com', evento: 'novo_paciente_publico', paciente: 'Ana Souza', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)', link: 'https://x.dev/painel/agenda/consultas/1' });
    expect(r.subject).toBe('Novo paciente via agendamento online');
    expect(r.text).toContain('Ana Souza marcou uma consulta pela sua página de agendamento para sex., 16/10/2026 às 09:00 (horário de Brasília).');
    expect(r.text).toContain('Ver na agenda: https://x.dev/painel/agenda/consultas/1');
    expect(renderEmail({ tipo: 'aviso_agenda', para: 'd@x', evento: 'pedido_remarcacao', paciente: 'Ana', quando: 'q', link: 'https://x' }).subject).toBe('Paciente pediu para remarcar');
  });
});

describe('exclusao_consultas_canceladas (US-018, fechamento do Plano 05)', () => {
  it('aviso à nutricionista: assunto sem nome; primeiro nome e quantas no corpo (singular e plural)', () => {
    const um = renderEmail({ tipo: 'exclusao_consultas_canceladas', para: 'debby@ex.com', paciente: 'Ana', quantidade: 1 });
    expect(um.subject).toBe('Pedido de exclusão atendido');
    expect(um.text).toBe('Pedido de exclusão atendido: 1 consulta futura de Ana foi cancelada.');
    expect(renderEmail({ tipo: 'exclusao_consultas_canceladas', para: 'debby@ex.com', paciente: 'Ana', quantidade: 3 }).text).toBe('Pedido de exclusão atendido: 3 consultas futuras de Ana foram canceladas.');
  });
});

describe('codigo_agendamento (RN-16, D12)', () => {
  it('código do agendamento público: código no assunto e no corpo, validade de 10 min', () => {
    const r = renderEmail({ tipo: 'codigo_agendamento', para: 'ana@ex.com', nutri: 'Debby Silva', codigo: '042917' });
    expect(r.subject).toBe('Seu código para agendar com Debby Silva: 042917');
    expect(r.text).toContain('Use o código 042917 para confirmar o agendamento com Debby Silva.');
    expect(r.text).toContain('10 minutos');
    expect(r.html).toContain('042917');
  });
});

describe('whatsapp_desconectado (D18)', () => {
  it('WhatsApp desconectado: o que aconteceu e o link para conectar de novo', () => {
    const r = renderEmail({ tipo: 'whatsapp_desconectado', para: 'd@x.dev', link: 'https://x.dev/painel/whatsapp' });
    expect(r.subject).toBe('Seu WhatsApp foi desconectado do NutriDebby');
    expect(r.text).toContain('Conectar o WhatsApp de novo: https://x.dev/painel/whatsapp');
  });
});

describe('cota_whatsapp (RN-09, US-036)', () => {
  it('cota de WhatsApp: o texto exato da US-036 no assunto e o uso no corpo', () => {
    const r = renderEmail({ tipo: 'cota_whatsapp', para: 'd@x.dev', usadas: 400, cota: 500, link: 'https://x.dev/painel/whatsapp' });
    expect(r.subject).toBe('Você usou 80% dos WhatsApps do mês');
    expect(r.text).toContain('Já foram 400 de 500 mensagens de WhatsApp neste mês.');
    expect(r.text).toContain('Ver o uso do WhatsApp: https://x.dev/painel/whatsapp');
  });
});

describe('aviso_2fa_reiniciado (P09-02 b)', () => {
  it('aviso de 2FA reiniciado (P09-02 b): diz o que aconteceu, onde reativar e o que fazer se não foi pedido; sem link', () => {
    const r = renderEmail({ tipo: 'aviso_2fa_reiniciado', para: 'a@b.dev' });
    expect(r.subject).toBe('A verificação em duas etapas da sua conta foi desativada');
    expect(r.text).toContain('Conta > Segurança');
    expect(r.text).toContain('Se você não pediu isso');
    expect(r.html).not.toContain('href=');
  });
});
