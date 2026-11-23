import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analisarTopo, arquivosDoApp, ehDeServerActions, guardasAlcancadas, guardasDoArquivo, rotaDoArquivo, semComentarios, type Arquivo } from '../../../test/fonte';
import { FORA_DO_PAINEL, ROTAS_DA_RECEPCAO } from './rotas-da-recepcao';

/**
 * Plano 26 (RN-504, RN-513, RE-D15, RE-D16): negação por padrão no app. Toda `page.tsx`, todo handler exportado de
 * `route.ts` (GET, POST, PUT, PATCH, DELETE) de `src/app/painel` e `src/app/api/painel` e toda action exportada de **todo**
 * arquivo com `'use server'` (não só `actions.ts`: também `cobranca-actions.ts`) chama a guarda da nutricionista
 * (`requireNutri`/`requireApiNutri`, ou `carregarProntuario`, que a chama) ou chama `requireEquipe`/`requireApiEquipe`
 * **e** está em `ROTAS_DA_RECEPCAO`; toda entrada da lista existe e chama `requireEquipe`. A chamada pode vir de uma função
 * do próprio arquivo (`acesso(…)` → `requireNutri(…)`). Linha `export` que a guarda não lê (default anônimo,
 * reexportação…) num arquivo de actions ou de rota é violação. Layouts: o que chama `requireEquipe` envolve alguma rota da
 * lista; o que chama a guarda da nutricionista não envolve nenhuma (a recepção voltaria a "Sem permissão" sem fim); o que
 * não chama guarda nenhuma só desenha (não importa módulo, banco nem sessão).
 */
const NUTRI = ['requireNutri', 'requireApiNutri', 'carregarProntuario'] as const;
const EQUIPE = ['requireEquipe', 'requireApiEquipe'] as const;
const GUARDAS = [...NUTRI, ...EQUIPE];
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const LE_DADOS = /from '@\/(modules|db)\/|from '@\/lib\/(tenant-session|session|paciente-session|api-auth)'/;

type Tipo = 'pagina' | 'rota' | 'action' | 'layout';
/** `chave`: o que a lista usa (a rota, ou arquivo#action); `rotulo`: o nome na mensagem (a rota com o método, no handler). */
type Entrada = { tipo: Tipo; chave: string; rotulo: string; guardas: Set<string>; leDados?: boolean };

const temEquipe = (e: Entrada) => EQUIPE.some((g) => e.guardas.has(g));
const temNutri = (e: Entrada) => NUTRI.some((g) => e.guardas.has(g));

/** As entradas do painel (páginas, handlers de rota, actions e layouts) com as guardas que cada uma alcança. */
function entradas(arquivos: Arquivo[]): { todas: Entrada[]; naoLidas: string[] } {
  const naoLidas: string[] = [];
  const todas = arquivos.flatMap(({ arquivo, fonte }): Entrada[] => {
    const chave = rotaDoArquivo(arquivo);
    if (/(^|\/)page\.tsx$/.test(arquivo)) return [{ tipo: 'pagina', chave, rotulo: chave, guardas: guardasDoArquivo(fonte, GUARDAS) }];
    if (/(^|\/)layout\.tsx$/.test(arquivo))
      return [{ tipo: 'layout', chave, rotulo: `/${arquivo}`, guardas: guardasDoArquivo(fonte, GUARDAS), leDados: LE_DADOS.test(semComentarios(fonte)) }];
    const ehRota = /(^|\/)route\.ts$/.test(arquivo);
    if (!ehRota && !ehDeServerActions(fonte)) return [];
    const { blocos, naoEntendidos } = analisarTopo(fonte);
    for (const linha of naoEntendidos) naoLidas.push(`/${arquivo}: export que a guarda não lê (${linha})`);
    const exportados = blocos.filter((b) => b.exportado && (!ehRota || METODOS.includes(b.publico)));
    return exportados.map((b) => ({
      tipo: ehRota ? 'rota' : 'action',
      chave: ehRota ? chave : `/${arquivo}#${b.publico}`,
      rotulo: ehRota ? `${chave}#${b.publico}` : `/${arquivo}#${b.publico}`,
      guardas: guardasAlcancadas(blocos, b.nome, GUARDAS),
    }));
  });
  return { todas, naoLidas };
}

