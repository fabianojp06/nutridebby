import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { MSG_MENSAGENS } from './constantes';
import { dentroDoHorario, horarioParaPaciente, lerConfiguracao, resumoDoHorario, salvarConfiguracao, validarFaixas, type Faixa } from './horario';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const FUSO = 'America/Sao_Paulo';
const brt = (s: string) => new Date(`${s}-03:00`);
const f = (diaSemana: number, das: string, as: string): Faixa => {
  const min = (h: string) => Number(h.split(':')[0]) * 60 + Number(h.split(':')[1]);
  return { diaSemana, inicioMin: min(das), fimMin: min(as) };
};
const UTEIS = [1, 2, 3, 4, 5].flatMap((d) => [f(d, '09:00', '12:00'), f(d, '14:00', '18:00')]);
const C = MSG_MENSAGENS.configuracao;

/** Um Db que falha se alguém abrir transação: prova que a recusa vem antes do withTenant. */
const semTransacao = () => {
  const transaction = vi.fn(() => {
    throw new Error('abriu transação');
  });
  return { db: { transaction } as unknown as Db, transaction };
};

describe('Plano 25 — dentroDoHorario (RN-451, puro)', () => {
  it('no fuso do consultório, com o servidor em UTC, inclusive na virada do dia', () => {
    // 23/11/2026 é segunda (1); 22/11, domingo (0)
    const faixas = [f(1, '22:00', '24:00'), f(2, '00:00', '01:00')];
    // 23:30 de segunda em Brasília = 02:30 UTC de terça
    expect(dentroDoHorario(faixas, FUSO, brt('2026-11-23T23:30:00'))).toBe(true);
    // 00:30 de terça em Brasília = 03:30 UTC
    expect(dentroDoHorario(faixas, FUSO, brt('2026-11-24T00:30:00'))).toBe(true);
    // 01:00 de terça: o fim não entra
    expect(dentroDoHorario(faixas, FUSO, brt('2026-11-24T01:00:00'))).toBe(false);
    // 21:59 de segunda: antes do início
    expect(dentroDoHorario(faixas, FUSO, brt('2026-11-23T21:59:00'))).toBe(false);
    // o mesmo instante em outro fuso cai em outro dia
    expect(dentroDoHorario([f(2, '02:00', '03:00')], 'UTC', brt('2026-11-23T23:30:00'))).toBe(true);
    expect(dentroDoHorario([f(2, '02:00', '03:00')], FUSO, brt('2026-11-23T23:30:00'))).toBe(false);
  });

  it('24:00 cobre até a meia-noite; domingo = 0; sem faixas, nunca', () => {
    expect(dentroDoHorario([f(1, '23:45', '24:00')], FUSO, brt('2026-11-23T23:59:59'))).toBe(true);
    expect(dentroDoHorario([f(1, '23:45', '24:00')], FUSO, brt('2026-11-24T00:00:00'))).toBe(false);
    expect(dentroDoHorario([f(0, '08:00', '10:00')], FUSO, brt('2026-11-22T09:00:00'))).toBe(true);
    expect(dentroDoHorario([f(0, '08:00', '10:00')], FUSO, brt('2026-11-23T09:00:00'))).toBe(false);
    expect(dentroDoHorario([], FUSO, brt('2026-11-23T09:00:00'))).toBe(false);
  });
});

