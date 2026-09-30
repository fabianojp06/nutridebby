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
