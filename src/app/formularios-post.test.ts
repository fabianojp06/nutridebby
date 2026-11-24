import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Code review do PR #22, item 2 (regra 3): um `<form onSubmit={…}>` sem `method` e sem ação de servidor, clicado antes da
 * hidratação, faz o GET nativo do navegador — os campos (WhatsApp, código de uso único, título e data do exame…) vão para a
 * query string, o log de acesso e o Referer. Todo `<form>` de src/app e src/components precisa de uma destas:
 *  - `action={função}` (ação de servidor ou de cliente: o React nunca deixa o navegador enviar sozinho);
 *  - `method="post"` (antes da hidratação, os campos vão no corpo, nunca na URL);
 *  - `method="get"` declarado, só nos arquivos de GET_PERMITIDOS (busca/filtro sem dado sensível, de propósito na URL).
 */
const RAIZES = ['src/app', 'src/components'];
const GET_PERMITIDOS: Record<string, string> = {
  'src/app/v/page.tsx': 'US-147: código impresso no documento, verificação pública sem JavaScript',
  'src/app/painel/pacientes/page.tsx': 'busca e filtros da lista de pacientes (link que se guarda e compartilha no painel)',
  'src/app/painel/pacientes/[id]/anamnese/page.tsx': 'escolha do modelo de anamnese (id do modelo)',
  'src/app/p/(portal)/compras/page.tsx': 'número de dias da lista de compras',
  'src/app/p/(portal)/conteudos/page.tsx': 'busca e filtro da biblioteca de conteúdos',
  'src/app/admin/page.tsx': 'P09-07: busca da lista de consultórios do admin (nome, endereço, e-mail da nutricionista — sem dado de saúde)',
  'src/app/painel/financeiro/lancamentos/filtros.tsx':
    'Plano 20 (§4.1, RN-306): filtros da lista de lançamentos — mês, tipo, categoria, situação, forma e o id do paciente, só opções de <select> (nada digitado)',
  'src/app/painel/financeiro/relatorios/page.tsx': 'Plano 20 (US-306): o "Ano" dos relatórios, só opção de <select> (nada digitado)',
  'src/app/painel/financeiro/relatorios/baixar-csv.tsx':
    'Plano 20 (§4.1, RN-321): o download do CSV é navegação GET para a rota do arquivo — só as datas "De"/"Até" e a caixa "Incluir o nome dos pacientes", sem dado de saúde nem texto livre',
  'src/app/painel/relatorios/filtros.tsx':
    'Plano 26 (§4.1, RN-481): o período dos Relatórios ("De"/"Até", meses AAAA-MM) e o critério do Ranking, só opções de <select> e campo oculto (nada digitado); o link se guarda e as abas o levam',
  'src/app/painel/mensagens/page.tsx': 'Plano 25 (§4.1): busca e filtro da caixa de mensagens (nome do paciente e "Não lidas"), como a lista de pacientes — nunca texto de mensagem',
  'src/app/painel/mensagens/nova/page.tsx': 'Plano 25 (CH-D66): busca da "Nova conversa" (nome do paciente), como a lista de pacientes',
};

type Achado = { arquivo: string; linha: number; motivo: string };

function arquivosTsx(): string[] {
  return RAIZES.flatMap((raiz) =>
    readdirSync(raiz, { recursive: true, encoding: 'utf8' })
      .map((f) => join(raiz, f).replaceAll('\\', '/'))
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx')),
  );
}

/** Confere os `<form>` de um arquivo (exportada para o teste da própria guarda). */
export function conferirFormularios(arquivo: string, fonte: string): Achado[] {
  const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados: Achado[] = [];
  const visitar = (no: ts.Node) => {
    const abertura = ts.isJsxElement(no) ? no.openingElement : ts.isJsxSelfClosingElement(no) ? no : null;
    if (abertura && abertura.tagName.getText(sf) === 'form') {
      const attr = (nome: string) =>
        abertura.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === nome);
      const texto = (a: ts.JsxAttribute | undefined) => {
        const v = a?.initializer;
        if (!v) return undefined;
        if (ts.isStringLiteral(v)) return v.text;
        if (ts.isJsxExpression(v) && v.expression && (ts.isStringLiteral(v.expression) || ts.isNoSubstitutionTemplateLiteral(v.expression))) return v.expression.text;
        return undefined;
      };
      const metodo = texto(attr('method'))?.toLowerCase();
      const acao = attr('action')?.initializer;
      const acaoEhFuncao =
        !!acao && ts.isJsxExpression(acao) && !!acao.expression &&
        !ts.isStringLiteral(acao.expression) && !ts.isNoSubstitutionTemplateLiteral(acao.expression) && !ts.isTemplateExpression(acao.expression);
      const linha = sf.getLineAndCharacterOfPosition(abertura.getStart(sf)).line + 1;
      if (metodo === 'post' || acaoEhFuncao) {
        // ok
      } else if (metodo === 'get') {
        if (!(arquivo in GET_PERMITIDOS)) achados.push({ arquivo, linha, motivo: 'method="get" fora de GET_PERMITIDOS' });
      } else {
        achados.push({ arquivo, linha, motivo: 'sem method="post" nem action={função}: antes da hidratação, os campos vão para a URL' });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return achados;
}

describe('formulários: nenhum campo vai para a URL antes da hidratação (code review do PR #22, item 2; regra 3)', () => {
  it('todo <form> de src/app e src/components tem method="post" ou action={função}; GET só nos permitidos', () => {
    const arquivos = arquivosTsx();
    expect(arquivos.length).toBeGreaterThan(50);
    const achados = arquivos.flatMap((f) => conferirFormularios(f, readFileSync(f, 'utf8')));
    expect(achados.map((a) => `${a.arquivo}:${a.linha} — ${a.motivo}`)).toEqual([]);
  });

  it('cada entrada de GET_PERMITIDOS ainda tem um <form method="get">', () => {
    for (const arquivo of Object.keys(GET_PERMITIDOS)) {
      expect(readFileSync(arquivo, 'utf8'), arquivo).toMatch(/method="get"/);
    }
  });

  it('a guarda reconhece os casos (sonda)', () => {
    const f = (jsx: string) => conferirFormularios('src/app/sonda.tsx', `export const X = () => (${jsx});`).length;
    expect(f('<form onSubmit={enviar}><input name="whatsapp" /></form>')).toBe(1);
    expect(f('<form method="post" onSubmit={enviar}><input name="whatsapp" /></form>')).toBe(0);
    expect(f('<form action={acao}><input name="x" /></form>')).toBe(0);
    expect(f('<form action={`/painel/${id}`}><input name="x" /></form>')).toBe(1); // URL: GET nativo
    expect(f('<form action="/busca" method="get"><input name="q" /></form>')).toBe(1); // GET fora da lista
    expect(f('<form\n  className="x"\n  onSubmit={enviar}\n><input name="codigo" /></form>')).toBe(1);
    expect(relative('.', 'src/app/sonda.tsx')).toBe('src/app/sonda.tsx');
  });
});
