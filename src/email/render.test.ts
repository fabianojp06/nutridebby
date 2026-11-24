import { describe, expect, it } from 'vitest';
import { renderEmail } from './templates';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';

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
    for (const t of ['as fotos do diário alimentar', 'os exames enviados pelo app que ainda não tinham sido aceitos', 'as notificações no aparelho', 'Suas consultas futuras foram canceladas', 'não tem mais acesso ao portal deste acompanhamento'])
      expect(r.text).toContain(t);
    // Plano 15 (D22; LGPD art. 18, § 4º, II — revisão da T10): as conversas com a IA Nutri saem, e a razão de a mensagem
    // com sinal de risco ainda não lida ficar guardada, com o prazo
    expect(r.text).toContain('os convites de acesso e as conversas com a IA Nutri.');
    expect(r.text).toContain(
      'Se houver uma mensagem com sinal de risco enviada à IA Nutri que sua nutricionista ainda não leu, ela fica guardada até ser lida, por no máximo 30 dias, para a sua proteção. Depois disso, o texto é apagado e fica só o registro de que houve o aviso, até 180 dias da mensagem.',
    );
    expect(r.html).toContain('por no máximo 30 dias, para a sua proteção');
  });

  it('Plano 20 (US-307, spec §6.2; LGPD art. 18, § 4º, II): a linha dos registros de pagamento vem logo depois da do prontuário', () => {
    const r = renderEmail({ tipo: 'exclusao_atendida', para: 'ana@ex.com', nome: 'Ana Souza', nutri: 'Debby Silva', anonimizarApos: '15/09/2046' });
    const linhas = r.text.split('\n\n');
    const prontuario = linhas.findIndex((l) => l.startsWith('Por obrigação legal (LGPD, art. 16, I), o prontuário clínico'));
    expect(prontuario).toBeGreaterThan(0);
    expect(linhas[prontuario + 1]).toBe(
      'Se você tem registros de pagamento de consultas neste acompanhamento, eles ficam guardados pelo mesmo prazo, pelas obrigações fiscais, e os pagamentos em aberto continuam devidos.',
    );
    expect(linhas[prontuario + 1]).toBe(MSG_FINANCEIRO.lgpd.emailExclusaoAtendida);
    expect(linhas.at(-1)).toBe('Se tiver dúvidas, fale com a sua nutricionista.');
    expect(r.html).toContain('pelas obrigações fiscais, e os pagamentos em aberto continuam devidos.');
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
    // Plano 20 (US-307, spec §6.2): a segunda linha cita os registros de pagamento das consultas
    expect(r.text.split('\n\n')).toEqual([
      'Recebemos seu pedido de exclusão de dados. Debby Silva tem até 20/10/2026 para responder.',
      'Por obrigação legal, o prontuário clínico é guardado de forma bloqueada pelo prazo exigido, e os registros de pagamento das consultas ficam guardados pelo mesmo prazo (os pagamentos em aberto continuam devidos); o resto é apagado quando o pedido for atendido. Você recebe outro e-mail nesse momento.',
    ]);
    expect(r.text.split('\n\n')[1]).toBe(MSG_FINANCEIRO.lgpd.emailPedidoExclusao);
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

describe('Plano 11 — e-mails da IA', () => {
  it('cota_ia: aviso de 80% sem valores em US$ e com o link de Configurações', () => {
    const r = renderEmail({ tipo: 'cota_ia', para: 'd@x.dev', link: 'https://x.dev/painel/configuracoes' });
    expect(r.subject).toBe('Você já usou 80% do limite de IA deste mês');
    expect(r.text).toContain('https://x.dev/painel/configuracoes');
    expect(r.text).not.toMatch(/US\$/);
  });
  it('cota_ia_nutri (Plano 15, US-176): 80% da IA Nutri, à equipe; sem nome de paciente, conversa nem valores em US$', () => {
    const r = renderEmail({ tipo: 'cota_ia_nutri', para: 'd@x.dev', link: 'https://x.dev/painel/configuracoes' });
    expect(r.subject).toBe('Os pacientes já usaram 80% do limite da IA Nutri deste mês');
    expect(r.text).toBe(
      [
        'Os pacientes já usaram 80% do limite da IA Nutri deste mês.',
        'Quando chegar a 100%, a IA Nutri fica indisponível para os pacientes até o dia 1º ou até o suporte ampliar o limite. A leitura de laudos e as outras funções de IA não mudam.',
        'Ver o uso da IA: https://x.dev/painel/configuracoes',
      ].join('\n\n'),
    );
    expect(r.html).toContain('href="https://x.dev/painel/configuracoes"');
    expect(r.html).toContain('Os pacientes já usaram 80% do limite da IA Nutri deste mês.');
    expect(`${r.subject}${r.text}${r.html}`).not.toMatch(/US\$|paciente:|pergunt/i);
  });
  it('risco_ia_nutri (Plano 15, D10, RNF-166): o texto da spec, genérico — sem paciente, conversa, categoria nem "risco"', () => {
    const r = renderEmail({ tipo: 'risco_ia_nutri', para: 'd@x.dev', link: 'https://x.dev/painel/duvidas' });
    expect(r.subject).toBe('Há uma mensagem de paciente que precisa da sua atenção.');
    expect(r.text).toBe(
      [
        'Há uma mensagem de paciente que precisa da sua atenção.',
        'Abra as dúvidas dos pacientes no NutriDebby.',
        'Abrir as dúvidas dos pacientes: https://x.dev/painel/duvidas',
      ].join('\n\n'),
    );
    expect(r.html).toContain('href="https://x.dev/painel/duvidas"');
    expect(`${r.subject}${r.text}${r.html}`).not.toMatch(/risco|emerg|transtorno|sintoma|pergunt|paciente:/i);
  });
  it('alerta_ia: credencial cita só o NOME da variável; teto não cita valores', () => {
    const c = renderEmail({ tipo: 'alerta_ia', para: 'a@x.dev', motivo: 'credencial', painelUrl: 'https://x.dev/admin' });
    expect(c.text).toContain('ANTHROPIC_API_KEY');
    expect(c.text).not.toMatch(/sk-ant-/);
    expect(renderEmail({ tipo: 'alerta_ia', para: 'a@x.dev', motivo: 'teto', painelUrl: 'https://x.dev/admin' }).text).toContain('teto mensal');
  });
  it('Plano 15 (D22, RN-182): alerta_ia risco_ia_nutri — só o aviso, sem consultório, paciente, contagem nem texto (desvio 5)', () => {
    const r = renderEmail({ tipo: 'alerta_ia', para: 'a@x.dev', motivo: 'risco_ia_nutri', painelUrl: 'https://x.dev/admin' });
    expect(r.subject).toBe('IA do NutriDebby: atenção');
    expect(r.text).toContain('Há mensagens com sinal de risco na IA Nutri que nenhuma nutricionista abriu há mais de 72 horas. Avise os consultórios pelo canal de suporte.');
    expect(r.html).toContain('href="https://x.dev/admin"');
    expect(r.text).not.toMatch(/laudo|teto|ANTHROPIC|\d+ mensage/);
  });
});

describe('Plano 14A — e-mails da autorização de IA', () => {
  it('autorizacao_ia: assunto com o consultório, botão "Ler e decidir" com o link; sem dado de saúde', () => {
    const r = renderEmail({ tipo: 'autorizacao_ia', para: 'p@x.dev', consultorio: 'Consultório Debby', link: 'https://app.test/autorizacao-ia/abc' });
    expect(r.subject).toBe('Consultório Debby: autorização para uso de inteligência artificial');
    expect(r.html).toContain('href="https://app.test/autorizacao-ia/abc"');
    expect(r.text).toContain('Ler e decidir');
    expect(r.text).toContain('recusar não muda nada no seu atendimento');
    expect(r.text).toContain('Esta autorização é pessoal. Se você recebeu este e-mail por engano, não toque em Autorizo.'); // F4
  });

  it('autorizacao_ia_confirmada de job antigo, sem `usos` (14A): só a leitura de laudos (F2), a versão, o destino, o "Se não foi você" (F4) e o botão "Retirar a autorização"', () => {
    const r = renderEmail({ tipo: 'autorizacao_ia_confirmada', para: 'p@x.dev', consultorio: 'Consultório Debby', destino: 'Amazon Web Services (Claude), União Europeia', versao: '0.1-provisorio', link: 'https://app.test/autorizacao-ia/xyz' });
    expect(r.subject).toBe('Você autorizou o uso de inteligência artificial');
    for (const t of ['ler os laudos dos seus exames', '0.1-provisorio', 'União Europeia', 'saem do Brasil', 'Retirar a autorização', 'Se não foi você quem autorizou, toque em Retirar a autorização e avise sua nutricionista.']) expect(r.text).toContain(t);
    for (const t of ['resumir o seu histórico', 'rascunho']) expect(r.text).not.toContain(t);
    expect(r.text).toContain('(texto da versão 0.1-provisorio), só para ler os laudos dos seus exames e sugerir os valores para o seu prontuário.');
    expect(r.html).toContain('href="https://app.test/autorizacao-ia/xyz"');
  });

  it('Plano 14B (F2): autorizacao_ia_confirmada com os usos da versão gravada — os três, como no texto 1.1', () => {
    const r = renderEmail({ tipo: 'autorizacao_ia_confirmada', para: 'p@x.dev', consultorio: 'Consultório Debby', destino: 'Provedor de teste', versao: '1.1', usos: ['leitura_laudos', 'resumo_historico', 'rascunho_plano'], link: 'https://app.test/autorizacao-ia/xyz' });
    expect(r.text).toContain('(texto da versão 1.1), só para: ler os laudos dos seus exames e sugerir os valores para o seu prontuário; resumir o seu histórico antes da consulta; montar um primeiro rascunho do seu plano alimentar, que a nutricionista revisa.');
    expect(r.text).not.toContain('Destino dos dados'); // destino de teste: nada sai para fornecedor
    const so = renderEmail({ tipo: 'autorizacao_ia_confirmada', para: 'p@x.dev', consultorio: 'Consultório Debby', destino: 'Provedor de teste', versao: '1.0', usos: ['leitura_laudos'], link: 'https://app.test/autorizacao-ia/xyz' });
    expect(so.text).toContain('só para ler os laudos dos seus exames e sugerir os valores para o seu prontuário.');
  });
});

describe('Plano 23 (T6b, §6.2): pedidos de consulta', () => {
  it('à nutricionista: "Novo pedido de consulta" (Responda em Solicitações) e "Pedido de consulta retirado"; o nome só no corpo', () => {
    const quando = 'sex., 16/10/2026 às 09:00 (horário de Brasília)';
    const novo = renderEmail({ tipo: 'aviso_agenda', para: 'd@x', evento: 'pedido', paciente: 'Ana Souza', quando, link: 'https://x.dev/painel/agenda/solicitacoes' });
    expect(novo.subject).toBe('Novo pedido de consulta');
    expect(novo.text).toBe(`Ana Souza pediu ${quando}.\n\nResponda em Solicitações: https://x.dev/painel/agenda/solicitacoes`);
    const retirado = renderEmail({ tipo: 'aviso_agenda', para: 'd@x', evento: 'pedido_desistido', paciente: 'Ana', quando, link: 'https://x.dev/painel/agenda/consultas/1' });
    expect(retirado.subject).toBe('Pedido de consulta retirado');
    expect(retirado.text.split('\n\n')[0]).toBe(`Ana retirou o pedido de ${quando}.`);
    for (const r of [novo, retirado]) expect(r.subject).not.toContain('Ana');
  });
  it('ao paciente: "Seu pedido de consulta não foi confirmado", com "Escolha outro horário" e o link; sem link, só a primeira frase', () => {
    const quando = 'sex., 16/10/2026 às 09:00 (horário de Brasília)';
    const com = renderEmail({ tipo: 'pedido_nao_confirmado', para: 'a@x', quando, link: 'https://x.dev/p/agenda/nova?v=1' });
    expect(com.subject).toBe('Seu pedido de consulta não foi confirmado');
    expect(com.text).toBe(`O horário de ${quando} não foi confirmado.\n\nEscolha outro horário: https://x.dev/p/agenda/nova?v=1`);
    expect(com.html).toContain('href="https://x.dev/p/agenda/nova?v=1"');
    const sem = renderEmail({ tipo: 'pedido_nao_confirmado', para: 'a@x', quando, link: null });
    expect(sem.text).toBe(`O horário de ${quando} não foi confirmado.`);
    expect(sem.html).not.toContain('href=');
  });
});

describe('Plano 23 (T7, §6.2): pedido da página pública', () => {
  const quando = 'sex., 16/10/2026 às 09:00 (horário de Brasília)';
  it('"Recebemos seu pedido de consulta": a mesma frase para paciente e pessoa nova; só a pessoa nova leva "Desistir do pedido"', () => {
    const nova = renderEmail({ tipo: 'pedido_recebido', para: 'a@x', quando, linkDesistir: 'https://x.dev/n/debby/pedido/tok' });
    expect(nova.subject).toBe('Recebemos seu pedido de consulta');
    expect(nova.text).toBe(`Seu pedido para ${quando} foi enviado. Você recebe outro e-mail quando a nutricionista responder.\n\nDesistir do pedido: https://x.dev/n/debby/pedido/tok`);
    expect(nova.html).toContain('href="https://x.dev/n/debby/pedido/tok"');
    const paciente = renderEmail({ tipo: 'pedido_recebido', para: 'a@x', quando, linkDesistir: null });
    expect(paciente.subject).toBe(nova.subject);
    expect(paciente.text).toBe(`Seu pedido para ${quando} foi enviado. Você recebe outro e-mail quando a nutricionista responder.`);
    expect(paciente.html).not.toContain('href=');
  });
  it('"Seu pedido de consulta não foi confirmado" da pessoa nova: com o link da página ou só a primeira frase; nunca um motivo', () => {
    const com = renderEmail({ tipo: 'pedido_nao_confirmado_publico', para: 'a@x', quando, link: 'https://x.dev/n/debby' });
    expect(com.subject).toBe('Seu pedido de consulta não foi confirmado');
    expect(com.text).toBe(`O horário de ${quando} não foi confirmado.\n\nEscolha outro horário: https://x.dev/n/debby`);
    const sem = renderEmail({ tipo: 'pedido_nao_confirmado_publico', para: 'a@x', quando, link: null });
    expect(sem.text).toBe(`O horário de ${quando} não foi confirmado.`);
    expect(sem.html).not.toContain('href=');
    for (const r of [com, sem]) expect(`${r.subject} ${r.text}`).not.toMatch(/motivo/i);
  });
});

describe('Plano 23 (T10, RN-432, RN-434, §6.2): mensagem de aniversário', () => {
  const msg = {
    tipo: 'aniversario' as const,
    para: 'ana@x',
    nome: 'Ana',
    nutricionista: 'Débora Silva',
    link: 'https://x.dev/aniversario/sair/tok',
    umClique: 'https://x.dev/api/aniversario/sair/tok',
  };
  it('assunto sem o nome; corpo, rodapé e o link de saída com o texto fixo; sem oferta nem dado de saúde', () => {
    const r = renderEmail(msg);
    expect(r.subject).toBe('Uma mensagem da sua nutricionista');
    expect(r.text).toBe(
      'Feliz aniversário, Ana! Débora Silva deseja a você um novo ano com muita saúde.\n\nMensagem enviada pelo NutriDebby a pedido de Débora Silva.\n\nNão quero mais receber mensagens de aniversário: https://x.dev/aniversario/sair/tok',
    );
    expect(r.html).toContain('Feliz aniversário, Ana! Débora Silva deseja a você um novo ano com muita saúde.');
    expect(r.html).toContain('Mensagem enviada pelo NutriDebby a pedido de Débora Silva.');
    expect(r.html).toMatch(/<a href="https:\/\/x\.dev\/aniversario\/sair\/tok"[^>]*>Não quero mais receber mensagens de aniversário<\/a>/);
    expect(`${r.subject} ${r.text}`).not.toMatch(/desconto|promo|preço|sorteio|peso|consulta/i);
  });
  it('cabeçalhos RFC 8058: List-Unsubscribe com a URL da rota de um clique e List-Unsubscribe-Post; os outros e-mails sem cabeçalho', () => {
    expect(renderEmail(msg).headers).toEqual({ 'List-Unsubscribe': '<https://x.dev/api/aniversario/sair/tok>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(renderEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'https://x.dev/r/1' }).headers).toBeUndefined();
  });
  it('escapa o nome vindo do cadastro', () => {
    expect(renderEmail({ ...msg, nome: 'Ana <b>x</b>' }).html).not.toContain('<b>x</b>');
  });
});
