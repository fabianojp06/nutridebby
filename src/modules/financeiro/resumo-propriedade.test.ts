import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import { finConfiguracoes, finLancamentos, type TipoLancamento } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { listarCategorias, salvarConfiguracoes } from './configuracoes';
import { MSG_FINANCEIRO } from './constantes';
import { csvLancamentos } from './csv';
import { listarLancamentos } from './lancamentos';
import { intervaloDoMes, mesDe, mesesDoAno, ultimos12Meses } from './meses';
import { entradasESaidas12Meses, fluxoDeCaixaDoAno, resumoDoMes } from './resumo';
import { ROTULO_SITUACAO } from './situacao';

/**
 * CS-301: os totais do Resumo, do fluxo de caixa, dos 12 meses e do CSV do mês batem, centavo a centavo, com a soma feita
 * em memória — com lançamentos aleatórios nas bordas (dia 1º, último dia do mês, "hoje" às 00:00 e às 23:59 em São Paulo
 * com o servidor em UTC, cancelados, pagos antes do saldo do caixa). Semente fixa: a mesma sequência em toda execução.
 * Cada rodada grava em lote e confere dentro de UMA transação desfeita no fim (as funções abrem a delas como savepoint),
 * sem banco novo. 200 rodadas cabem com folga no tempo (≈ 20 s nesta VPS); se passar de ~60 s, reduzir para 50.
 */
const SEMENTE = 20261117;
const RODADAS = 200;

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

/** mulberry32: gerador pequeno e determinístico. */
function gerador(semente: number) {
  let a = semente >>> 0;
  const proximo = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inteiro = (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1));
  return { chance: (p: number) => proximo() < p, inteiro, um: <T>(xs: readonly T[]): T => xs[inteiro(0, xs.length - 1)] };
}

const p2 = (n: number) => String(n).padStart(2, '0');
const dia = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
const somarDias = (d: string, n: number) => dia(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)));
const somarMeses = (mes: string, n: number) => mesDe(dia(new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1 + n, 1))));

type Gerado = { tipo: TipoLancamento; categoria: string; valor: number; vencimento: string; pagoEm: string | null; paciente: string | null; cancelado: boolean };

let T: TenantDeTeste;
let categorias: { id: string; nome: string; tipo: TipoLancamento }[];
let pacientes: string[];

beforeAll(async () => {
  T = await novoTenant(app.db);
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2025-01-01', saldoInicial: '0' }, { db: app.db, agora: new Date('2026-06-01T12:00:00Z') });
  const todas = await listarCategorias(T.ctx, { db: app.db });
  const nomes = ['Consultas', 'Outras entradas', 'Aluguel e condomínio', 'Material e insumos', 'Divulgação'];
  categorias = todas.filter((c) => nomes.includes(c.nome)).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }));
  pacientes = [];
  for (const nome of ['Ana Souza', 'Bruno Lima', 'Carla Dias']) pacientes.push((await novoPaciente(app.db, T.ctx, { nome })).id);
});

/** Uma rodada: "hoje" (com a hora local), o saldo do caixa e os lançamentos. */
function sortear(r: ReturnType<typeof gerador>) {
  const mesDeHoje = `${r.inteiro(2025, 2027)}-${p2(r.inteiro(1, 12))}`;
  const { ate: ultimoDeHoje } = intervaloDoMes(mesDeHoje);
  const ultimo = +ultimoDeHoje.slice(8);
  const hoje = `${mesDeHoje}-${p2(r.um([1, 1, ultimo, ultimo, r.inteiro(2, ultimo - 1)]))}`;
  // São Paulo sem horário de verão desde 2019: UTC−3. 00:00 e 23:59 locais são o dia seguinte/anterior em UTC nas bordas
  const agora = new Date(`${hoje}T${r.um(['00:00', '23:59', '12:00'])}:00-03:00`);
  const saldoInicialEm = r.um([hoje, `${mesDeHoje}-01`, somarDias(hoje, -r.inteiro(1, 400))]);
  const saldo = r.inteiro(-1_000_000_000, 1_000_000_000);
  // datas candidatas: dia 1º, último dia e um dia qualquer de cada mês de 13 meses antes a 2 depois, mais hoje e o saldo ±1
  const candidatas = [hoje, somarDias(hoje, -1), somarDias(hoje, 1), saldoInicialEm, somarDias(saldoInicialEm, -1)];
  for (let i = -13; i <= 2; i++) {
    const m = intervaloDoMes(somarMeses(mesDeHoje, i));
    candidatas.push(m.de, m.ate, `${m.de.slice(0, 8)}${p2(r.inteiro(2, 27))}`);
  }
  const ateHoje = candidatas.filter((d) => d <= hoje);
  const lancamentos: Gerado[] = Array.from({ length: r.inteiro(5, 40) }, () => {
    const tipo: TipoLancamento = r.chance(0.5) ? 'entrada' : 'saida';
    return {
      tipo,
      categoria: r.um(categorias.filter((c) => c.tipo === tipo)).id,
      valor: r.chance(0.3) ? r.inteiro(1, 999) : r.inteiro(1, 100_000_000),
      vencimento: r.um(candidatas),
      pagoEm: r.chance(0.55) ? r.um(ateHoje) : null,
      paciente: tipo === 'entrada' && r.chance(0.6) ? r.um(pacientes) : null,
      cancelado: r.chance(0.15),
    };
  });
  return { hoje, agora, saldo, saldoInicialEm, lancamentos };
}

