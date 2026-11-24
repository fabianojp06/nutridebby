import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, SP } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { indicadoresDaAgenda } from '@/modules/agenda/presenca';
import { listarCategorias, salvarConfiguracoes } from '@/modules/financeiro/configuracoes';
import { cancelarLancamento, criarLancamento } from '@/modules/financeiro/lancamentos';
import { resumoDoMes } from '@/modules/financeiro/resumo';
import type { Acesso } from './acesso';
import { relatorioAgenda } from './agenda';
import { relatorioFinanceiro } from './financeiro';
import { periodoDaUrl } from './periodo';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const NUTRI: Acesso = { papel: 'nutri', financeiro: true };
const o = { localId: null, acesso: NUTRI };

/**
 * CS-482: os Relatórios batem com as telas que já existem, no mesmo banco e no mesmo relógio — "Marcadas" e "Faltas" do
 * mês atual = "Consultas do mês" e "Faltas" do Início (`indicadoresDaAgenda`), e as iniciadas, que dão a mesma taxa;
 * "Recebido" e "Pago" do mês atual = os cartões do Resumo do Financeiro (`resumoDoMes`). Às 22:30 de 30/11 em São Paulo
 * (01/12 em UTC): o mês atual é novembro nas duas telas.
 */
describe('consistência com o Início e o Resumo do Financeiro (CS-482)', () => {
  it('mês atual da Agenda = indicadores do Início; Recebido e Pago = Resumo do mês', async () => {
    const agora = new Date('2026-12-01T01:30:00Z');
    const deps = { db: app.db, agora };
    const T = await novoTenant(app.db);
    const ids = await Promise.all(['Ana', 'Bia', 'Caio', 'Dani', 'Eva'].map(async (nome) => (await novoPaciente(app.db, T.ctx, { nome })).id));
    const consulta = (i: number, inicio: Date, extra: Parameters<typeof consultaDireta>[5] = {}) => consultaDireta(app.db, T.ctx, ids[i], inicio, 60, extra);
    await consulta(0, em('2026-11-03', '10:00'), { status: 'realizada' });
    await consulta(1, em('2026-11-04', '10:00'), { status: 'faltou' });
    await consulta(2, em('2026-11-05', '10:00'), { status: 'faltou' });
    await consulta(3, em('2026-11-06', '10:00'), { status: 'cancelada', canceladoPor: 'paciente', canceladaEm: em('2026-11-01', '10:00') });
    await consulta(4, em('2026-11-30', '21:30')); // já começou (no fuso, ainda é 30/11)
    await consulta(0, em('2026-11-30', '23:30')); // ainda não começou
    await consulta(1, em('2026-10-20', '10:00'), { status: 'faltou' }); // mês anterior
    await consulta(2, em('2026-12-01', '10:00')); // mês seguinte

    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-10-01', saldoInicial: '500,00', valorConsulta: '250,00' }, deps);
    const cats = await listarCategorias(T.ctx, deps);
    const cat = (nome: string) => cats.find((c) => c.nome === nome)!.id;
    const lancar = (x: Record<string, unknown>) => criarLancamento(T.ctx, T.tenant, x, deps);
    await lancar({ tipo: 'entrada', valor: '250,00', categoriaId: cat('Consultas'), vencimento: '2026-11-03', pagoEm: '2026-11-03', forma: 'pix', pacienteId: ids[0] });
    await lancar({ tipo: 'entrada', valor: '120,00', categoriaId: cat('Outras entradas'), vencimento: '2026-11-30', pagoEm: '2026-11-30', forma: 'pix' });
    await lancar({ tipo: 'saida', valor: '700,00', categoriaId: cat('Aluguel e condomínio'), vencimento: '2026-11-05', pagoEm: '2026-11-05', forma: 'boleto' });
    await lancar({ tipo: 'saida', valor: '35,00', categoriaId: cat('Material e insumos'), vencimento: '2026-11-25' }); // em aberto
    const cancelada = await lancar({ tipo: 'entrada', valor: '999,00', categoriaId: cat('Consultas'), vencimento: '2026-11-10', pagoEm: '2026-11-10', forma: 'pix', pacienteId: ids[1] });
    await cancelarLancamento(T.ctx, cancelada.id, 'Devolução', deps);
    await lancar({ tipo: 'entrada', valor: '80,00', categoriaId: cat('Outras entradas'), vencimento: '2026-10-31', pagoEm: '2026-10-31', forma: 'pix' }); // outubro

    const { periodo, erro } = periodoDaUrl(new URLSearchParams(), agora, SP);
    expect(erro).toBeNull();
    expect(periodo.ate).toBe('2026-11');

    const inicio = await indicadoresDaAgenda(T.ctx, SP, agora, app.db);
    const agenda = (await relatorioAgenda(T.ctx, { fuso: SP }, periodo, o, deps)).meses.at(-1)!;
    expect(inicio).toMatchObject({ consultasMes: 5, faltasMes: 2, iniciadasMes: 4 }); // controle positivo: o cenário conta
    expect({ marcadas: agenda.marcadas, faltas: agenda.faltas, iniciadas: agenda.iniciadas }).toEqual({
      marcadas: inicio.consultasMes,
      faltas: inicio.faltasMes,
      iniciadas: inicio.iniciadasMes,
    });

    const resumo = await resumoDoMes(T.ctx, T.tenant, deps);
    const fin = await relatorioFinanceiro(T.ctx, { fuso: SP }, periodo, o, deps);
    if (!fin.configurado) throw new Error('o Financeiro está configurado no cenário');
    const novembro = fin.meses.at(-1)!;
    expect(resumo.entradas.recebido).toBe(37000); // controle positivo
    expect(resumo.saidas.pago).toBe(70000);
    expect({ recebido: novembro.recebido, pago: novembro.pago }).toEqual({ recebido: resumo.entradas.recebido, pago: resumo.saidas.pago });
  });
});
