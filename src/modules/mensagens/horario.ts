/**
 * Plano 25 (US-446, RN-451, RN-458, RN-472; CH-D70): o horário de atendimento por mensagens e a preferência do aviso por
 * e-mail. `chat_configuracoes` (`horario_ativo`) e `chat_horarios` (as faixas) a sessão de paciente também lê;
 * `chat_avisos_nutri` (`aviso_email`, `aviso_nutri_em`) é staff_only. `dentroDoHorario`, `resumoDoHorario` e
 * `validarFaixas` são puros.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { chatAvisosNutri, chatConfiguracoes, chatHorarios } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { FIM_DO_DIA_MIN, MAX_FAIXAS_POR_DIA, MSG_MENSAGENS, PASSO_FAIXA_MIN } from './constantes';
import { exigirNutri } from './sessao';

/** Uma faixa do horário, em minutos do dia no fuso do consultório (0 = domingo … 6 = sábado; fim 1440 = "24:00"). */
export type Faixa = { diaSemana: number; inicioMin: number; fimMin: number };
/** Erro de validação de uma faixa: `indice` é a posição na lista enviada (a tela põe o texto junto da faixa). */
export type ErroDeFaixa = {
  erro: 'fim_antes_do_inicio' | 'sobreposicao' | 'faixas_demais';
  mensagem: string;
  diaSemana: number;
  indice: number;
};
export type ConfiguracaoDasMensagens = { horarioAtivo: boolean; avisoEmail: boolean; faixas: Faixa[] };
export type HorarioParaPaciente = { horarioAtivo: boolean; faixas: Faixa[] };

const C = MSG_MENSAGENS.configuracao;

const inteiroEntre = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * US-446 e RN-451: `inicio < fim`, no máximo 3 faixas por dia e sem sobreposição no mesmo dia (encostar não é sobrepor).
 * Devolve o primeiro erro, na ordem da lista, ou null. Entrada que o formulário não produz (dia fora de 0–6, minutos fora
 * de 0–1440 ou fora do passo de 15 min, valor que não é inteiro) é adulteração: Error, sem texto de tela.
 */
export function validarFaixas(faixas: readonly Faixa[]): ErroDeFaixa | null {
  if (!Array.isArray(faixas)) throw new Error('mensagens: faixa inválida');
  for (const x of faixas) {
    const ok =
      typeof x === 'object' &&
      x !== null &&
      inteiroEntre(x.diaSemana, 0, 6) &&
      inteiroEntre(x.inicioMin, 0, FIM_DO_DIA_MIN) &&
      inteiroEntre(x.fimMin, 0, FIM_DO_DIA_MIN) &&
      x.inicioMin % PASSO_FAIXA_MIN === 0 &&
      x.fimMin % PASSO_FAIXA_MIN === 0;
    if (!ok) throw new Error('mensagens: faixa inválida');
  }
  const porDia = new Map<number, { inicioMin: number; fimMin: number; indice: number }[]>();
  for (const [indice, x] of faixas.entries()) {
    const erro = (e: ErroDeFaixa['erro'], mensagem: string): ErroDeFaixa => ({ erro: e, mensagem, diaSemana: x.diaSemana, indice });
    if (x.fimMin <= x.inicioMin) return erro('fim_antes_do_inicio', C.fimAntesDoInicio);
    const doDia = porDia.get(x.diaSemana) ?? [];
    if (doDia.length >= MAX_FAIXAS_POR_DIA) return erro('faixas_demais', C.faixasDemais);
    if (doDia.some((o) => x.inicioMin < o.fimMin && o.inicioMin < x.fimMin)) return erro('sobreposicao', C.sobreposicao);
    doDia.push({ inicioMin: x.inicioMin, fimMin: x.fimMin, indice });
    porDia.set(x.diaSemana, doDia);
  }
  return null;
}

/** RN-451: o instante cai numa faixa do dia da semana, no fuso do consultório (o fim não entra). Puro. */
export function dentroDoHorario(faixas: readonly Faixa[], fuso: string, agora: Date): boolean {
  const { diaSemana, minutos } = partesNoFuso(agora, fuso);
  return faixas.some((x) => x.diaSemana === diaSemana && x.inicioMin <= minutos && minutos < x.fimMin);
}

const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
/** A semana do resumo começa na segunda ("segunda a sexta"; "sábado e domingo"). */
const ORDEM = [1, 2, 3, 4, 5, 6, 0] as const;

const hora = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const lista = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/** Dias (posições em ORDEM) → "segunda a sexta", "sábado e domingo", "segunda, quarta e sexta". */
function rotuloDosDias(posicoes: number[]): string {
  if (posicoes.length === 7) return 'todos os dias';
  const sequencias: number[][] = [];
  for (const p of posicoes) {
    const ultima = sequencias[sequencias.length - 1];
    if (ultima && ultima[ultima.length - 1] === p - 1) ultima.push(p);
    else sequencias.push([p]);
  }
  const partes = sequencias.flatMap((s) => {
    const nome = (p: number) => NOMES[ORDEM[p]];
    if (s.length >= 3) return [`${nome(s[0])} a ${nome(s[s.length - 1])}`];
    return s.map(nome);
  });
  return lista(partes);
}

/**
 * §6.2 e US-446: "segunda a sexta, 9h às 12h e 14h às 18h". Dias seguidos com as mesmas faixas viram "X a Y"; grupos com
 * faixas diferentes, separados por "; ". Sem faixas: '' (a tela mostra "Sua nutricionista ainda não definiu…"). Puro.
 */
