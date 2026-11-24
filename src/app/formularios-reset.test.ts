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
 * Num arquivo com `<form action={função}>` (fora `method="get"`, em que o action é URL) ou `formAction`, um
 * `<select value=…>` ou um `<input checked=…>` só passa se:
 *  - todo formulário de ação do arquivo leva `ref={semResetAutomatico}` (`src/lib/form-sem-reset.ts`: o estado é a fonte e
 *    o reset é cancelado; um `formAction` conta como protegido dentro do `<form>` com a ref), ou
 *  - o arquivo está em EXCECOES, com o motivo.
 * E, ao contrário, um campo não controlado (`defaultValue`/`defaultChecked`) dentro do `<form>` com a ref acusa: com o reset
 * cancelado ele não volta ao padrão — só passa em NAO_CONTROLADOS_COM_REF, com o motivo.
 * Fora disso: `defaultValue` com remontagem a cada resposta (molde do P25-06c e da antropometria) para o select, e
 * `defaultChecked={estado}` para caixa e rádio (o React atualiza o `defaultChecked` a cada renderização, e o reset o mantém).
 * A guarda é por arquivo e pelo AST: um componente de outro arquivo renderizado dentro do formulário (`Preparar`) fica
 * coberto pela ref do formulário que o usa; o `<Form>` do next/form, props espalhadas (`{...props}`), um action que é
 * string numa variável sem `method="get"` e o botão com `form={id}` fora do `<form>` ficam fora (backlog do SUS-108).
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

/**
 * Arquivos com `ref={semResetAutomatico}` que ainda têm campo não controlado (`defaultValue`/`defaultChecked`): com o
 * reset cancelado, esse campo não volta ao padrão depois da action — só vale se outra coisa o remonta. Cada um com o motivo.
 */
const NAO_CONTROLADOS_COM_REF: Record<string, string> = {
  'src/app/painel/pacientes/[id]/antropometria/antropometria-form.tsx':
    'o <select> do protocolo (defaultValue) está nos Campos, remontados a cada resposta pela `envio`, com os valores devolvidos',
};

/** Confere os campos controlados de um arquivo (exportada para a sonda da própria guarda). */
export function conferirResetDosFormularios(arquivo: string, fonte: string): Achado[] {
  const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let formularios = 0;
  let protegidos = 0;
  const campos: Achado[] = [];
  const soltos: Achado[] = [];
  // `formDoAncestral`: o <form> de ação mais próximo acima no AST (null fora de um), e se ele leva a ref
  const visitar = (no: ts.Node, formDoAncestral: { protegido: boolean } | null) => {
    const abertura = ts.isJsxElement(no) ? no.openingElement : ts.isJsxSelfClosingElement(no) ? no : null;
    let dentro = formDoAncestral;
    if (abertura) {
      const tag = abertura.tagName.getText(sf);
      const attr = (nome: string) =>
        abertura.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === nome);
      const expressao = (a: ts.JsxAttribute | undefined) => (a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined);
      const texto = (a: ts.JsxAttribute | undefined) => {
        const v = a?.initializer;
        if (v && ts.isStringLiteral(v)) return v.text;
        const e = expressao(a);
        return e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined;
      };
      const linha = sf.getLineAndCharacterOfPosition(abertura.getStart(sf)).line + 1;
      const acao = expressao(attr('action'));
      // `method="get"`: o action é uma URL (o React só reseta o form de ação-função), como em comparar-exames.tsx
      if (tag === 'form' && acao && !ehLiteral(acao) && texto(attr('method'))?.toLowerCase() !== 'get') {
        const protegido = expressao(attr('ref'))?.getText(sf) === 'semResetAutomatico';
        formularios++;
        if (protegido) protegidos++;
        dentro = { protegido };
      }
      const formAction = expressao(attr('formAction'));
      if (formAction && !ehLiteral(formAction)) {
        // o botão reseta o <form> dele: protegido só se for o ancestral com a ref (com `form={id}` a guarda não o acha)
        formularios++;
        if (formDoAncestral?.protegido) protegidos++;
      }
      if (tag === 'select' && attr('value')) campos.push({ arquivo, linha, motivo: '<select value=…> controlado' });
      if (tag === 'input' && attr('checked')) campos.push({ arquivo, linha, motivo: '<input checked=…> controlado' });
      if (formDoAncestral?.protegido && ['select', 'input', 'textarea'].includes(tag) && (attr('defaultValue') || attr('defaultChecked')))
        soltos.push({ arquivo, linha, motivo: 'campo não controlado em <form ref={semResetAutomatico}>: o reset cancelado não o volta ao padrão' });
    }
    ts.forEachChild(no, (filho) => visitar(filho, dentro));
  };
  visitar(sf, null);
  const achados = arquivo in NAO_CONTROLADOS_COM_REF ? [] : [...soltos];
  if (!(formularios === 0 || protegidos === formularios || arquivo in EXCECOES)) achados.push(...campos);
  return achados;
}

/** Os arquivos corrigidos no SUS-108 e como (para a guarda falhar se um deles voltar ao padrão antigo). */
const CORRIGIDOS: Record<string, 'ref' | 'ref+defaultValue' | 'defaultChecked'> = {
  'src/app/painel/pacientes/[id]/antropometria/antropometria-form.tsx': 'ref+defaultValue',
  'src/app/painel/exames/catalogo/nomes-para-comecar.tsx': 'ref',
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
    if (como.startsWith('ref')) expect(/<form\b[^>]*\sref=\{semResetAutomatico\}/.test(fonte), 'ref={semResetAutomatico} no <form>').toBe(true);
    if (como === 'ref+defaultValue') expect(/<select\b[^>]*\sdefaultValue=\{/.test(fonte), '<select defaultValue>').toBe(true);
    if (como === 'defaultChecked') {
      expect(/\sdefaultChecked=\{/.test(fonte), 'defaultChecked').toBe(true);
      expect(/\schecked=\{/.test(fonte), 'checked= controlado').toBe(false);
    }
  });

  it('cada entrada de EXCECOES ainda tem um campo controlado, e cada uma de NAO_CONTROLADOS_COM_REF um não controlado', () => {
    for (const arquivo of Object.keys(EXCECOES)) expect(/\s(value|checked)=\{/.test(readFileSync(arquivo, 'utf8')), arquivo).toBe(true);
    for (const arquivo of Object.keys(NAO_CONTROLADOS_COM_REF)) expect(/\sdefault(Value|Checked)=\{/.test(readFileSync(arquivo, 'utf8')), arquivo).toBe(true);
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
    expect(f('<form method="get" action={acao}><select value={v} onChange={m} /></form>')).toBe(0); // URL numa variável (comparar-exames)
    expect(f('<div><select value={v} onChange={m} /><button formAction={acao}>Ir</button></div>')).toBe(1);
    // formAction dentro do <form> com a ref: protegido; dentro de um sem a ref: não
    expect(f('<form action={a} ref={semResetAutomatico}><select value={v} /><button formAction={b}>Ir</button></form>')).toBe(0);
    expect(f('<form action={a}><input type="checkbox" checked={v} /><button formAction={b}>Ir</button></form>')).toBe(1);
    // campo não controlado dentro do form com a ref: o reset cancelado não o volta ao padrão
    expect(f('<form action={a} ref={semResetAutomatico}><input name="x" defaultValue={v} /></form>')).toBe(1);
    expect(f('<form action={a} ref={semResetAutomatico}><input type="checkbox" defaultChecked={v} /></form>')).toBe(1);
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
