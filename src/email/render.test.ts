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
  });
});

describe('exportacao_pronta (US-018)', () => {
  it('link de 24 h, sem nenhum dado do paciente', () => {
    const r = renderEmail({ tipo: 'exportacao_pronta', para: 'debby@ex.com', link: 'http://localhost:3000/painel/pacientes/p/exportacoes/e' });
    expect(r.subject).toBe('Exportação de dados pronta');
    expect(r.text).toContain('24 horas');
    expect(r.html).toContain('href="http://localhost:3000/painel/pacientes/p/exportacoes/e"');
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