/** As violações da RN-513 (vazio = tudo certo). Pura: o controle positivo passa rascunhos. */
function violacoesDasRotas(arquivos: Arquivo[], lista: readonly string[]): string[] {
  const { todas, naoLidas } = entradas(arquivos);
  const v: string[] = [...naoLidas];
  const telasDaLista = lista.filter((c) => !c.includes('#') && !c.startsWith('/api/'));
  for (const e of todas) {
    if (e.tipo === 'layout') {
      const sob = telasDaLista.filter((c) => c === e.chave || c.startsWith(`${e.chave}/`));
      if (temEquipe(e) && !sob.length) v.push(`${e.rotulo}: chama requireEquipe e nenhuma rota de ROTAS_DA_RECEPCAO fica sob ele`);
      else if (!temEquipe(e) && temNutri(e) && sob.length) v.push(`${e.rotulo}: só da nutricionista e envolve ${sob.join(', ')}`);
      else if (!temEquipe(e) && !temNutri(e) && e.leDados) v.push(`${e.rotulo}: sem sessão e importa módulo, banco ou sessão`);
      continue;
    }
    const listada = lista.includes(e.chave);
    if (temEquipe(e) && !listada) v.push(`${e.rotulo}: chama requireEquipe e não está em ROTAS_DA_RECEPCAO`);
    if (!temEquipe(e) && !temNutri(e)) v.push(`${e.rotulo}: não chama requireNutri nem requireEquipe`);
    else if (listada && !temEquipe(e)) v.push(`${e.rotulo}: está em ROTAS_DA_RECEPCAO e não chama requireEquipe`);
  }
  for (const chave of lista) if (!todas.some((x) => x.tipo !== 'layout' && x.chave === chave)) v.push(`${chave}: está em ROTAS_DA_RECEPCAO e não existe`);
  return v;
}

const DO_PAINEL = [...arquivosDoApp('painel'), ...arquivosDoApp('api/painel')];

