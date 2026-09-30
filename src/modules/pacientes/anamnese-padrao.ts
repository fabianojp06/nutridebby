import type { ModeloSchema, Pergunta } from './anamnese-tipos';

export const NOME_MODELO_PADRAO = 'Anamnese geral';

/** US-012 "Modelo padrão": as seções da spec, uma pergunta por seção, nenhuma obrigatória (a nutricionista ajusta). */
export function modeloPadrao(): { nome: string; schema: ModeloSchema } {
  const p = (tipo: Pergunta['tipo'], rotulo: string, extra: Partial<Pergunta> = {}): Pergunta => ({
    id: crypto.randomUUID(),
    tipo,
    rotulo,
    obrigatoria: false,
    ...extra,
  });
  return {
    nome: NOME_MODELO_PADRAO,
    schema: {
      perguntas: [
        p('texto_longo', 'Queixa principal'),
        p('texto_longo', 'Histórico clínico'),
        p('texto_longo', 'Medicamentos'),
        p('texto_longo', 'Alergias/intolerâncias'),
        p('escolha_unica', 'Hábitos intestinais', {
          opcoes: [
            'Regular',
            'Constipação',
            'Diarreia frequente',
            'Alterna constipação e diarreia',
          ],
        }),
        p('numero', 'Sono', { unidade: 'horas por noite' }),
        p('texto_longo', 'Atividade física'),
        p('numero', 'Consumo de água', { unidade: 'litros por dia' }),
        p('texto_curto', 'Álcool/tabaco'),
        p('texto_longo', 'Preferências e aversões'),
      ],
    },
  };
}
