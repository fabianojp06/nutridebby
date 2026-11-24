import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { semResetAutomatico } from '@/lib/form-sem-reset';

/**
 * SUS-108: o React 19 chama `form.reset()` depois de toda action de um `<form action={função}>` (e de um `formAction`). O
 * reset leva cada campo ao valor padrão do nó, e o React não ressincroniza um controlado enquanto a prop não muda:
 *  - `<select value>`: nenhuma opção fica `defaultSelected` (react-dom 19.2, `updateOptions` só marca com `defaultValue`)
 *    — o select volta à primeira opção (ou à do HTML do servidor);
 *  - `<input type="checkbox|radio" checked>`: volta ao `checked` da montagem (o React só atualiza `defaultChecked` de quem
 *    não é controlado).
 * A tela passa a mostrar outra coisa que o estado (e que o JSON escondido montado dele), e o próximo envio manda o que a
 * tela mostra — até a próxima renderização do campo. `<input value>` e `<textarea value>` controlados escapam: o React
 * copia o valor para o `defaultValue` a cada renderização (`setDefaultValue`, `updateTextarea`), e o reset o mantém
 * (levantamento da T5, conferido no navegador). Por isso a guarda vale só para `<select value>` e `checked`.
 *
 * Num arquivo com `<form action={função}>` (ou `formAction`), um `<select value=…>` ou um `<input checked=…>` só passa se:
 *  - todo formulário de ação do arquivo leva `ref={semResetAutomatico}` (`src/lib/form-sem-reset.ts`: o estado é a fonte e
 *    o reset é cancelado), ou
 *  - o arquivo está em EXCECOES, com o motivo.
 * Fora disso: `defaultValue` com remontagem a cada resposta (molde do P25-06c e da antropometria) para o select, e
 * `defaultChecked={estado}` para caixa e rádio (o React atualiza o `defaultChecked` a cada renderização, e o reset o mantém).
 * A guarda é por arquivo: um componente de outro arquivo renderizado dentro do formulário (`Preparar`) fica coberto pela
 * ref do formulário que o usa.
 */
const RAIZES = ['src/app', 'src/components'];
const EXCECOES: Record<string, string> = {};

type Achado = { arquivo: string; linha: number; motivo: string };

function arquivosTsx(): string[] {
  return RAIZES.flatMap((raiz) =>
    readdirSync(raiz, { recursive: true, encoding: 'utf8' })
      .map((f) => join(raiz, f).replaceAll('\\', '/'))
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx')),
  );
}

const ehLiteral = (e: ts.Expression) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);

