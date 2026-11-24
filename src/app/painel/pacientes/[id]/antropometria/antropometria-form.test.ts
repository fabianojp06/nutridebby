import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'src/app/painel/pacientes/[id]/antropometria';

describe('antropometria: o protocolo escolhido sobrevive ao reset automático do formulário (SUS-108)', () => {
  it('o <select> do protocolo é não controlado (defaultValue) e os Campos se remontam a cada resposta, com os valores devolvidos', () => {
    // O React 19 chama form.reset() depois de toda action do `<form action>`. Um `<select value>` montado no cliente não
    // marca `defaultSelected` em nenhuma opção: depois de um erro, a tela mostrava "Nenhum" com as dobras do JP 3 (o estado),
    // e um reenvio mandava protocolo=nenhum. Com `defaultValue`, a opção da montagem (a dos valores devolvidos, depois da
    // remontagem pela `envio`) é a `defaultSelected`, e o reset a mantém.
    const f = readFileSync(`${DIR}/antropometria-form.tsx`, 'utf8');
    const select = f.match(/<select id=[^>]*>/g) ?? []; // a tag de verdade (o comentário ao lado cita "<select value>")
    expect(select).toHaveLength(1);
    expect(select[0]).toMatch(/\sname="protocolo"/);
    expect(select[0]).toMatch(/\sdefaultValue=\{protocolo\}/);
    expect(select[0]).not.toMatch(/\svalue=\{/);
    // a remontagem que põe o valor devolvido no defaultValue: a chave dos Campos é a `envio` da resposta, e os valores vêm dela
    expect(f).toMatch(/<Campos key=\{state\.envio \?\? 0\} inicial=\{state\.valores \?\?/);
    // toda resposta da action (sucesso e os dois erros que voltam à tela) muda a `envio`
    const a = readFileSync(`${DIR}/actions.ts`, 'utf8');
    const retornos = a.slice(a.indexOf('export async function registrarAntropometriaAction'), a.indexOf('export async function excluirAntropometriaAction')).match(/return \{[^\n]*/g) ?? [];
    expect(retornos).toHaveLength(3);
    for (const r of retornos) expect(r).toMatch(/envio: Date\.now\(\)/);
  });
});