export function resumoDoHorario(faixas: readonly Faixa[]): string {
  const porDia = new Map<number, string>();
  for (const d of ORDEM) {
    const doDia = faixas.filter((x) => x.diaSemana === d).sort((a, b) => a.inicioMin - b.inicioMin);
    if (doDia.length) porDia.set(d, lista(doDia.map((x) => `${hora(x.inicioMin)} às ${hora(x.fimMin)}`)));
  }
  const grupos = new Map<string, number[]>(); // faixas do dia → posições em ORDEM, na ordem da semana
  ORDEM.forEach((d, posicao) => {
    const chave = porDia.get(d);
    if (chave !== undefined) grupos.set(chave, [...(grupos.get(chave) ?? []), posicao]);
  });
  return [...grupos].map(([horas, posicoes]) => `${rotuloDosDias(posicoes)}, ${horas}`).join('; ');
}

const ordenar = (faixas: Faixa[]) => [...faixas].sort((a, b) => a.diaSemana - b.diaSemana || a.inicioMin - b.inicioMin);

async function faixasDoConsultorio(tx: Tx): Promise<Faixa[]> {
  return tx
    .select({ diaSemana: chatHorarios.diaSemana, inicioMin: chatHorarios.inicioMin, fimMin: chatHorarios.fimMin })
    .from(chatHorarios)
    .where(sql`${chatHorarios.tenantId} = app_current_tenant()`)
    .orderBy(asc(chatHorarios.diaSemana), asc(chatHorarios.inicioMin));
}

/** RN-472: a tela de configuração. Sem linha, os padrões: horário desligado, aviso por e-mail ligado, sem faixas. */
export async function lerConfiguracao(ctx: TenantContext, db: Db = getDb()): Promise<ConfiguracaoDasMensagens> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const [config] = await tx.select({ horarioAtivo: chatConfiguracoes.horarioAtivo }).from(chatConfiguracoes).where(eq(chatConfiguracoes.tenantId, ctx.tenantId));
      const [aviso] = await tx.select({ avisoEmail: chatAvisosNutri.avisoEmail }).from(chatAvisosNutri).where(eq(chatAvisosNutri.tenantId, ctx.tenantId));
      return { horarioAtivo: config?.horarioAtivo ?? false, avisoEmail: aviso?.avisoEmail ?? true, faixas: await faixasDoConsultorio(tx) };
    },
    db,
  );
}

/**
 * US-446: grava o horário (chat_configuracoes + chat_horarios) e a preferência do aviso (chat_avisos_nutri, CH-D70). A linha
 * da configuração é criada se faltar e travada (FOR UPDATE) antes de trocar as faixas (apaga e regrava), para duas gravações
 * ao mesmo tempo não se misturarem; a do aviso, por upsert (a linha fica travada pelo próprio UPDATE), sem tocar na marca
 * `aviso_nutri_em` (de app_chat_aviso_nutri_devido). Faixas inválidas: o erro, sem abrir a transação. O EXCLUDE de
 * chat_horarios é a rede da sobreposição.
 */
export async function salvarConfiguracao(ctx: TenantContext, i: ConfiguracaoDasMensagens, db: Db = getDb()): Promise<'ok' | ErroDeFaixa> {
  exigirNutri(ctx);
  if (typeof i?.horarioAtivo !== 'boolean' || typeof i.avisoEmail !== 'boolean') throw new Error('mensagens: configuração inválida');
  const erro = validarFaixas(i.faixas);
  if (erro) return erro;
  const faixas = ordenar(i.faixas);
  await withTenant(
    ctx,
    async (tx) => {
      await tx.insert(chatConfiguracoes).values({ tenantId: ctx.tenantId }).onConflictDoNothing();
      await tx.select({ t: chatConfiguracoes.tenantId }).from(chatConfiguracoes).where(eq(chatConfiguracoes.tenantId, ctx.tenantId)).for('update');
      await tx.update(chatConfiguracoes).set({ horarioAtivo: i.horarioAtivo, updatedAt: sql`now()` }).where(eq(chatConfiguracoes.tenantId, ctx.tenantId));
      await tx.delete(chatHorarios).where(eq(chatHorarios.tenantId, ctx.tenantId));
      if (faixas.length) await tx.insert(chatHorarios).values(faixas.map((x) => ({ tenantId: ctx.tenantId, ...x })));
      await tx
        .insert(chatAvisosNutri)
        .values({ tenantId: ctx.tenantId, avisoEmail: i.avisoEmail })
        .onConflictDoUpdate({ target: chatAvisosNutri.tenantId, set: { avisoEmail: i.avisoEmail, updatedAt: sql`now()` } });
    },
    db,
  );
  return 'ok';
}

/**
 * RN-472 (CH-D70): o horário que o portal mostra, na transação do chamador (sessão de paciente com conta ou `nutri`). Só
 * `horario_ativo` e as faixas — nada do aviso à nutricionista (teste das chaves). Sem linha, desligado.
 */
export async function horarioParaPaciente(tx: Tx): Promise<HorarioParaPaciente> {
  const [config] = await tx.select({ horarioAtivo: chatConfiguracoes.horarioAtivo }).from(chatConfiguracoes).where(sql`${chatConfiguracoes.tenantId} = app_current_tenant()`);
  return { horarioAtivo: config?.horarioAtivo ?? false, faixas: await faixasDoConsultorio(tx) };
}
