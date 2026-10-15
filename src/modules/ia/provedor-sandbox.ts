import { createHash } from 'node:crypto';
import type { PedidoGeracao, PedidoLeitura, ProvedorIA, RespostaGeracao, RespostaLeitura, UsoTokens } from './provedor';

/**
 * RNF-107: respostas fixas, sem rede e sem custo real, para dev, CI e o E2E (US-111: série existente, ambíguo, não
 * numérico, milhar e decimal, data da coleta). Os nomes são de laudo fictício; nada vem do arquivo.
 */
export const RESPOSTA_SANDBOX = {
  documento_reconhecido: true,
  data_coleta: '2026-08-28',
  marcadores: [
    { nome_no_laudo: 'Glicose de jejum', valor_texto: '92', unidade: 'mg/dL', referencia: '70 a 99', pagina: 1 },
    { nome_no_laudo: 'Colesterol total', valor_texto: '190', unidade: 'mg/dL', referencia: 'Desejável: < 190', pagina: 1 },
    { nome_no_laudo: 'Plaquetas', valor_texto: '250.000', unidade: '/mm³', referencia: '150.000 a 450.000', pagina: 1 },
    { nome_no_laudo: 'Ferritina', valor_texto: '1.234,5', unidade: 'ng/mL', referencia: '30 a 400', pagina: 1 },
    { nome_no_laudo: 'Creatinina', valor_texto: '0,85', unidade: 'mg/dL', referencia: '0,6 a 1,1', pagina: 1 },
    { nome_no_laudo: 'HBsAg', valor_texto: 'Não reagente', unidade: null, referencia: 'Não reagente', pagina: 1 },
  ],
} as const;

/**
 * Plano 14B (RNF-107): o `gerar` do sandbox — sem rede e com respostas fixas, sem nenhum nome real; os alimentos vêm do que
 * a busca devolveu (o id local "A1" do primeiro resultado). Resumo: cita o primeiro índice enviado e traz uma frase sem
 * fonte (o worker a retira, D13). Rascunho e modelos: pede `buscar_alimentos` e, com o resultado, devolve o plano (ou o
 * pacote com dois planos e uma anamnese).
 */
const USO_SANDBOX = (geo: string): UsoTokens => ({ entrada: 3000, cacheLeitura: 0, cacheGravacao: 0, saida: 600, geo });
/** O id local do primeiro alimento que a última busca devolveu ("A1"), lido do último tool_result. */
function primeiroAlimento(p: PedidoGeracao): string | null {
  const ultimo = [...p.turnos].reverse().find((t) => t.papel === 'usuario' && t.blocos.some((b) => b.tipo === 'resultado'));
  const r = ultimo?.papel === 'usuario' ? ultimo.blocos.find((b) => b.tipo === 'resultado') : undefined;
  try {
    const lista = r?.tipo === 'resultado' ? (JSON.parse(r.conteudo) as { id: string }[]) : [];
    return lista[0]?.id ?? null;
  } catch {
    return null;
  }
}
const planoSandbox = (a: string) => ({
  titulo: 'Plano sugerido', meta_kcal: 1800, orientacoes: 'Beba água ao longo do dia.',
  refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: [{ alimento: a, gramas: 150, medida: null, substitui: null }] }],
});
const RESUMO_SANDBOX = (indice: string) => ({
  secoes: [
    { secao: 'evolucao', frases: [{ texto: 'O peso foi registrado nas consultas.', fontes: [indice] }] },
    { secao: 'exames', frases: [{ texto: 'Há valores de exames registrados.', fontes: [] }] }, // sem fonte: o worker retira (D13)
  ],
});

/**
 * Plano 15 (DP-12, RNF-168): a conversa do paciente — o texto do usuário que o job manda é `"<instrução>\n" +
 * JSON.stringify({ contexto, historico, pergunta })`; do contexto, só os índices são lidos.
 */
type PedidoDaConversa = { contexto: { indices: string[] }; pergunta: string };
function pedidoDaConversa(p: PedidoGeracao): PedidoDaConversa {
  const t = p.turnos[0]?.papel === 'usuario' && p.turnos[0].blocos[0]?.tipo === 'texto' ? p.turnos[0].blocos[0].texto : '';
  try {
    const x = JSON.parse(t.slice(t.indexOf('\n') + 1)) as Partial<PedidoDaConversa> | null;
    return { contexto: { indices: Array.isArray(x?.contexto?.indices) ? x.contexto.indices.filter((i) => typeof i === 'string') : [] }, pergunta: typeof x?.pergunta === 'string' ? x.pergunta : '' };
  } catch {
    return { contexto: { indices: [] }, pergunta: '' };
  }
}
/** Omit distributivo: `RespostaGeracao` é uma união (final × recusa × …); o Omit comum perderia os campos de cada variante. */
type SemUso<T> = T extends unknown ? Omit<T, 'uso' | 'requestId'> : never;
/**
 * DP-12 (desvio 4 da spec: por marcador, não por hash): SANDBOX-RECUSA, SANDBOX-TEXTO-LIVRE (campo fora do schema),
 * SANDBOX-FONTE-INEXISTENTE, SANDBOX-RISCO e SANDBOX-SUPLEMENTO; sem marcador, "lugar"/"troc"/"substitu" → substituição com o
 * primeiro #S, "hora"/"horário" → horário com o primeiro #R, senão fora do escopo.
 */