describe('Plano 25 — resumoDoHorario (§6.2, US-446)', () => {
  it('junta os dias seguidos com o mesmo horário', () => {
    expect(resumoDoHorario(UTEIS)).toBe('segunda a sexta, 9h às 12h e 14h às 18h');
    // a ordem das faixas e dos dias na entrada não muda o resumo
    expect(resumoDoHorario([...UTEIS].reverse())).toBe('segunda a sexta, 9h às 12h e 14h às 18h');
  });

  it('dois dias, dias soltos, grupos diferentes, minutos, meia-noite e todos os dias', () => {
    expect(resumoDoHorario([f(6, '09:00', '12:00'), f(0, '09:00', '12:00')])).toBe('sábado e domingo, 9h às 12h');
    expect(resumoDoHorario([1, 3, 5].map((d) => f(d, '08:30', '11:45')))).toBe('segunda, quarta e sexta, 8h30 às 11h45');
    expect(resumoDoHorario([...[1, 2, 3].map((d) => f(d, '09:00', '18:00')), f(4, '13:00', '20:00'), f(6, '08:00', '12:00')])).toBe(
      'segunda a quarta, 9h às 18h; quinta, 13h às 20h; sábado, 8h às 12h',
    );
    expect(resumoDoHorario([f(5, '00:00', '24:00')])).toBe('sexta, 0h às 24h');
    expect(resumoDoHorario([0, 1, 2, 3, 4, 5, 6].map((d) => f(d, '08:00', '20:00')))).toBe('todos os dias, 8h às 20h');
    expect(resumoDoHorario([f(1, '09:00', '12:00'), f(1, '14:00', '18:00'), f(1, '19:00', '20:00')])).toBe('segunda, 9h às 12h, 14h às 18h e 19h às 20h');
    expect(resumoDoHorario([])).toBe('');
  });
});

describe('Plano 25 — validarFaixas (US-446, RN-451, puro)', () => {
  it('as faixas da US-446 e a 4ª faixa no mesmo dia, com os textos exatos e a faixa do erro', () => {
    expect(validarFaixas(UTEIS)).toBeNull();
    expect(validarFaixas([f(1, '09:00', '12:00'), f(2, '14:00', '12:00')])).toEqual({ erro: 'fim_antes_do_inicio', mensagem: C.fimAntesDoInicio, diaSemana: 2, indice: 1 });
    expect(validarFaixas([f(1, '09:00', '09:00')])).toMatchObject({ erro: 'fim_antes_do_inicio', mensagem: 'O fim tem de ser depois do início.' });
    expect(validarFaixas([f(1, '09:00', '12:00'), f(1, '11:00', '13:00')])).toEqual({
      erro: 'sobreposicao',
      mensagem: 'As faixas do mesmo dia não podem se sobrepor.',
      diaSemana: 1,
      indice: 1,
    });
    // encostar (12h–12h) não é sobrepor; dias diferentes não se comparam
    expect(validarFaixas([f(1, '09:00', '12:00'), f(1, '12:00', '13:00'), f(2, '11:00', '13:00')])).toBeNull();
    const quatro = [f(3, '08:00', '09:00'), f(3, '10:00', '11:00'), f(3, '12:00', '13:00'), f(3, '14:00', '15:00')];
    expect(validarFaixas(quatro)).toEqual({ erro: 'faixas_demais', mensagem: 'No máximo 3 faixas por dia.', diaSemana: 3, indice: 3 });
  });

  it('entrada fora do formulário (dia, minutos fora de 0–1440 ou fora dos 15 min, não inteiro) → Error', () => {
    for (const ruim of [f(7, '09:00', '10:00'), f(-1, '09:00', '10:00'), f(1, '09:10', '10:00'), { diaSemana: 1, inicioMin: 0, fimMin: 1455 }, { diaSemana: 1, inicioMin: 1.5, fimMin: 60 }]) {
      expect(() => validarFaixas([ruim])).toThrow('mensagens: faixa inválida');
    }
    expect(() => validarFaixas('x' as unknown as Faixa[])).toThrow('mensagens: faixa inválida');
  });
});

