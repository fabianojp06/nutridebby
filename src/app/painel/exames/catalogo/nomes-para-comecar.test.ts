import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('"Nomes de exames para começar": o reset automático do React 19 não desmarca as caixas (SUS-108)', () => {
  it('as caixas são controladas e o <form> cancela o reset (ref={semResetAutomatico})', () => {
    // No erro a action volta com o mesmo marcador (a lista não se remonta), e o form.reset() depois da action levava as
    // caixas ao estado da montagem (desmarcadas) com o estado ainda marcado — a tela e o próximo envio sem os nomes.
    const f = readFileSync('src/app/painel/exames/catalogo/nomes-para-comecar.tsx', 'utf8');
    const form = f.match(/<form\n[\s\S]*?\n\s*>\n/)?.[0] ?? ''; // a tag de abertura inteira (com o `=>` do onSubmit)
    expect(form).toMatch(/\sref=\{semResetAutomatico\}/);
    expect(form).toMatch(/\saction=\{action\}/);
    expect(f).toMatch(/<input type="checkbox" name="nome" value=\{n\.nome\} checked=\{marcados\.has\(n\.nome\)\}/);
    expect(/\sdefault(Value|Checked)=\{/.test(f)).toBe(false);
  });
});
