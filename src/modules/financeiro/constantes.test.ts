import { describe, expect, it } from 'vitest';
import { FORMAS_DE_PAGAMENTO as FORMAS_DO_SCHEMA } from '@/db/schema/financeiro';
import { CATEGORIAS_INICIAIS, FORMAS_DE_PAGAMENTO, MSG_FINANCEIRO, ROTULO_FORMA } from './constantes';

describe('CATEGORIAS_INICIAIS (RN-302)', () => {
  it('as 12 categorias, na ordem e com os nomes exatos: 2 de entrada ("Consultas" com a chave) e 10 de saída', () => {
    expect(CATEGORIAS_INICIAIS).toEqual([
      { tipo: 'entrada', nome: 'Consultas', chave: 'consultas' },
      { tipo: 'entrada', nome: 'Outras entradas', chave: null },
      { tipo: 'saida', nome: 'Aluguel e condomínio', chave: null },
      { tipo: 'saida', nome: 'Contas de consumo (água, luz, internet, telefone)', chave: null },
      { tipo: 'saida', nome: 'Material e insumos', chave: null },
      { tipo: 'saida', nome: 'Equipamentos', chave: null },
      { tipo: 'saida', nome: 'Software e assinaturas', chave: null },
      { tipo: 'saida', nome: 'Divulgação', chave: null },
      { tipo: 'saida', nome: 'Impostos e taxas', chave: null },
      { tipo: 'saida', nome: 'Conselho e associações', chave: null },
      { tipo: 'saida', nome: 'Cursos e eventos', chave: null },
      { tipo: 'saida', nome: 'Outras saídas', chave: null },
    ]);
  });

  it('nomes de 1 a 60 caracteres (RN-303)', () => {
    for (const c of CATEGORIAS_INICIAIS) expect(c.nome.length).toBeLessThanOrEqual(60);
  });
});

describe('formas de pagamento', () => {
  it('a lista é a do schema (fonte única) e cada forma tem o rótulo da spec, na ordem', () => {
    expect(FORMAS_DE_PAGAMENTO).toBe(FORMAS_DO_SCHEMA);
    expect(FORMAS_DE_PAGAMENTO.map((f) => ROTULO_FORMA[f])).toEqual(['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Transferência bancária', 'Boleto', 'Outra']);
  });
});

