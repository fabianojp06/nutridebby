/**
 * Plano 25 (US-446): o formulário do horário, sem servidor — o servidor (actions.ts) e o cliente (horario-form.tsx, na rede
 * caída) leem a mesma coisa do `FormData`. Puro.
 */
import { FIM_DO_DIA_MIN, MSG_MENSAGENS, PASSO_FAIXA_MIN } from '@/modules/mensagens/constantes';
import type { ConfiguracaoDasMensagens, Faixa } from '@/modules/mensagens/horario';

/** O erro junto à faixa: o dia (0 = domingo) e a posição dela no dia (1, 2, 3…), com o texto exato da §6.2. */
export type ErroNaFaixa = { dia: number; k: number; mensagem: string };
/**
 * O que volta ao formulário: a configuração enviada (nada se perde), o erro junto à faixa ou o erro geral (CH-D76: "Não
 * foi possível salvar. Tente de novo.", na falha inesperada ou na rede caída); `marca` remonta os campos.
 */
export type EstadoDoHorario = { marca: string; erro: ErroNaFaixa | null; erroGeral?: string; config: ConfiguracaoDasMensagens };

/** Um `value` dos `<select>` (0 a 1.440, de 15 em 15); fora disso, adulteração. */
const minutos = (v: FormDataEntryValue): number => {
  if (typeof v !== 'string' || !/^\d{1,4}$/.test(v)) throw new Error('mensagens: faixa inválida');
  const n = Number(v);
  if (n > FIM_DO_DIA_MIN || n % PASSO_FAIXA_MIN !== 0) throw new Error('mensagens: faixa inválida');
  return n;
};

/**
 * A configuração do formulário: as chaves e as faixas dia a dia (0 = domingo … 6 = sábado), na ordem da tela —
 * `inicio-{dia}` e `fim-{dia}` repetidos, um par por faixa. Par incompleto ou valor que o `<select>` não produz → Error (o
 * módulo também recusa o passo errado).
 */
export function configDoFormulario(dados: FormData): ConfiguracaoDasMensagens {
  const faixas: Faixa[] = [];
  for (let dia = 0; dia <= 6; dia++) {
    const inicios = dados.getAll(`inicio-${dia}`);
    const fins = dados.getAll(`fim-${dia}`);
    if (inicios.length !== fins.length) throw new Error('mensagens: faixa inválida');
    inicios.forEach((v, i) => faixas.push({ diaSemana: dia, inicioMin: minutos(v), fimMin: minutos(fins[i]) }));
  }
  return { horarioAtivo: dados.get('horario') === 'sim', avisoEmail: dados.get('aviso') === 'sim', faixas };
}

const marcaNova = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Rodada da T6c (I4): a gravação falhou (no servidor ou na rede): o erro geral e a configuração enviada de volta. Se nem o
 * formulário se lê (adulterado no cliente), volta a que estava na tela (`naTela`).
 */
export function estadoDeFalha(dados: FormData, naTela: ConfiguracaoDasMensagens): EstadoDoHorario {
  let config = naTela;
  try {
    config = configDoFormulario(dados);
  } catch {
    // fica a da tela
  }
  return { marca: marcaNova(), erro: null, erroGeral: MSG_MENSAGENS.configuracao.falha, config };
}

/**
 * /code-review do PR 2 (nit 4): o texto da região "Configuração salva." — some quando a gravação seguinte volta com erro
 * (`oculto` = o marcador da gravação que estava na tela quando o erro chegou); uma gravação nova (outro marcador) volta a
 * mostrá-lo. Puro.
 */
export const avisoDeSalvoNaTela = (texto: string, marcador: string, oculto: string | null): string => (oculto !== null && oculto === marcador ? '' : texto);

/** Uma resposta do formulário com erro (junto à faixa ou geral). */
export const respostaComErro = (e: EstadoDoHorario | null): boolean => !!e && (e.erro !== null || !!e.erroGeral);
