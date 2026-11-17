import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CABECALHO_CONSULTA, CONSULTA_AUTOMATICA, ehConsultaAutomatica } from './consulta-automatica';

const RAIZ = process.cwd();
/** As telas da equipe (painel, admin, conta e os componentes que elas usam): onde a sessão tem os 30 min sem uso. */
const PASTAS = ['src/app/painel', 'src/app/admin', 'src/app/conta', 'src/components'];

/**
 * Temporizador com fetch que É uso da pessoa (conta para os 30 min): cada entrada com o porquê. Nada aqui consulta
 * sozinho, sem alguém ter digitado, clicado ou rolado antes.
 */
const USO_DA_PESSOA: Record<string, string> = {
  'src/app/painel/planos/editor/use-salvamento.ts': 'salvamento automático: só envia uma edição feita pela pessoa (e a repete sem rede)',
  'src/app/painel/alimentos/busca-alimento.tsx': 'espera de digitação da busca: só consulta depois de a pessoa digitar',
  'src/app/painel/planos/editor/dialogo-busca.tsx': 'espera de digitação do diálogo "Buscar alimento": só consulta depois de a pessoa abrir o diálogo e digitar ou escolher um critério',
  'src/components/vigia-sessao.tsx': 'o próprio relógio da sessão: o GET usa lerSessaoApi (não renova) e o POST é o uso real na tela',
  'src/components/portal/comi-assim.tsx': 'o "Comi assim" só envia depois do toque da pessoa (o prazo de 10 s do Desfazer, RN-198)',
};

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => relative(RAIZ, join(e.parentPath, e.name)));
}

/** Arquivo que agenda (setInterval/setTimeout) e consulta o servidor (fetch ou o `buscar` injetado). */
const consultaComTemporizador = (codigo: string) => /\bset(Interval|Timeout)\s*\(/.test(codigo) && /\b(fetch|buscar)\s*\(/.test(codigo);

describe('consulta automática não é uso da sessão (P12-14, RNF-06)', () => {
  it('o cabeçalho é reconhecido só com o valor "1"', () => {
    expect(ehConsultaAutomatica(new Headers(CONSULTA_AUTOMATICA.headers))).toBe(true);
    expect(ehConsultaAutomatica(new Headers({ [CABECALHO_CONSULTA]: '0' }))).toBe(false);
    expect(ehConsultaAutomatica(new Headers())).toBe(false);
    expect(CONSULTA_AUTOMATICA.cache).toBe('no-store');
  });

  it('todo temporizador com fetch nas telas da equipe manda CONSULTA_AUTOMATICA ou está em USO_DA_PESSOA com o porquê', () => {
    const achados = PASTAS.flatMap(arquivos).filter((f) => consultaComTemporizador(readFileSync(join(RAIZ, f), 'utf8')));
    const semCabecalho = achados.filter((f) => !(f in USO_DA_PESSOA) && !readFileSync(join(RAIZ, f), 'utf8').includes('CONSULTA_AUTOMATICA'));
    expect(semCabecalho).toEqual([]);
    // a varredura enxerga os consultores conhecidos (se um deles mudar de forma, a guarda precisa ser revista)
    expect(achados).toEqual(
      expect.arrayContaining([
        'src/app/painel/pacientes/[id]/documentos/[docId]/acompanhar-estado-pdf.ts',
        'src/app/painel/pacientes/[id]/exames/acompanhar-leitura.ts',
        'src/app/painel/pacientes/[id]/plano-alimentar/[planId]/atualizar-enquanto.tsx',
        'src/app/painel/whatsapp/conectar.tsx',
      ]),
    );
    // a lista de exceções não guarda arquivo que não existe mais ou que deixou de consultar com temporizador
    for (const f of Object.keys(USO_DA_PESSOA)) expect(achados).toContain(f);
  });
});
