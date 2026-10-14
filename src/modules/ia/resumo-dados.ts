import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { anamneses, anthropometry, consultationNotes, consultations, diaryEntries, energyCalcs, exams, mealItems, mealPlans, meals, type PatientRow } from '@/db/schema';
import { arredondar, casasDecimais, formatarDecimal } from '@/lib/numero';
import { formatarData, hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import type { Categoria } from './campos-enviados';
import { mascarar, respostasMascaradas, textoLivre, type AlvoDaMascara } from './pseudonimizar';
import type { Fonte, LinhaDadosUsados } from './tipos';

export type { Fonte, LinhaDadosUsados };
export type PedidoDoResumo = {
  /** O que sai para a IA: só as categorias de CATEGORIAS_POR_USO.resumo_historico. */
  dados: Partial<Record<Categoria, unknown>>;
  /** '#n' → rótulo do registro (fica na tarefa; a tela troca o índice pelo rótulo). Nunca sai para a IA. */
  fontes: Fonte[];
  /** "Dados usados" (US-120), calculada pelo sistema. Nunca sai para a IA. */
  tabela: LinhaDadosUsados[];
  /** D11: SHA-256 (hex) dos registros usados + nascimento, sexo e a escolha das notas. */
  carimbo: string;
  /** Tamanho do JSON de `dados` em bytes (UTF-8): a base da reserva (D12). */
  bytes: number;
  /** Nenhum registro do prontuário (só idade e sexo): "Ainda não há histórico para resumir." */
  vazio: boolean;
};

const DIAS_DO_DIARIO = 30;
const CATEGORIAS_DE_REGISTRO: readonly Categoria[] = ['medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas'];

/**
 * Plano 14B (RN-120, D10, D11): o que sai no resumo — só as categorias de CATEGORIAS_POR_USO.resumo_historico (o teste
 * campos-enviados.test.ts confere), cada registro com um índice local "#n" (a tela troca pelo rótulo de `fontes`), sem id
 * do banco, sem campo do cadastro (idade no lugar do nascimento), sem a faixa de referência nem o título dos exames
 * (A-D17), diário sem foto e sem o comentário da nutricionista (A-D8), notas só com a caixa; todo texto livre pela
 * máscara (RN-115). Datas de instantes (cálculo, diário, publicação) no fuso do consultório (RN-06). Lê dentro do
 * withTenant de quem chama (app no pedido, worker no portão); não devolve nada à tela (sem auditRead).
 */
export async function montarPedidoDoResumo(tx: Tx, p: PatientRow, o: { notasPrivadas: boolean; agora: Date; fuso: string }): Promise<PedidoDoResumo> {
  const alvo: AlvoDaMascara = { nome: p.nome, email: p.email, telefone: p.telefoneE164 };
  const fontes: Fonte[] = [];
  const marcas: string[] = [];
  const indice = (rotulo: string, tabela: string, id: string, atualizado: Date) => {
    marcas.push(`${tabela}:${id}:${atualizado.toISOString()}`);
    const i = `#${fontes.length + 1}`;
    fontes.push({ indice: i, rotulo });
    return i;
  };
  const diaNoFuso = (d: Date) => hojeNoFuso(o.fuso, d);

  const ant = (
    await tx.select().from(anthropometry).where(eq(anthropometry.patientId, p.id)).orderBy(desc(anthropometry.data), desc(anthropometry.createdAt)).limit(10)
  ).reverse();
  const calc = (await tx.select().from(energyCalcs).where(eq(energyCalcs.patientId, p.id)).orderBy(desc(energyCalcs.createdAt)).limit(3)).reverse();
  const exs = (
    await tx
      .select()
      .from(exams)
      .where(and(eq(exams.patientId, p.id), sql`jsonb_array_length(${exams.valores}) > 0`))
      .orderBy(desc(exams.data), desc(exams.createdAt))
      .limit(10)
  ).reverse();
  const [ana] = await tx.select().from(anamneses).where(eq(anamneses.patientId, p.id)).orderBy(desc(anamneses.data), desc(anamneses.createdAt)).limit(1);
  const ats = (
    await tx.select().from(consultations).where(eq(consultations.patientId, p.id)).orderBy(desc(consultations.data), desc(consultations.createdAt)).limit(10)
  ).reverse();
  const notas =
    o.notasPrivadas && ats.length
      ? await tx
          .select()
          .from(consultationNotes)
          .where(and(eq(consultationNotes.patientId, p.id), inArray(consultationNotes.consultationId, ats.map((a) => a.id))))
      : [];
  const [pub] = await tx.select().from(mealPlans).where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'publicado')));
  const desde = new Date(o.agora.getTime() - DIAS_DO_DIARIO * 86_400_000);
  const dia = (
    await tx.select().from(diaryEntries).where(and(eq(diaryEntries.patientId, p.id), gte(diaryEntries.dataHora, desde))).orderBy(desc(diaryEntries.dataHora))
  ).reverse();

  const dados: Partial<Record<Categoria, unknown>> = {
    idade: p.dataNascimento ? idadeEm(p.dataNascimento, hojeNoFuso(o.fuso, o.agora)) : null,
    sexo: p.sexo ?? null,
  };
  if (ant.length) {
    dados.medidas = ant.map((a) => ({
      indice: indice(`antropometria de ${formatarData(a.data)}`, 'anthropometry', a.id, a.updatedAt),
      data: a.data,
      peso_kg: a.pesoKg,
      altura_cm: a.alturaCm,
      imc: a.imc,
      gordura_pct: a.percGordura,
      circunferencias_cm: a.circunferencias,
    }));
  }
  if (calc.length) {
    dados.gasto = calc.map((c) => {
      const data = diaNoFuso(c.createdAt);
      // energy_calcs não tem updated_at (o cálculo não é editado): o created_at marca o registro (D11)
      return {
        indice: indice(`cálculo de gasto energético de ${formatarData(data)}`, 'energy_calcs', c.id, c.createdAt),
        data,
        formula: c.formula,
        fator_atividade: c.fatorAtividade,
        tmb_kcal: Math.round(c.tmb),
        get_kcal: Math.round(c.get),
      };
    });
  }
  if (exs.length) {
    dados.exames = exs.map((e) => ({
      indice: indice(`exame de ${formatarData(e.data)}`, 'exams', e.id, e.updatedAt),
      data: e.data,
      // A-D17: sem a faixa de referência; sem o título (texto livre que não é preciso) nem o id da tarefa de IA
      valores: e.valores.map((v) => ({ marcador: mascarar(v.nome, alvo), valor: v.valor, unidade: v.unidade })),
    }));
  }
  if (ana) {
    dados.anamnese = { indice: indice(`anamnese de ${formatarData(ana.data)}`, 'anamneses', ana.id, ana.updatedAt), data: ana.data, respostas: respostasMascaradas(ana, alvo) };
  }
  const comOrientacao = ats.filter((a) => a.orientacoesPaciente?.trim());
  if (comOrientacao.length) {
    dados.orientacoes = comOrientacao.map((a) => ({
      indice: indice(`atendimento de ${formatarData(a.data)}`, 'consultations', a.id, a.updatedAt),
      data: a.data,
      texto: textoLivre(a.orientacoesPaciente, alvo),
    }));
  }
  if (pub) {
    const rs = await tx.select().from(meals).where(eq(meals.planId, pub.id)).orderBy(meals.ordem);
    const its = await tx.select().from(mealItems).where(eq(mealItems.planId, pub.id)).orderBy(mealItems.ordem);
    const publicadoEm = diaNoFuso(pub.publicadoEm ?? pub.updatedAt);
    // sem o título do plano (texto livre que não é preciso); só os itens principais (as substituições ficam de fora)
    dados.plano = {
      indice: indice(`plano publicado em ${formatarData(publicadoEm)}`, 'meal_plans', pub.id, pub.updatedAt),
      publicado_em: publicadoEm,
      refeicoes: rs.map((r) => ({
        nome: textoLivre(r.nome, alvo),
        horario: r.horario?.slice(0, 5) ?? null,
        itens: its.filter((i) => i.mealId === r.id && !i.substituiItemId).map((i) => ({ alimento: i.nutrientes?.nome ?? null, gramas: i.quantidadeG })),
      })),
      orientacoes: textoLivre(pub.orientacoes, alvo),
    };
  }
  if (dia.length) {
    dados.diario = dia.map((d) => {
      const data = diaNoFuso(d.dataHora);
      // A-D8: sem a foto e sem o comentário da nutricionista
      return { indice: indice(`diário de ${formatarData(data)}`, 'diary_entries', d.id, d.updatedAt), data, refeicao: d.refeicao, resposta: d.resposta, texto: textoLivre(d.texto, alvo) };
    });
  }
  if (notas.length) {
    const ordem = new Map(ats.map((a, i) => [a.id, i]));
    const dataDe = new Map(ats.map((a) => [a.id, a.data]));
    dados.notas = [...notas]
      .sort((a, b) => ordem.get(a.consultationId)! - ordem.get(b.consultationId)!)
      .map((x) => ({
        indice: indice(`nota privada de ${formatarData(dataDe.get(x.consultationId)!)}`, 'consultation_notes', x.id, x.updatedAt),
        data: dataDe.get(x.consultationId)!,
        texto: textoLivre(x.texto, alvo),
      }));
  }
  const vazio = !CATEGORIAS_DE_REGISTRO.some((k) => k in dados);
  const carimbo = createHash('sha256')
    .update([...marcas.sort(), `nasc:${p.dataNascimento ?? ''}`, `sexo:${p.sexo ?? ''}`, `notas:${o.notasPrivadas}`].join('\n'))
    .digest('hex');
  return { dados, fontes, tabela: tabelaDadosUsados(ant, exs), carimbo, bytes: Buffer.byteLength(JSON.stringify(dados), 'utf8'), vazio };
}