/** Spec §6.2: os textos exatos (amostra das tabelas; a revisão confere o resto chave por chave). */
describe('MSG_FINANCEIRO', () => {
  const M = MSG_FINANCEIRO;

  it('menu, primeiro acesso e avisos', () => {
    expect(M.menu).toBe('Financeiro');
    expect(Object.values(M.secoes)).toEqual(['Resumo', 'Lançamentos', 'Pagamentos pendentes', 'Relatórios', 'Configurações']);
    expect(M.comecePorAqui).toBe('Comece por aqui');
    expect(M.comeceTexto).toBe(
      'Informe quanto há no caixa do consultório numa data e o valor da sua consulta. Depois disso, cada consulta marcada como Realizada gera a cobrança sozinha.',
    );
    expect(M.semValorConsulta).toBe('O valor da consulta não está configurado: as consultas marcadas como Realizada não geram cobrança.');
    expect(M.informeSaldo).toBe('Informe o saldo do caixa para começar.');
    expect(M.antesDoSaldo('01/11/2026')).toBe('Este lançamento é anterior ao saldo do caixa (01/11/2026) e não altera o saldo atual.');
    expect(M.avisoCancelar).toBe('O lançamento cancelado não volta. Ele continua na lista, como Cancelado, e sai dos totais e do saldo.');
    expect(M.bloqueado).toBe('Paciente bloqueado por pedido de exclusão. As cobranças em aberto continuam valendo; não é possível criar cobranças novas.');
  });

  it('cartões do Resumo, com o plural do contador', () => {
    expect(M.cartaoSaldo.desde('01/11/2026')).toBe('Desde o saldo de 01/11/2026');
    expect(M.cartaoEntradas.titulo('novembro')).toBe('Entradas de novembro');
    expect(M.cartaoEntradas.atrasoAnterior('R$ 10,00')).toBe('Em atraso de meses anteriores R$ 10,00');
    expect(M.cartaoSaidas.aPagar('R$ 10,00')).toBe('A pagar R$ 10,00');
    expect(M.cartaoPendentes.resumo(1, 'R$ 250,00')).toBe('1 paciente · R$ 250,00');
    expect(M.cartaoPendentes.resumo(3, 'R$ 750,00')).toBe('3 pacientes · R$ 750,00');
    expect(M.ultimos.vazio).toBe('Nenhum lançamento ainda.');
  });

  it('formulário, ajudas, totais e sucesso', () => {
    expect(M.ajudaDescricao.entrada).toBe('Até 200 caracteres. Não escreva informações de saúde aqui.');
    expect(M.ajudaDescricao.saida).toBe('Até 200 caracteres. Não escreva informações de saúde nem nomes de pessoas.');
    expect(M.totaisDaLista.recebidoOuPago('A', 'B', 'C')).toBe('Recebido ou pago: entradas A · saídas B · resultado C');
    expect(M.totaisDaLista.emAberto('A', 'B')).toBe('Em aberto: entradas A · saídas B');
    expect(M.filtros.mais200).toBe('Mostrando os 200 mais recentes. Escolha um mês para ver os outros.');
    expect(M.filtros.situacoes).toEqual({ todas: 'Todas', previsto: 'Previsto', em_atraso: 'Em atraso', recebido_ou_pago: 'Recebido ou pago', cancelado: 'Cancelado' });
    expect(M.ok).toEqual({
      salvo: 'Lançamento salvo.',
      recebido: 'Recebimento registrado.',
      pago: 'Pagamento registrado.',
      cancelado: 'Lançamento cancelado.',
      config: 'Configurações salvas.',
    });
  });

  it('mensagens de erro dos lançamentos', () => {
    expect(M.erros.informeValor).toBe('Informe o valor.');
    expect(M.erros.valorFaixa).toBe('O valor deve ser de R$ 0,01 a R$ 1.000.000,00.');
    expect(M.erros.valorInvalido).toBe('Valor inválido. Use só números, como 250,00.');
    expect(M.erros.recebimentoFuturo).toBe('A data do recebimento não pode ser depois de hoje.');
    expect(M.erros.pagamentoFuturo).toBe('A data do pagamento não pode ser depois de hoje.');
    expect(M.erros.cancelado).toBe('Este lançamento foi cancelado e não pode mais ser alterado.');
    expect(M.erros.anonimizado).toBe('Este lançamento foi anonimizado e não pode mais ser alterado.');
    expect(M.erros.bloqueadoNovo).toBe('Paciente bloqueado por pedido de exclusão: não é possível criar lançamentos novos para ele.');
    expect(M.erros.bloqueadoAlterar).toBe('Paciente bloqueado por pedido de exclusão: só é possível registrar o recebimento, reduzir o valor ou cancelar.');
    expect(M.erros.jaTemCobranca).toBe('Esta consulta já tem uma cobrança.');
    expect(M.erros.periodoLongo).toBe('Escolha um período de até 12 meses.');
    expect(M.errosConfig.saldoFaixa).toBe('O saldo deve ser de −R$ 10.000.000,00 a R$ 10.000.000,00.');
    expect(M.errosConfig.valorConsultaFaixa).toBe('O valor deve ser de R$ 0,01 a R$ 1.000.000,00.');
    expect(M.errosCategoria.consultasFixa).toBe('A categoria Consultas é usada nas cobranças das consultas e não pode ser arquivada. Você pode mudar o nome dela.');
  });

  it('as quatro mensagens da consulta depois de "Realizada"/"Faltou" e as do atendimento', () => {
    const { presenca, atendimento } = M;
    const comLink = (m: { antes?: string; link: string; depois: string }) => `${m.antes ?? ''}${m.link}${m.depois}`;
    expect(presenca.criada('R$ 250,00')).toBe('Presença registrada. Cobrança de R$ 250,00 criada no Financeiro.');
    expect(comLink(presenca.semValor)).toBe('Presença registrada. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro.');
    expect(presenca.semValor.link).toBe('configurações do Financeiro');
    expect(presenca.aberta).toBe('Presença registrada. Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar.');
    expect(presenca.recebida).toBe('Presença registrada. Esta consulta tem um pagamento recebido. Se for devolver o valor, cancele o lançamento no Financeiro.');
    expect(atendimento.criada('R$ 250,00')).toBe('Atendimento registrado. Cobrança de R$ 250,00 criada no Financeiro.');
    expect(comLink(atendimento.semValor)).toBe('Atendimento registrado. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro.');
    expect(comLink(M.consulta.configure)).toBe('Configure o Financeiro para registrar cobranças.');
    expect(M.consulta.configure.link).toBe('Configure o Financeiro');
  });

  it('pendentes, relatórios, CSV e textos da exclusão', () => {
    expect(M.pendentes.linha('Ana', 'R$ 500,00', 2, '01/10/2026')).toBe('Ana · R$ 500,00 · 2 cobranças · desde 01/10/2026');
    expect(M.pendentes.linha('Ana', 'R$ 250,00', 1, '01/10/2026')).toBe('Ana · R$ 250,00 · 1 cobrança · desde 01/10/2026');
    expect(M.pendentesDoPacienteVazio.texto('Ana')).toBe('Nenhum pagamento pendente de Ana.');
    expect(M.relatorios.notaSaldo('01/11/2026')).toBe('O saldo começa em 01/11/2026. Antes dessa data, só as entradas e as saídas aparecem.');
    expect(M.csv.ajuda).toBe(
      'Sem esta opção, o arquivo não tem a coluna Paciente, e a descrição das entradas de pacientes sai vazia. Com ela, o download fica registrado no Histórico de acessos de cada paciente. Quem receber o arquivo deve guardar sigilo.',
    );
    expect(M.lgpd.confirmarExclusaoPortal).toBe(
      'Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico e os registros de pagamento das consultas são guardados pelo prazo legal.',
    );
    expect(M.lgpd.dpaOQueMudou).toBe('O que mudou: o contrato passa a citar os registros financeiros do consultório, inclusive os pagamentos dos pacientes (Financeiro).');
  });

  it('o retorno das ações na lista de categorias (região de status; texto fora da §6.2, aguarda o dono)', () => {
    const F = M.configuracoes.feito;
    expect(F.criada('Contador')).toBe('Categoria Contador criada.');
    expect(F.renomeada('Anúncios')).toBe('Categoria renomeada para Anúncios.');
    expect(F.arquivada('Divulgação')).toBe('Categoria Divulgação arquivada.');
    expect(F.reativada('Divulgação')).toBe('Categoria Divulgação reativada.');
    expect(F.excluida('Divulgação')).toBe('Categoria Divulgação excluída.');
  });

  it('nenhum texto vazio nem com espaço sobrando', () => {
    const textos: string[] = [];
    const juntar = (v: unknown) => {
      if (typeof v === 'string') textos.push(v);
      else if (typeof v === 'function') textos.push(String((v as (...a: unknown[]) => unknown)('X', 'Y', 2, 'Z')));
      else if (v && typeof v === 'object') Object.values(v).forEach(juntar);
    };
    juntar(M);
    expect(textos.length).toBeGreaterThan(150);
    for (const t of textos) {
      expect(t.trim().length).toBeGreaterThan(0);
      expect(t).not.toMatch(/ {2}/);
    }
  });
});