function respostaDaConversa(p: PedidoGeracao): SemUso<RespostaGeracao> {
  const { contexto, pergunta } = pedidoDaConversa(p);
  const primeiro = (prefixo: string) => contexto.indices.find((i) => i.startsWith(prefixo)) ?? `${prefixo}1`;
  const final = (json: unknown) => {
    const texto = JSON.stringify(json);
    return { tipo: 'final' as const, texto, bruto: [{ type: 'text', text: texto }] };
  };
  if (pergunta.includes('SANDBOX-RECUSA')) return { tipo: 'recusa', categoria: 'sandbox', bruto: [] };
  if (pergunta.includes('SANDBOX-TEXTO-LIVRE')) return final({ categoria: 'plano', tipo_resposta: 'quantidade', fontes: [primeiro('#I')], resposta: 'Pode comer à vontade.' });
  if (pergunta.includes('SANDBOX-FONTE-INEXISTENTE')) return final({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S99'] });
  if (pergunta.includes('SANDBOX-RISCO')) return final({ categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] });
  if (pergunta.includes('SANDBOX-SUPLEMENTO')) return final({ categoria: 'plano', tipo_resposta: 'quantidade', fontes: [primeiro('#I')] });
  const q = pergunta.toLowerCase();
  if (/lugar|troc|substitu/.test(q)) return final({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: [primeiro('#S')] });
  if (/hora|horário|horario/.test(q)) return final({ categoria: 'plano', tipo_resposta: 'horario', fontes: [primeiro('#R')] });
  return final({ categoria: 'fora_do_escopo', tipo_resposta: 'nenhum', fontes: [] });
}

export function provedorSandbox(): ProvedorIA {
  return {
    nome: 'sandbox',
    destino: 'teste',
    limitePedidoBytes: 32 * 1024 * 1024,
    aceita: () => true,
    async lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura> {
      const id = createHash('sha256').update(p.arquivo.base64).digest('hex').slice(0, 12);
      return { tipo: 'ok', texto: JSON.stringify(RESPOSTA_SANDBOX), uso: { entrada: 8000, cacheLeitura: 0, cacheGravacao: 0, saida: 900, geo: p.geo }, requestId: `sandbox-${id}` };
    },
    async gerar(p: PedidoGeracao): Promise<RespostaGeracao> {
      const base = { uso: USO_SANDBOX(p.geo), requestId: 'sandbox-gerar' };
      // Plano 15 (DP-12, RNF-168): a conversa do paciente — respostas fixas por marcador na pergunta; nada vem do contexto
      // além dos índices (o primeiro #S, #R, #I, #O enviado)
      if (p.finalidade === 'conversa_paciente') return { ...respostaDaConversa(p), ...base };
      if (p.finalidade === 'resumo') {
        const primeiro = /"indice":"(#\d+)"/.exec(p.turnos[0]?.papel === 'usuario' && p.turnos[0].blocos[0]?.tipo === 'texto' ? p.turnos[0].blocos[0].texto : '')?.[1] ?? '#1';
        const texto = JSON.stringify(RESUMO_SANDBOX(primeiro));
        return { tipo: 'final', texto, bruto: [{ type: 'text', text: texto }], ...base };
      }
      const a = primeiroAlimento(p);
      if (!a) {
        const chamada = { id: `sandbox-${p.turnos.length}`, nome: 'buscar_alimentos', entrada: { termo: 'arroz' } };
        return { tipo: 'ferramentas', chamadas: [chamada], bruto: [{ type: 'tool_use', id: chamada.id, name: chamada.nome, input: chamada.entrada }], ...base };
      }
      const final =
        p.finalidade === 'rascunho'
          ? planoSandbox(a)
          : {
              planos: [planoSandbox(a), { ...planoSandbox(a), titulo: 'Plano sugerido 2' }],
              anamnese: {
                nome: 'Anamnese sugerida',
                perguntas: [
                  { tipo: 'texto_longo', rotulo: 'Como é a sua rotina de refeições?', obrigatoria: false },
                  { tipo: 'sim_nao', rotulo: 'Pratica atividade física?', obrigatoria: false },
                ],
              },
            };
      const texto = JSON.stringify(final);
      return { tipo: 'final', texto, bruto: [{ type: 'text', text: texto }], ...base };
    },
  };
}
