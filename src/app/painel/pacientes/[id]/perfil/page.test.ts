import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 18 (D12, US-262 "Abas"): o cadastro, o "Acesso ao app" (com "Reenviar convite") e as "Etiquetas" ficam no Perfil.
// Paciente, acesso e etiquetas simulados; os formulários de verdade (estrutura, sem DOM).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const AVISO_BLOQUEADO = 'Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.';
let paciente: Record<string, unknown>;
let acesso: { estado: string; expiraEm?: Date };
let conviteWa: { status: string; motivoIgnorada: string | null; agendadaPara: Date; enviadaEm: Date | null } | null;
let cadastro: Record<string, string | null> | null;
const lidos: string[] = [];
// o estado do formulário depois de um "Salvar" (o useActionState devolve o estado pedido; as ações não rodam)
const estado = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState: (_acao: unknown, inicial: unknown) => [estado.atual ?? inicial, () => {}, false],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/modules/pacientes/cadastro', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/pacientes/cadastro')>()),
  cadastroDoPaciente: async (_ctx: unknown, id: string) => {
    lidos.push(id);
    return cadastro;
  },
}));
vi.mock('../prontuario', () => ({
  carregarProntuario: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, paciente }),
}));
vi.mock('@/modules/pacientes/convite-paciente', () => ({
  situacaoDoAcesso: async () => acesso,
  situacaoDoConviteWhatsapp: async () => conviteWa,
}));
vi.mock('@/modules/pacientes/etiquetas', () => ({
  listarEtiquetas: async () => [{ id: 'e1', nome: 'Gestante' }],
  etiquetasDoPaciente: async () => [{ id: 'e1', nome: 'Gestante' }],
}));
vi.mock('../../actions', () => ({ atualizarPacienteAction: vi.fn(), reenviarConviteAction: vi.fn(), salvarEtiquetasAction: vi.fn() }));
const { default: PerfilPage } = await import('./page');
const { VALORES_VAZIOS } = await import('../../valores');

