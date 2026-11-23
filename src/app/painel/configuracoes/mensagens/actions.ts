'use server';

import { randomBytes, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { salvarConfiguracao, type ConfiguracaoDasMensagens, type Faixa } from '@/modules/mensagens/horario';

/** O erro junto à faixa: o dia (0 = domingo) e a posição dela no dia (1, 2, 3…), com o texto exato da §6.2. */
export type ErroNaFaixa = { dia: number; k: number; mensagem: string };
/** O que volta ao formulário no erro: a configuração enviada (nada se perde) e o erro; `marca` remonta o formulário. */
export type EstadoDoHorario = { marca: string; erro: ErroNaFaixa; config: ConfiguracaoDasMensagens };

const CAMINHO = '/painel/configuracoes/mensagens';
/** Inteiro em texto (o `value` dos `<select>`); fora disso, adulteração. */
const minutos = (v: FormDataEntryValue): number => {
  if (typeof v !== 'string' || !/^\d{1,4}$/.test(v)) throw new Error('mensagens: faixa inválida');
  return Number(v);
};

/**
 * As faixas do formulário, dia a dia (0 = domingo … 6 = sábado) e na ordem da tela: `inicio-{dia}` e `fim-{dia}` repetidos,
 * um par por faixa. Par incompleto ou valor que o `<select>` não produz → Error (o módulo também recusa o passo errado).
 */
function faixasDoFormulario(dados: FormData): Faixa[] {
  const faixas: Faixa[] = [];
  for (let dia = 0; dia <= 6; dia++) {
    const inicios = dados.getAll(`inicio-${dia}`);
    const fins = dados.getAll(`fim-${dia}`);
    if (inicios.length !== fins.length) throw new Error('mensagens: faixa inválida');
    inicios.forEach((v, i) => faixas.push({ diaSemana: dia, inicioMin: minutos(v), fimMin: minutos(fins[i]) }));
  }
  return faixas;
}

/**
 * US-446 (RN-451, RN-472): grava o horário e o aviso por e-mail. Erro de faixa → o texto da §6.2 junto à faixa e o que foi
 * enviado de volta (nada gravado). Gravou → a tela com "Configuração salva." (`?ok=salva`; `r` muda a cada gravação, para
 * a região anunciar de novo).
 */
export async function salvarHorarioAction(_anterior: EstadoDoHorario | null, dados: FormData): Promise<EstadoDoHorario> {
  const { ctx } = await requireNutri(CAMINHO);
  const config: ConfiguracaoDasMensagens = { horarioAtivo: dados.get('horario') === 'sim', avisoEmail: dados.get('aviso') === 'sim', faixas: faixasDoFormulario(dados) };
  const r = await salvarConfiguracao(ctx, config);
  if (r !== 'ok') {
    const k = config.faixas.slice(0, r.indice + 1).filter((x) => x.diaSemana === r.diaSemana).length;
    return { marca: randomUUID(), erro: { dia: r.diaSemana, k, mensagem: r.mensagem }, config };
  }
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?ok=salva&r=${randomBytes(4).toString('hex')}`);
}