describe('ROTAS_DA_RECEPCAO (RN-513): negação por padrão no app', () => {
  it('toda página, rota e action do painel chama requireNutri, ou requireEquipe e está na lista; toda entrada da lista chama requireEquipe', () => {
    expect(violacoesDasRotas(DO_PAINEL, ROTAS_DA_RECEPCAO)).toEqual([]);
  });

  it('o PR 2 libera só o Início, as telas de aviso, o manual e as duas actions de preferências (escolherTemaAction continua só da nutricionista)', () => {
    expect([...ROTAS_DA_RECEPCAO].sort()).toEqual(
      [
        '/painel',
        '/painel/ajuda',
        '/painel/contrato-pendente',
        '/painel/preferencias/actions.ts#alternarTemaAction',
        '/painel/preferencias/actions.ts#marcarGuiaAction',
        '/painel/sem-permissao',
      ].sort(),
    );
    expect(FORA_DO_PAINEL).toEqual(['/conta/seguranca', '/conta/acesso-desativado', '/inicio', '/conta/outro-papel', '/api/sessao/ativa']);
  });

  it('a guarda enxerga as actions de todo arquivo com "use server", inclusive as que chamam a sessão por uma função local', () => {
    const chaves = entradas(DO_PAINEL).todas.map((e) => e.chave);
    expect(chaves).toContain('/painel/agenda/consultas/[id]/cobranca-actions.ts#registrarCobrancaAction');
    expect(chaves).toContain('/painel/pacientes/[id]/documentos/actions.ts#reenviarLinkAction');
    expect(chaves).toContain('/painel/preferencias/actions.ts#escolherTemaAction');
    expect(chaves).toContain('/api/painel/relatorios/csv');
    // os layouts também são entradas (o raiz, com requireEquipe, e os aninhados)
    expect(entradas(DO_PAINEL).todas.filter((e) => e.tipo === 'layout').map((e) => e.rotulo)).toEqual(
      expect.arrayContaining(['/painel/layout.tsx', '/painel/pacientes/[id]/layout.tsx', '/painel/financeiro/layout.tsx', '/painel/relatorios/layout.tsx']),
    );
  });

  it('carregarProntuario (as páginas do prontuário dependem dele) chama requireNutri, nunca requireEquipe', () => {
    const s = semComentarios(readFileSync('src/app/painel/pacientes/[id]/prontuario.ts', 'utf8'));
    expect(s).toMatch(/export const carregarProntuario = cache\(async[\s\S]*?requireNutri\(/);
    expect(s).not.toMatch(/requireEquipe\(|requireApiEquipe\(/);
  });

  describe('controle positivo (rascunhos)', () => {
    const pagina = (corpo: string): Arquivo => ({ arquivo: 'painel/rascunho/page.tsx', fonte: `export default async function P() {\n  ${corpo}\n}\n` });
    const actions = (corpo: string): Arquivo => ({ arquivo: 'painel/rascunho/outras-actions.ts', fonte: `'use server';\n\n${corpo}\n` });

    it('página sem sessão, ou só com a chamada num comentário → violação', () => {
      expect(violacoesDasRotas([pagina('return null;')], [])).toEqual(['/painel/rascunho: não chama requireNutri nem requireEquipe']);
      expect(violacoesDasRotas([pagina('// await requireNutri("/x");\n  return null;')], [])).toHaveLength(1);
    });
    it('página com requireEquipe fora da lista → violação; na lista → ok; na lista chamando só requireNutri → violação', () => {
      expect(violacoesDasRotas([pagina("await requireEquipe('/painel/rascunho');")], [])).toEqual(['/painel/rascunho: chama requireEquipe e não está em ROTAS_DA_RECEPCAO']);
      expect(violacoesDasRotas([pagina("await requireEquipe('/painel/rascunho');")], ['/painel/rascunho'])).toEqual([]);
      expect(violacoesDasRotas([pagina("await requireNutri('/painel/rascunho');")], ['/painel/rascunho'])).toEqual(['/painel/rascunho: está em ROTAS_DA_RECEPCAO e não chama requireEquipe']);
    });
    it('entrada da lista sem arquivo → violação', () => {
      expect(violacoesDasRotas([], ['/painel/nao-existe'])).toEqual(['/painel/nao-existe: está em ROTAS_DA_RECEPCAO e não existe']);
    });
    it('arquivo de actions com outro nome: cada action exportada é conferida, também pela função local', () => {
      const fonte = [
        "async function acesso() {\n  return requireNutri('/painel/x');\n}",
        'export async function boaAction() {\n  await acesso();\n}',
        "export async function daEquipeAction() {\n  await requireEquipe('/painel');\n}",
        'export async function semSessaoAction() {\n  return 1;\n}',
      ].join('\n\n');
      expect(violacoesDasRotas([actions(fonte)], [])).toEqual([
        '/painel/rascunho/outras-actions.ts#daEquipeAction: chama requireEquipe e não está em ROTAS_DA_RECEPCAO',
        '/painel/rascunho/outras-actions.ts#semSessaoAction: não chama requireNutri nem requireEquipe',
      ]);
      expect(violacoesDasRotas([actions(fonte)], ['/painel/rascunho/outras-actions.ts#daEquipeAction'])).toEqual([
        '/painel/rascunho/outras-actions.ts#semSessaoAction: não chama requireNutri nem requireEquipe',
      ]);
    });
    it('arquivo sem "use server" não é de actions (componente, helper)', () => {
      expect(violacoesDasRotas([{ arquivo: 'painel/rascunho/helper.ts', fonte: 'export function f() {\n  return 1;\n}\n' }], [])).toEqual([]);
    });
    it('export { … } marca a action como exportada (também com "as"); a função local sem export não é entrada', () => {
      const fonte = "async function apagarAction() {\n  return 1;\n}\n\nasync function interna() {\n  return 2;\n}\n\nasync function guardada() {\n  await requireNutri('/x');\n}\n\nexport { apagarAction, guardada as salvarAction };\nexport type { Algo } from './tipos';";
      expect(violacoesDasRotas([actions(fonte)], [])).toEqual(['/painel/rascunho/outras-actions.ts#apagarAction: não chama requireNutri nem requireEquipe']);
    });
    it('export { … } em várias linhas, ou de nome que não existe no arquivo', () => {
      expect(violacoesDasRotas([actions("async function a() {\n  return 1;\n}\n\nexport {\n  a,\n};")], [])).toEqual(['/painel/rascunho/outras-actions.ts#a: não chama requireNutri nem requireEquipe']);
      expect(violacoesDasRotas([actions('export { fantasma };')], [])).toEqual(['/painel/rascunho/outras-actions.ts: export que a guarda não lê (export { fantasma } sem declaração no arquivo)']);
    });
    it('export que a guarda não lê → violação: default anônimo, reexportação, desestruturação e let (export type e interface passam)', () => {
      for (const linha of ['export default async function (fd: FormData) {', "export { apagar } from './outro';", 'export * from "./outro";', 'export const { a, b } = fabrica();', 'export let x = 1;']) {
        expect(violacoesDasRotas([actions(`${linha}\n  return 1;\n}`)], []), linha).toEqual([`/painel/rascunho/outras-actions.ts: export que a guarda não lê (${linha})`]);
      }
      expect(violacoesDasRotas([actions('export type Estado = { ok?: boolean };\nexport interface Outro {\n  a: 1;\n}')], [])).toEqual([]);
    });
    it('route.ts: cada handler é uma entrada — GET protegido e POST sem sessão falham no POST; HEAD sem sessão não é conferido', () => {
      const rota: Arquivo = {
        arquivo: 'api/painel/rascunho/route.ts',
        fonte: "export async function GET(req: Request) {\n  await requireApiNutri(req);\n}\n\nexport async function POST(req: Request) {\n  return new Response(null);\n}\n\nexport async function HEAD() {\n  return new Response(null);\n}\n",
      };
      expect(violacoesDasRotas([rota], [])).toEqual(['/api/painel/rascunho#POST: não chama requireNutri nem requireEquipe']);
      const daEquipe: Arquivo = { ...rota, fonte: rota.fonte.replace('return new Response(null);\n}\n\nexport async function HEAD', "await requireApiEquipe(req);\n}\n\nexport async function HEAD") };
      expect(violacoesDasRotas([daEquipe], ['/api/painel/rascunho'])).toEqual(['/api/painel/rascunho#GET: está em ROTAS_DA_RECEPCAO e não chama requireEquipe']);
    });
    it('layout aninhado: só da nutricionista envolvendo rota da lista, requireEquipe sem rota da lista e sem sessão lendo dados → violação', () => {
      const layout = (corpo: string, importa = ''): Arquivo => ({ arquivo: 'painel/rascunho/layout.tsx', fonte: `${importa}export default async function L({ children }) {\n  ${corpo}\n}\n` });
      const telaDaRecepcao = pagina("await requireEquipe('/painel/rascunho');");
      expect(violacoesDasRotas([telaDaRecepcao, layout("await requireNutri('/painel/rascunho');\n  return children;")], ['/painel/rascunho'])).toEqual([
        '/painel/rascunho/layout.tsx: só da nutricionista e envolve /painel/rascunho',
      ]);
      expect(violacoesDasRotas([layout("await requireEquipe('/painel/rascunho');\n  return children;")], [])).toEqual([
        '/painel/rascunho/layout.tsx: chama requireEquipe e nenhuma rota de ROTAS_DA_RECEPCAO fica sob ele',
      ]);
      expect(violacoesDasRotas([layout('return children;', "import { lerAlgo } from '@/modules/algo';\n")], [])).toEqual(['/painel/rascunho/layout.tsx: sem sessão e importa módulo, banco ou sessão']);
      expect(violacoesDasRotas([layout('return children;'), layout("await requireNutri('/x');\n  return children;")], [])).toEqual([]);
      expect(violacoesDasRotas([telaDaRecepcao, layout("await requireEquipe('/painel/rascunho');\n  return children;")], ['/painel/rascunho'])).toEqual([]);
    });
  });
});