async function render(): Promise<string> {
  const el = (await PerfilPage({ params: Promise.resolve({ id: PACIENTE }) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
const titulos = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);

describe('aba Perfil (Plano 18, D12)', () => {
  beforeEach(() => {
    paciente = {
      id: PACIENTE, nome: 'Ana Teste', email: 'ana@ex.com', dataNascimento: '1990-05-20', sexo: 'F', telefone: null,
      whatsappAutorizadoEm: null, status: 'ativo', userId: null, anonimizadoEm: null,
    };
    acesso = { estado: 'pendente', expiraEm: new Date('2026-11-20T15:00:00Z') };
    conviteWa = null;
    cadastro = null;
    lidos.length = 0;
    estado.atual = null;
  });

  it('mostra o cadastro, o "Acesso ao app" e as "Etiquetas", nessa ordem', async () => {
    const html = await render();
    expect(titulos(html)).toEqual(['Dados gerais', 'Contato e endereço', 'Observação', 'Acesso ao app', 'Etiquetas']);
    expect(html).not.toContain('Acesso ao portal');
    expect(html).toContain('value="Ana Teste"'); // o formulário de cadastro, com o que está salvo
    expect(html).toContain('Salvar cadastro');
    expect(html).toContain('Convite enviado por e-mail. Vale até 20/11/2026');
    expect(html).toContain('Reenviar convite');
    expect(html).toContain('Gestante');
    expect(html).toContain('Salvar etiquetas');
    expect(html).not.toContain(AVISO_BLOQUEADO);
  });

  it('sem convite por WhatsApp: sem a linha dele', async () => {
    expect(await render()).not.toContain('Convite por WhatsApp');
  });

  it('convite por WhatsApp enviado: a linha aparece no "Acesso ao app"', async () => {
    const quando = new Date('2026-11-16T13:30:00Z');
    conviteWa = { status: 'enviada', motivoIgnorada: null, agendadaPara: quando, enviadaEm: quando };
    const html = await render();
    expect(html).toContain('Convite por WhatsApp: enviado em seg., 16/11/2026 às 10:30');
    // depois do título "Acesso ao app" e antes de "Etiquetas"
    const i = html.indexOf('Convite por WhatsApp');
    expect(i).toBeGreaterThan(html.indexOf('>Acesso ao app<'));
    expect(i).toBeLessThan(html.indexOf('>Etiquetas<'));
  });

  it('acesso já ativo: sem "Reenviar convite"', async () => {
    acesso = { estado: 'ativo' };
    paciente = { ...paciente, userId: 'u1' };
    const html = await render();
    expect(html).toContain('Ativo: o paciente já criou a senha.');
    expect(html).not.toContain('Reenviar convite');
  });

  it('bloqueado: só leitura, com o aviso, sem "Reenviar convite"', async () => {
    paciente = { ...paciente, status: 'bloqueado' };
    const html = await render();
    expect(html).toContain(AVISO_BLOQUEADO);
    expect(html).not.toContain('Reenviar convite');
    // o cadastro e as etiquetas: os dois fieldsets de fora, desabilitados
    const desabilitados = [...html.matchAll(/<fieldset[^>]*disabled=""/g)];
    expect(desabilitados.length).toBe(2);
  });
  it('Plano 18 (§8.4): o cadastro em seções — fieldset/legend, rótulos, dicas e listas da spec, na ordem', async () => {
    const html = await render();
    // cada seção é um fieldset com a legenda (o título da seção) e o formulário não usa a validação do navegador
    for (const t of ['Dados gerais', 'Contato e endereço', 'Observação']) expect(html).toMatch(new RegExp(`<fieldset[^>]*><legend[^>]*><h2[^>]*>${t}</h2></legend>`));
    expect(html).toMatch(/<form[^>]*novalidate=""[^>]*data-guia="cadastro-paciente"/i);
    // o endereço é um fieldset dentro de "Contato e endereço"
    const contato = html.indexOf('>Contato e endereço<');
    const endereco = html.indexOf('<legend', contato + 1);
    expect(html.slice(endereco, html.indexOf('</legend>', endereco))).toContain('Endereço (opcional)');
    expect(endereco).toBeLessThan(html.indexOf('>Observação<'));
    const ordem = [
      'Nome completo',
      'Nome social (opcional)',
      'Data de nascimento',
      'Sexo biológico (usado nas fórmulas)',
      'Identidade de gênero (opcional)',
      'Estado civil (opcional)',
      'Escolaridade (opcional)',
      'Ocupação (opcional)',
      'Nacionalidade (opcional)',
      'Naturalidade (opcional)',
      'CPF (opcional)',
      'E-mail',
      '>Contato e endereço<',
      'Celular / WhatsApp (opcional)',
      'Paciente autorizou receber mensagens por WhatsApp',
      'Telefone fixo (opcional)',
      'Endereço (opcional)',
      '>CEP<',
      '>Rua<',
      '>Número<',
      '>Complemento<',
      '>Bairro<',
      '>Cidade<',
      '>Estado<',
      'Observação (opcional)',
      '>Acesso ao app<',
    ];
    const posicoes = ordem.map((t) => [t, html.indexOf(t)] as const);
    for (const [t, i] of posicoes) expect(i, t).toBeGreaterThan(-1);
    expect(posicoes.map(([, i]) => i)).toEqual([...posicoes.map(([, i]) => i)].sort((a, b) => a - b));
    for (const dica of [
      'Preencha só a pedido do paciente. Aparece no painel junto do nome completo.',
      'Como o paciente se identifica. As fórmulas usam o sexo biológico.',
      'Profissão ou atividade principal.',
      'Ex.: brasileira',
      'Cidade e estado onde nasceu. Ex.: Campinas (SP)',
      'Para identificar o paciente sem engano. Não aparece na lista nem no app.',
      'Ex.: (11) 91234-5678. Aceita fixo, mas os avisos de WhatsApp só saem para celular, se o paciente autorizar.',
      'Ex.: (11) 3123-4567',
      'O paciente pode receber uma cópia deste campo se pedir os dados dele (LGPD). Para anotações só suas, use as notas privadas do atendimento.',
    ]) expect(html).toContain(dica);
    // dica ligada ao campo
    expect(html).toMatch(/<input[^>]*id="cpf"[^>]*aria-describedby="cpf-dica"/);
    expect(html).toMatch(/<textarea[^>]*id="observacao"[^>]*aria-describedby="observacao-aviso observacao-contador"/);
    expect(html).toContain('0 de 1.000 caracteres');
    // listas fechadas com a opção vazia
    for (const r of ['Prefere não informar', 'União estável', 'Pós-graduação', 'Rio Grande do Norte']) expect(html).toContain(`>${r}</option>`);
    expect(html).toMatch(/<select[^>]*id="uf"[^>]*><option value=""[^>]*>Selecione<\/option>/);
  });

  it('Plano 18: o Perfil lê o cadastro complementar (cadastroDoPaciente, a leitura auditada) e mostra os valores formatados', async () => {
    cadastro = { cpf: '52998224725', nomeSocial: 'Joana Silva', identidadeGenero: null, estadoCivil: 'casado', escolaridade: null, ocupacao: 'Professora', nacionalidade: null, naturalidade: null, telefoneFixo: '+551131234567', cep: '13015904', logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: 'SP', observacao: 'Prefere manhã' };
    const html = await render();
    expect(lidos).toEqual([PACIENTE]);
    expect(html).toContain('value="529.982.247-25"');
    expect(html).toContain('value="13015-904"');
    expect(html).toContain('value="(11) 3123-4567"');
    expect(html).toContain('value="Joana Silva"');
    expect(html).toMatch(/<option value="casado" selected="">Casado\(a\)<\/option>/);
    expect(html).toMatch(/<option value="SP" selected="">São Paulo<\/option>/);
    expect(html).toContain('>Prefere manhã</textarea>');
    expect(html).toContain('13 de 1.000 caracteres');
  });

  it('CPF repetido: a mensagem no campo e o link "Abrir o cadastro existente (abre em nova aba)" para o Perfil do outro, em nova aba', async () => {
    const OUTRO = '00000000-0000-4000-8000-0000000000b2';
    estado.atual = { erros: { cpf: 'Já existe um paciente com este CPF neste consultório.' }, cpfExistenteId: OUTRO, valores: { ...VALORES_VAZIOS, nome: 'Ana Teste', dataNascimento: '1990-05-20', sexo: 'F', email: 'ana@ex.com', cpf: '529.982.247-25' } };
    const html = await render();
    expect(html).toMatch(/<p id="cpf-erro" role="alert"[^>]*>Já existe um paciente com este CPF neste consultório\.<\/p>/);
    expect(html).toContain(`<a href="/painel/pacientes/${OUTRO}/perfil" target="_blank" rel="noopener noreferrer"`);
    expect(html).toMatch(/target="_blank"[^>]*>Abrir o cadastro existente \(abre em nova aba\)<\/a>/);
    expect(html).toContain('value="529.982.247-25"'); // o digitado continua
    // sem o outro (bloqueado): a mensagem, sem o link
    estado.atual = { ...(estado.atual as object), cpfExistenteId: undefined };
    const sem = await render();
    expect(sem).toContain('Já existe um paciente com este CPF neste consultório.');
    expect(sem).not.toContain('Abrir o cadastro existente');
  });

  it('Plano 18 (§8.1): arquivado e bloqueado ficam "Sem acesso", mesmo com a senha criada', async () => {
    acesso = { estado: 'ativo' };
    paciente = { ...paciente, userId: 'u1', status: 'arquivado' };
    expect(await render()).toContain('Sem acesso (arquivado)');
    paciente = { ...paciente, status: 'bloqueado' };
    const html = await render();
    expect(html).toContain('Sem acesso (bloqueado)');
    expect(html).not.toContain('Ativo: o paciente já criou a senha.');
  });
});