const soma = (ls: Gerado[]) => ls.reduce((a, l) => a + l.valor, 0);
const comSinal = (ls: Gerado[]) => ls.reduce((a, l) => a + (l.tipo === 'entrada' ? l.valor : -l.valor), 0);

/** As linhas do CSV (com nomes) como [tipo, valor em centavos, situação]. */
function lerCsv(csv: string): { tipo: string; valor: number; situacao: string }[] {
  const linhas = csv.replace(/^﻿/, '').split('\r\n').slice(1, -1);
  return linhas.map((l) => {
    const c = l.split(';');
    const [reais, cent] = c[7].replace('-', '').split(',');
    return { tipo: c[2], valor: Number(reais) * 100 + Number(cent), situacao: c[8] };
  });
}

class Desfazer extends Error {}

describe('CS-301 — propriedade: os agregados batem com a soma em memória', () => {
  it(`${RODADAS} rodadas (semente ${SEMENTE})`, { timeout: 180_000 }, async () => {
    const r = gerador(SEMENTE);
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const s = sortear(r);
      const contexto = `rodada ${rodada}: hoje ${s.hoje} (${s.agora.toISOString()}), saldo ${s.saldo} em ${s.saldoInicialEm}`;
      await withTenant(
        T.ctx,
        async (tx) => {
          await tx.update(finConfiguracoes).set({ saldoInicialCentavos: s.saldo, saldoInicialEm: s.saldoInicialEm }).where(eq(finConfiguracoes.tenantId, T.tenantId));
          const ids = await tx
            .insert(finLancamentos)
            .values(
              s.lancamentos.map((l) => ({
                tenantId: T.tenantId,
                tipo: l.tipo,
                categoriaId: l.categoria,
                valorCentavos: l.valor,
                vencimento: l.vencimento,
                pagoEm: l.pagoEm,
                formaPagamento: l.pagoEm ? ('pix' as const) : null,
                patientId: l.paciente,
                criadoPor: T.nutriId,
              })),
            )
            .returning({ id: finLancamentos.id });
          const cancelados = ids.filter((_, i) => s.lancamentos[i].cancelado).map((x) => x.id);
          if (cancelados.length)
            await tx.update(finLancamentos).set({ canceladoEm: s.agora, canceladoPor: T.nutriId, motivoCancelamento: 'Teste' }).where(inArray(finLancamentos.id, cancelados));
          await conferir(tx as unknown as Db, s, contexto);
          throw new Desfazer();
        },
        app.db,
      ).catch((e: unknown) => {
        if (!(e instanceof Desfazer)) throw e;
      });
    }
  });
});

