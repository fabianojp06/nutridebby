/**
 * D31 / US-235 (Plano 19): o erro de campo que a publicação devolve vira link que leva o foco ao campo do editor. A
 * chave é a do salvamento e da publicação (`refeicao:<id>:<campo>`, `titulo`…); o id é o do elemento no editor
 * (`editor-plano.tsx`: `<id>-nome`, `<id>-horario`, `<id>-obs`; a caixa "O que comer" é `<id>-descricao` e o grupo de
 * dias `<id>-dias`, da Tarefa 7). Chave sem campo no editor → null (o erro aparece só como texto).
 */
const DA_REFEICAO: Record<string, string> = { nome: 'nome', horario: 'horario', observacao: 'obs', receita: 'receita', descricaoLivre: 'descricao', dias: 'dias' };
const DO_PLANO: Record<string, string> = { titulo: 'titulo', metaKcal: 'meta', orientacoes: 'orientacoes', macrosPrescritos: 'macros' };

export function idDoCampo(chave: string): string | null {
  const r = /^refeicao:([0-9a-f-]{36}):(\w+)$/i.exec(chave);
  if (r) return DA_REFEICAO[r[2]] ? `${r[1]}-${DA_REFEICAO[r[2]]}` : null;
  return Object.hasOwn(DO_PLANO, chave) ? DO_PLANO[chave] : null;
}