describe('Plano 25 — configuração no banco (RN-451, RN-458, RN-472; CH-D70)', () => {
  it('sem linha: os padrões (horário desligado, aviso por e-mail ligado, sem faixas)', async () => {
    const T = await novoTenant(app.db);
    expect(await lerConfiguracao(T.ctx, app.db)).toEqual({ horarioAtivo: false, avisoEmail: true, faixas: [] });
    const p = await novoPaciente(app.db, T.ctx);
    expect(await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => horarioParaPaciente(tx), app.db)).toEqual({ horarioAtivo: false, faixas: [] });
  });

  it('salvar grava o horário em chat_configuracoes/chat_horarios e o aviso em chat_avisos_nutri; salvar de novo troca as faixas', async () => {
    const T = await novoTenant(app.db);
    expect(await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: false, faixas: [...UTEIS].reverse() }, app.db)).toBe('ok');
    const lida = await lerConfiguracao(T.ctx, app.db);
    expect(lida.horarioAtivo).toBe(true);
    expect(lida.avisoEmail).toBe(false);
    expect(lida.faixas).toEqual(UTEIS); // em ordem de dia e de início
    const linhas = await withTenant(T.ctx, async (tx) => ({
      config: (await tx.execute(sql`select horario_ativo from chat_configuracoes`)).rows,
      aviso: (await tx.execute(sql`select aviso_email, aviso_nutri_em from chat_avisos_nutri`)).rows,
    }), app.db);
    expect(linhas).toEqual({ config: [{ horario_ativo: true }], aviso: [{ aviso_email: false, aviso_nutri_em: null }] });

    expect(await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: true, faixas: [f(6, '08:00', '12:00')] }, app.db)).toBe('ok');
    // desligado, as faixas ficam guardadas (US-446 "Horário desligado")
    expect(await lerConfiguracao(T.ctx, app.db)).toEqual({ horarioAtivo: false, avisoEmail: true, faixas: [f(6, '08:00', '12:00')] });
  });

  it('salvar não mexe na marca do último aviso (aviso_nutri_em, da função do envio)', async () => {
    const T = await novoTenant(app.db);
    await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: true, faixas: [] }, app.db);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update chat_avisos_nutri set aviso_nutri_em = '2026-11-23T10:00:00Z'`), app.db);
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: false, faixas: [] }, app.db);
    const [r] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select aviso_email, aviso_nutri_em from chat_avisos_nutri`), app.db)).rows as {
      aviso_email: boolean;
      aviso_nutri_em: Date;
    }[];
    expect(r.aviso_email).toBe(false);
    expect(new Date(r.aviso_nutri_em).toISOString()).toBe('2026-11-23T10:00:00.000Z');
  });

  it('faixas inválidas: devolve o erro e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: UTEIS }, app.db);
    const quatro = [f(3, '08:00', '09:00'), f(3, '10:00', '11:00'), f(3, '12:00', '13:00'), f(3, '14:00', '15:00')];
    expect(await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: false, faixas: quatro }, app.db)).toMatchObject({ mensagem: C.faixasDemais });
    expect(await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: false, faixas: [f(1, '14:00', '12:00')] }, app.db)).toMatchObject({
      mensagem: C.fimAntesDoInicio,
    });
    expect(await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: false, faixas: [f(1, '09:00', '12:00'), f(1, '11:00', '13:00')] }, app.db)).toMatchObject({
      mensagem: C.sobreposicao,
    });
    expect(await lerConfiguracao(T.ctx, app.db)).toEqual({ horarioAtivo: true, avisoEmail: true, faixas: UTEIS });
  });

  it('horarioParaPaciente: o paciente vê o horário, nunca o aviso à nutricionista (teste das chaves)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: false, faixas: UTEIS }, app.db);
    const h = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => horarioParaPaciente(tx), app.db);
    expect(Object.keys(h).sort()).toEqual(['faixas', 'horarioAtivo']);
    expect(JSON.stringify(h)).not.toMatch(/aviso/i);
    expect(h).toEqual({ horarioAtivo: true, faixas: UTEIS });
    for (const x of h.faixas) expect(Object.keys(x).sort()).toEqual(['diaSemana', 'fimMin', 'inicioMin']);
  });

  it('só a sessão nutri lê e salva a configuração: Error antes de abrir a transação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const ctx of [ctxPaciente(T.tenantId, p.id), { tenantId: T.tenantId, role: 'worker' as const }]) {
      const { db, transaction } = semTransacao();
      await expect(lerConfiguracao(ctx, db)).rejects.toThrow('mensagens: só a sessão nutri');
      await expect(salvarConfiguracao(ctx, { horarioAtivo: true, avisoEmail: true, faixas: [] }, db)).rejects.toThrow('mensagens: só a sessão nutri');
      expect(transaction).not.toHaveBeenCalled();
    }
  });
});