/** Confere os campos controlados de um arquivo (exportada para a sonda da própria guarda). */
export function conferirResetDosFormularios(arquivo: string, fonte: string): Achado[] {
  const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let formularios = 0;
  let protegidos = 0;
  const campos: Achado[] = [];
  const visitar = (no: ts.Node) => {
    const abertura = ts.isJsxElement(no) ? no.openingElement : ts.isJsxSelfClosingElement(no) ? no : null;
    if (abertura) {
      const tag = abertura.tagName.getText(sf);
      const attr = (nome: string) =>
        abertura.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === nome);
      const expressao = (a: ts.JsxAttribute | undefined) => (a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined);
      const linha = sf.getLineAndCharacterOfPosition(abertura.getStart(sf)).line + 1;
      const acao = expressao(attr('action'));
      if (tag === 'form' && acao && !ehLiteral(acao)) {
        formularios++;
        if (expressao(attr('ref'))?.getText(sf) === 'semResetAutomatico') protegidos++;
      }
      const formAction = expressao(attr('formAction'));
      if (formAction && !ehLiteral(formAction)) formularios++; // o botão dispara o reset do formulário dele, que não está aqui
      if (tag === 'select' && attr('value')) campos.push({ arquivo, linha, motivo: '<select value=…> controlado' });
      if (tag === 'input' && attr('checked')) campos.push({ arquivo, linha, motivo: '<input checked=…> controlado' });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  if (formularios === 0 || protegidos === formularios || arquivo in EXCECOES) return [];
  return campos;
}

/** Os arquivos corrigidos no SUS-108 e como (para a guarda falhar se um deles voltar ao padrão antigo). */
const CORRIGIDOS: Record<string, 'ref' | 'defaultValue' | 'defaultChecked'> = {
  'src/app/painel/pacientes/[id]/antropometria/antropometria-form.tsx': 'defaultValue',
  'src/app/painel/pacientes/[id]/documentos/[docId]/receita-form.tsx': 'ref',
  'src/app/painel/pacientes/[id]/documentos/[docId]/parecer-form.tsx': 'ref',
  'src/app/painel/anamnese/modelos/modelo-editor.tsx': 'ref',
  'src/app/painel/pacientes/[id]/plano-alimentar/lembretes/form-lembrete.tsx': 'ref',
  'src/app/consulta/[token]/acoes.tsx': 'defaultChecked',
  'src/app/convite/paciente/[token]/form.tsx': 'defaultChecked',
  'src/app/p/(portal)/agenda/agendar-form.tsx': 'defaultChecked',
  'src/app/p/(portal)/perfil/whatsapp-form.tsx': 'defaultChecked',
  'src/app/p/termo/termo-form.tsx': 'defaultChecked',
  'src/app/painel/conteudos/conteudo-form.tsx': 'defaultChecked',
  'src/app/painel/pacientes/[id]/gasto-energetico/calculo-form.tsx': 'defaultChecked',
  'src/app/painel/pacientes/[id]/plano-alimentar/rascunho-ia/metas-form.tsx': 'defaultChecked',
};

describe('formulários: o reset automático do React 19 não desencontra a tela do estado (SUS-108)', () => {
  it('nenhum <select value> nem <input checked> controlado em arquivo com <form action={função}>, salvo com ref={semResetAutomatico}', () => {
    const arquivos = arquivosTsx();
    expect(arquivos.length).toBeGreaterThan(50);
    const achados = arquivos.flatMap((f) => conferirResetDosFormularios(f, readFileSync(f, 'utf8')));
    expect(achados.map((a) => `${a.arquivo}:${a.linha} — ${a.motivo}`)).toEqual([]);
  });

  it.each(Object.entries(CORRIGIDOS))('%s: corrigido (%s)', (arquivo, como) => {
    const fonte = readFileSync(arquivo, 'utf8');
    // booleanos, para a falha não despejar o arquivo inteiro
    if (como === 'ref') expect(/<form\b[^>]*\sref=\{semResetAutomatico\}/.test(fonte), 'ref={semResetAutomatico} no <form>').toBe(true);
    if (como === 'defaultValue') expect(/<select\b[^>]*\sdefaultValue=\{/.test(fonte), '<select defaultValue>').toBe(true);
    if (como === 'defaultChecked') {
      expect(/\sdefaultChecked=\{/.test(fonte), 'defaultChecked').toBe(true);
      expect(/\schecked=\{/.test(fonte), 'checked= controlado').toBe(false);
    }
  });

  it('cada entrada de EXCECOES ainda tem um campo controlado', () => {
    for (const arquivo of Object.keys(EXCECOES)) expect(readFileSync(arquivo, 'utf8'), arquivo).toMatch(/\s(value|checked)=\{/);
  });

  it('a guarda reconhece os casos (sonda)', () => {
    const f = (jsx: string) => conferirResetDosFormularios('src/app/sonda.tsx', `export const X = () => (${jsx});`).length;
    expect(f('<form action={acao}><select name="a" value={v} onChange={m}><option /></select></form>')).toBe(1);
    expect(f('<form action={acao}><input type="checkbox" name="a" checked={v} onChange={m} /></form>')).toBe(1);
    expect(f('<form\n  action={acao}\n  className="x"\n><input type="radio" checked={v} onChange={m} /></form>')).toBe(1);
    expect(f('<form action={acao} ref={semResetAutomatico}><select value={v} onChange={m} /><input type="checkbox" checked={v} /></form>')).toBe(0);
    expect(f('<form action={acao}><select name="a" defaultValue={v}><option /></select><input type="checkbox" defaultChecked={v} /></form>')).toBe(0);
    expect(f('<form action={acao}><input name="a" value={v} onChange={m} /><textarea value={v} onChange={m} /></form>')).toBe(0); // T5: escapam
    expect(f('<form onSubmit={enviar} method="post"><select value={v} onChange={m} /></form>')).toBe(0); // sem action: sem reset
    expect(f('<form action="/busca" method="get"><select value={v} onChange={m} /></form>')).toBe(0);
    expect(f('<div><select value={v} onChange={m} /><button formAction={acao}>Ir</button></div>')).toBe(1);
    // dois formulários de ação: os dois precisam da ref
    expect(f('<><form action={a} ref={semResetAutomatico}><select value={v} /></form><form action={b}><input type="checkbox" checked={c} /></form></>')).toBe(2);
    // uma ref nova a cada renderização não serve (o React a desliga e religa em todo commit, e o reset cai no meio)
    expect(f('<form action={acao} ref={(el) => semResetAutomatico(el)}><select value={v} /></form>')).toBe(1);
  });
});

describe('semResetAutomatico (src/lib/form-sem-reset.ts)', () => {
  it('cancela o evento reset do formulário (o form.reset() do React não muda os campos) e solta o ouvinte na limpeza', () => {
    const form = new EventTarget() as unknown as HTMLFormElement;
    const soltar = semResetAutomatico(form);
    expect(form.dispatchEvent(new Event('reset', { cancelable: true }))).toBe(false); // cancelado
    soltar?.();
    expect(form.dispatchEvent(new Event('reset', { cancelable: true }))).toBe(true);
  });
});
