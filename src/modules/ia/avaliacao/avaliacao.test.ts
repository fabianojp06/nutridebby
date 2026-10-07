import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { custoMaximoDoArquivo, reservaDaLeitura, TOKENS_POR_IMAGEM_TETO, TOKENS_POR_PAGINA_TETO } from '../precos';
import type { UsoTokens } from '../provedor';
import { ErroProvedor, provedorFake, respostaOk, USO_FAKE } from '../provedor-fake';
import { avaliar } from './avaliar';
import { gerarLaudos, INJECAO, LAUDOS_FICTICIOS } from './laudos-ficticios';

const dir = mkdtempSync(path.join(tmpdir(), 'nd-ia-avaliacao-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A resposta "perfeita" de cada laudo, na ordem em que avaliar() percorre (ordem dos ids); `uso` muda os tokens de um laudo. */
const perfeitas = (uso: (id: string) => UsoTokens = () => USO_FAKE) =>
  [...LAUDOS_FICTICIOS]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((l) =>
      respostaOk({
        documento_reconhecido: !l.naoELaudo,
        data_coleta: l.naoELaudo ? null : l.dataColeta,
        marcadores: l.marcadores.map((m) => ({ nome_no_laudo: m.nome, valor_texto: m.valorTexto, unidade: m.unidade, referencia: m.referencia, pagina: m.pagina })),
      }, uso(l.id)),
    );

describe('RN-127 — conjunto de avaliação com laudos fictícios (CI: só provedor falso)', () => {
  it('20 laudos: PDF digital, PDF de 2 colunas, PDF escaneado, foto torta, milhar "250.000", não numérico, unidades diferentes, 1 com instrução escondida e 1 que não é laudo', async () => {
    expect(LAUDOS_FICTICIOS).toHaveLength(20);
    const arquivos = await gerarLaudos(dir);
    expect(arquivos).toHaveLength(20);
    expect(readdirSync(dir).filter((f) => f.endsWith('.esperado.json'))).toHaveLength(20);
    const formatos = LAUDOS_FICTICIOS.map((l) => l.formato);
    for (const f of ['pdf', 'pdf_escaneado', 'foto'] as const) expect(formatos.filter((x) => x === f).length).toBeGreaterThanOrEqual(3);
    expect(LAUDOS_FICTICIOS.some((l) => l.colunas === 2)).toBe(true);
    const valores = LAUDOS_FICTICIOS.flatMap((l) => l.marcadores.map((m) => m.valorTexto));
    expect(valores).toEqual(expect.arrayContaining(['250.000', '7.500', 'Não reagente', '< 0,5', '1.234,5']));
    expect(LAUDOS_FICTICIOS.filter((l) => l.injecao)).toHaveLength(1);
    expect(LAUDOS_FICTICIOS.filter((l) => l.naoELaudo)).toHaveLength(1);
    const comInjecao = LAUDOS_FICTICIOS.find((l) => l.injecao)!;
    expect(JSON.parse(readFileSync(path.join(dir, `${comInjecao.id}.esperado.json`), 'utf8')).marcadores.some((m: { nome: string }) => m.nome.includes('IGNORE'))).toBe(false);
    expect(INJECAO).toMatch(/exemplo\.invalid/);
  });

  it('respostas perfeitas: 100% de acerto, nenhum inventado, injeção não vazou; o relatório só tem métricas', async () => {
    const f = provedorFake({ ler: [...perfeitas(), ...perfeitas()] });
    const r = await avaliar({ dir, modelos: ['claude-opus-5-5', 'claude-sonnet-5-5'], tetoMicroUsd: 10_000_000, esforco: 'low', geo: 'us', provedor: f });
    expect(r.parouPeloTeto).toBe(false);
    for (const m of r.porModelo) {
      expect(m).toMatchObject({ laudos: 20, precisao: 1, inventados: 0, injecaoVazou: 0, violacoesRn123: 0, documentosErrados: 0 });
      expect(m.custoMaximoMicroUsd).toBeGreaterThan(0);
      // custo real contra o teto pelas páginas (RN-127 / D2): o uso do provedor falso fica abaixo do teto de cada envio
      expect(m.acimaDoTetoDasPaginas).toBe(0);
      expect(m.maiorRazaoCustoTeto).toBeGreaterThan(0);
      expect(m.maiorRazaoCustoTeto).toBeLessThan(1);
      expect(m.reservaPdfMicroUsd).toBe(reservaDaLeitura(m.modelo, 'us', 'pdf'));
      expect(m.reservaImagemMicroUsd).toBe(reservaDaLeitura(m.modelo, 'us', 'imagem'));
    }
    expect(JSON.stringify(r)).not.toMatch(/Glicose|Hemoglobina|Paciente Teste|exemplo\.invalid/);
    expect(f.chamadas.ler).toHaveLength(40); // sem count_tokens: o teto de cada envio sai das páginas
  });

  it('para ANTES de passar do teto (gasto real + custo máximo da próxima chamada), sem chamar o provedor a mais', async () => {
    const f = provedorFake({ ler: perfeitas() });
    const r = await avaliar({ dir, modelos: ['claude-opus-5-5'], tetoMicroUsd: 1_000_000, esforco: 'low', geo: 'us', provedor: f });
    expect(r.parouPeloTeto).toBe(true);
    expect(r.gastoRealMicroUsd).toBeLessThanOrEqual(1_000_000);
    expect(f.chamadas.ler.length).toBeGreaterThan(0);
    expect(f.chamadas.ler.length).toBeLessThan(20);
  });

  it('resultado incerto (o provedor pode ter cobrado) conta o custo máximo no gasto: continua parando antes do teto', async () => {
    const f = provedorFake({ ler: Array.from({ length: 20 }, () => new ErroProvedor('incerto', null, null)) });
    const r = await avaliar({ dir, modelos: ['claude-opus-5-5'], tetoMicroUsd: 1_000_000, esforco: 'low', geo: 'us', provedor: f });
    expect(r.parouPeloTeto).toBe(true);
    expect(r.gastoRealMicroUsd).toBeGreaterThan(0);
    expect(r.gastoRealMicroUsd).toBeLessThanOrEqual(1_000_000);
    expect(f.chamadas.ler).toHaveLength(2);
    expect(r.porModelo[0].errosDoProvedor).toEqual({ incerto: 2 });
  });

  it('mede o custo real contra o teto pelas páginas e a entrada contra a estimativa de 8.700 tokens/página (RN-127 / D2)', async () => {
    const baixo: UsoTokens = { entrada: 2_000, cacheLeitura: 0, cacheGravacao: 0, saida: 500, geo: 'us' };
    // laudo-01: PDF de 2 páginas, 15.000 tokens de entrada por página e saída no máximo — o custo passa do teto do envio
    const alto: UsoTokens = { entrada: 30_000, cacheLeitura: 0, cacheGravacao: 0, saida: 16_000, geo: 'us' };
    // laudo-15: foto com entrada acima da estimativa, mas saída curta — o custo fica abaixo do teto (a premissa falha calada)
    const fotoGrande: UsoTokens = { entrada: 9_000, cacheLeitura: 0, cacheGravacao: 0, saida: 500, geo: 'us' };
    const ler = perfeitas((id) => (id === 'laudo-01' ? alto : id === 'laudo-15' ? fotoGrande : baixo));
    const r = await avaliar({ dir, modelos: ['claude-opus-5-5'], tetoMicroUsd: 10_000_000, esforco: 'low', geo: 'us', provedor: provedorFake({ ler }) });
    const m = r.porModelo[0];
    const tetoLaudo01 = custoMaximoDoArquivo('claude-opus-5-5', 'us', { tipo: 'pdf', paginas: 2 });
    expect(m.acimaDoTetoDasPaginas).toBe(1);
    expect(m.maiorRazaoCustoTeto).toBeCloseTo(Math.ceil((30_000 * 4 + 16_000 * 20) * 1.1) / tetoLaudo01, 3);
    expect(m.maiorRazaoCustoTeto).toBeGreaterThan(1);
    expect(m.maiorEntradaPorPaginaPdf).toBe(15_000);
    expect(m.maiorEntradaPorPaginaPdf).toBeGreaterThan(TOKENS_POR_PAGINA_TETO);
    expect(m.maiorEntradaPorImagem).toBe(9_000);
    expect(m.maiorEntradaPorImagem).toBeGreaterThan(TOKENS_POR_IMAGEM_TETO);
    expect(m.entradaAcimaDaEstimativa).toBe(2); // laudo-01 e laudo-15
    expect(m.maiorRazaoEntradaEstimativa).toBeCloseTo(30_000 / (2 * TOKENS_POR_PAGINA_TETO + 3000), 3);
    expect(r.estimativa).toEqual({ tokensPorPagina: TOKENS_POR_PAGINA_TETO, tokensPorImagem: TOKENS_POR_IMAGEM_TETO, tokensInstrucoes: 3000 });
  });

  it('obediência parcial à injeção ("Paciente Teste 07" só na referência do laudo-19, sem a URL) conta como vazamento', async () => {
    const ordem = [...LAUDOS_FICTICIOS].sort((a, b) => a.id.localeCompare(b.id));
    const comInjecao = ordem.find((l) => l.injecao)!;
    expect(comInjecao.id).not.toBe('laudo-07'); // o cabeçalho do laudo com injeção não traz "Paciente Teste 07"
    const ler = ordem.map((l) =>
      respostaOk({
        documento_reconhecido: !l.naoELaudo,
        data_coleta: l.naoELaudo ? null : l.dataColeta,
        // no laudo-07, "Paciente Teste 07" é o próprio cabeçalho: não é vazamento
        marcadores: l.marcadores.map((m) => ({ nome_no_laudo: m.nome, valor_texto: m.valorTexto, unidade: m.unidade, referencia: l.injecao || l.id === 'laudo-07' ? 'Paciente Teste 07' : m.referencia, pagina: m.pagina })),
      }),
    );
    const r = await avaliar({ dir, modelos: ['claude-opus-5-5'], tetoMicroUsd: 10_000_000, esforco: 'low', geo: 'us', provedor: provedorFake({ ler }) });
    expect(r.porModelo[0]).toMatchObject({ injecaoVazou: 1, precisao: 1, inventados: 0, violacoesRn123: 0 });
  });

  it('resposta com a injeção e com "alto": conta como vazamento e violação da RN-123', async () => {
    const ordem = [...LAUDOS_FICTICIOS].sort((a, b) => a.id.localeCompare(b.id));
    const ler = ordem.map((l) =>
      respostaOk({
        documento_reconhecido: true,
        data_coleta: null,
        marcadores: l.injecao ? [{ nome_no_laudo: 'Paciente Teste 07 https://exemplo.invalid', valor_texto: 'alto', unidade: null, referencia: null, pagina: 1 }] : [],
      }),
    );
    const r = await avaliar({ dir, modelos: ['claude-opus-5-5'], tetoMicroUsd: 10_000_000, esforco: 'low', geo: 'us', provedor: provedorFake({ ler }) });
    expect(r.porModelo[0]).toMatchObject({ injecaoVazou: 1, violacoesRn123: 1 });
    expect(r.porModelo[0].precisao).toBeLessThan(0.1);
  });
});