async function conferir(db: Db, s: ReturnType<typeof sortear>, contexto: string) {
  const deps = { db, agora: s.agora };
  const ativos = s.lancamentos.filter((l) => !l.cancelado);
  const pagos = ativos.filter((l) => l.pagoEm !== null);
  const abertos = ativos.filter((l) => l.pagoEm === null);
  const de = (tipo: TipoLancamento, ls: Gerado[]) => ls.filter((l) => l.tipo === tipo);
  const mes = mesDe(s.hoje);
  const { de: inicio, ate: fim } = intervaloDoMes(mes);
  const noMes = (d: string) => d >= inicio && d <= fim;
  const desdeOSaldo = (ate: string, antes = false) => comSinal(pagos.filter((l) => l.pagoEm! >= s.saldoInicialEm && (antes ? l.pagoEm! < ate : l.pagoEm! <= ate)));

  // Resumo do mês de hoje (RN-306, RN-307)
  const resumo = await resumoDoMes(T.ctx, T.tenant, deps);
  const cartao = (tipo: TipoLancamento) => ({
    pago: soma(de(tipo, pagos).filter((l) => noMes(l.pagoEm!))),
    aberto: soma(de(tipo, abertos).filter((l) => noMes(l.vencimento))),
    atraso: soma(de(tipo, abertos).filter((l) => l.vencimento < inicio)),
  });
  const ent = cartao('entrada');
  const sai = cartao('saida');
  const pendentes = abertos.filter((l) => l.paciente);
  expect(resumo, contexto).toMatchObject({
    configurado: true,
    saldoAtual: s.saldo + comSinal(pagos.filter((l) => l.pagoEm! >= s.saldoInicialEm)),
    saldoDesde: s.saldoInicialEm,
    entradas: { recebido: ent.pago, aReceber: ent.aberto, atrasoAnterior: ent.atraso },
    saidas: { pago: sai.pago, aPagar: sai.aberto, atrasoAnterior: sai.atraso },
    pendentes: { pacientes: new Set(pendentes.map((l) => l.paciente)).size, total: soma(pendentes) },
  });

  // CSV do mês (RN-321), montado com as linhas da lista do mês: os valores somados por situação batem com os cartões
  const lista = await listarLancamentos(T.ctx, T.tenant, { mes }, deps);
  const csv = lerCsv(
    csvLancamentos(
      lista.linhas.map((l) => ({
        vencimento: l.vencimento,
        pagoEm: l.pagoEm,
        tipo: l.tipo,
        categoria: l.categoria.nome,
        descricao: l.descricao,
        paciente: l.paciente?.nome ?? null,
        forma: l.forma,
        valorCentavos: l.valorCentavos,
        situacao: l.situacao,
      })),
      { comPacientes: true },
    ),
  );
  const S = ROTULO_SITUACAO;
  const T_ = MSG_FINANCEIRO.csv.tipos;
  const somaCsv = (f: (x: (typeof csv)[number]) => boolean) => csv.filter(f).reduce((a, x) => a + x.valor, 0);
  expect(csv.length, contexto).toBe(s.lancamentos.filter((l) => noMes(l.pagoEm ?? l.vencimento)).length);
  expect(somaCsv((x) => x.situacao === S.recebido), contexto).toBe(ent.pago);
  expect(somaCsv((x) => x.situacao === S.pago), contexto).toBe(sai.pago);
  expect(somaCsv((x) => x.tipo === T_.entrada && (x.situacao === S.previsto || x.situacao === S.em_atraso)), contexto).toBe(ent.aberto);
  expect(somaCsv((x) => x.tipo === T_.saida && (x.situacao === S.previsto || x.situacao === S.em_atraso)), contexto).toBe(sai.aberto);

  // 12 meses: só recebidos e pagos, pela data do pagamento
  const doze = await entradasESaidas12Meses(T.ctx, T.tenant, deps);
  expect(
    doze,
    contexto,
  ).toEqual(
    ultimos12Meses(s.hoje).map((m) => {
      const e = soma(de('entrada', pagos).filter((l) => mesDe(l.pagoEm!) === m));
      const x = soma(de('saida', pagos).filter((l) => mesDe(l.pagoEm!) === m));
      return { mes: m, entradas: e, saidas: x, resultado: e - x };
    }),
  );

  // fluxo de caixa do ano de hoje e do ano do saldo (US-306)
  for (const ano of new Set([+s.hoje.slice(0, 4), +s.saldoInicialEm.slice(0, 4)])) {
    const f = await fluxoDeCaixaDoAno(T.ctx, T.tenant, ano, deps);
    const meses = mesesDoAno(ano);
    const porMes = (ls: Gerado[]) => meses.map((m) => soma(ls.filter((l) => mesDe(l.pagoEm!) === m)));
    for (const c of [...f.categoriasEntrada, ...f.categoriasSaida]) {
      const cat = categorias.find((x) => x.nome === c.categoria);
      expect(c.valores, `${contexto} — ${c.categoria} ${ano}`).toEqual(porMes(cat ? pagos.filter((l) => l.categoria === cat.id) : []));
    }
    expect(f.totalEntradas, contexto).toEqual(porMes(de('entrada', pagos)));
    expect(f.totalSaidas, contexto).toEqual(porMes(de('saida', pagos)));
    expect(f.resultado, contexto).toEqual(f.totalEntradas.map((e, i) => e - f.totalSaidas[i]));
    const mesDoSaldo = mesDe(s.saldoInicialEm);
    meses.forEach((m, i) => {
      const { de: d1, ate: d2 } = intervaloDoMes(m);
      if (m < mesDoSaldo) {
        expect([f.saldoInicio[i], f.saldoFim[i]], `${contexto} — ${m}`).toEqual([null, null]);
      } else if (m === mesDoSaldo) {
        expect([f.saldoInicio[i], f.saldoFim[i]], `${contexto} — ${m}`).toEqual([null, s.saldo + desdeOSaldo(d2)]);
      } else {
        expect([f.saldoInicio[i], f.saldoFim[i]], `${contexto} — ${m}`).toEqual([s.saldo + desdeOSaldo(d1, true), s.saldo + desdeOSaldo(d2)]);
        expect(f.saldoFim[i], `${contexto} — ${m}`).toBe(f.saldoInicio[i]! + f.resultado[i]);
      }
    });
  }
}