const sinal = (d: number) => (d > 0 ? '+' : d < 0 ? '−' : '');
const num = (v: number) => formatarDecimal(v, casasDecimais(v));

/** US-120 "Dados usados": do primeiro ao último dos registros enviados, com a diferença calculada pelo sistema. */
function tabelaDadosUsados(ant: (typeof anthropometry.$inferSelect)[], exs: (typeof exams.$inferSelect)[]): LinhaDadosUsados[] {
  const linha = (rotulo: string, unidade: string, a: { v: number; d: string }, b: { v: number; d: string }): LinhaDadosUsados => {
    // a diferença com as casas do valor mais preciso (82,4 → 78,9 dá −3,5, sem o resto da conta em ponto flutuante)
    const dif = arredondar(b.v - a.v, Math.max(casasDecimais(a.v), casasDecimais(b.v)));
    const u = unidade ? ` ${unidade}` : '';
    return { rotulo, texto: `${num(a.v)}${u} em ${formatarData(a.d)} → ${num(b.v)}${u} em ${formatarData(b.d)} (${sinal(dif)}${num(Math.abs(dif))}${u})` };
  };
  const out: LinhaDadosUsados[] = [];
  if (ant.length >= 2) {
    const [a, b] = [ant[0], ant.at(-1)!];
    out.push(linha('Peso', 'kg', { v: a.pesoKg, d: a.data }, { v: b.pesoKg, d: b.data }));
    if (a.imc !== null && b.imc !== null) out.push(linha('IMC', 'kg/m²', { v: a.imc, d: a.data }, { v: b.imc, d: b.data }));
    const g = ant.filter((x) => x.percGordura !== null);
    if (g.length >= 2) out.push(linha('Gordura corporal', '%', { v: g[0].percGordura!, d: g[0].data }, { v: g.at(-1)!.percGordura!, d: g.at(-1)!.data }));
  }
  const series = new Map<string, { nome: string; unidade: string; pontos: { v: number; d: string }[] }>();
  for (const e of exs) {
    for (const v of e.valores) {
      const k = `${v.nome}|${v.unidade ?? ''}`;
      const s = series.get(k) ?? { nome: v.nome, unidade: v.unidade ?? '', pontos: [] };
      s.pontos.push({ v: v.valor, d: e.data });
      series.set(k, s);
    }
  }
  for (const s of series.values()) if (s.pontos.length >= 2) out.push(linha(s.nome, s.unidade, s.pontos[0], s.pontos.at(-1)!));
  return out;
}
