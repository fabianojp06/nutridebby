import { describe, expect, it } from 'vitest';
import { arquivosDoApp, blocosDeTopo, ehDeServerActions, guardasAlcancadas, guardasDoArquivo, rotaDoArquivo, type Arquivo } from '../../../test/fonte';
import { FORA_DO_PAINEL, ROTAS_DA_RECEPCAO } from './rotas-da-recepcao';

/**
 * Plano 26 (RN-504, RN-513, RE-D15, RE-D16): negação por padrão no app. Toda `page.tsx` e `route.ts` de `src/app/painel` e
 * `src/app/api/painel` e toda action exportada de **todo** arquivo com `'use server'` (não só `actions.ts`: também
 * `cobranca-actions.ts`) chama a guarda da nutricionista (`requireNutri`/`requireApiNutri`, ou `carregarProntuario`, que
 * a chama) ou chama `requireEquipe`/`requireApiEquipe` **e** está em `ROTAS_DA_RECEPCAO`; toda entrada da lista existe e
 * chama `requireEquipe`. A chamada pode vir de uma função do próprio arquivo (`acesso(…)` → `requireNutri(…)`).
 */
const NUTRI = ['requireNutri', 'requireApiNutri', 'carregarProntuario'] as const;
const EQUIPE = ['requireEquipe', 'requireApiEquipe'] as const;
const GUARDAS = [...NUTRI, ...EQUIPE];

type Entrada = { chave: string; guardas: Set<string> };

/** As entradas do painel (páginas, rotas e cada action exportada) com as guardas que cada uma alcança. */
function entradas(arquivos: Arquivo[]): Entrada[] {
  return arquivos.flatMap(({ arquivo, fonte }): Entrada[] => {
    if (/(^|\/)(page\.tsx|route\.ts)$/.test(arquivo)) return [{ chave: rotaDoArquivo(arquivo), guardas: guardasDoArquivo(fonte, GUARDAS) }];
    if (!ehDeServerActions(fonte)) return [];
    const blocos = blocosDeTopo(fonte);
    return blocos.filter((b) => b.exportado).map((b) => ({ chave: `/${arquivo}#${b.nome}`, guardas: guardasAlcancadas(blocos, b.nome, GUARDAS) }));
  });
}

/** As violações da RN-513 (vazio = tudo certo). Pura: o controle positivo passa rascunhos. */
function violacoesDasRotas(arquivos: Arquivo[], lista: readonly string[]): string[] {
  const todas = entradas(arquivos);
  const v: string[] = [];
  for (const e of todas) {
    const daEquipe = EQUIPE.some((g) => e.guardas.has(g));
    const daNutri = NUTRI.some((g) => e.guardas.has(g));
    if (daEquipe && !lista.includes(e.chave)) v.push(`${e.chave}: chama requireEquipe e não está em ROTAS_DA_RECEPCAO`);
    if (!daEquipe && !daNutri) v.push(`${e.chave}: não chama requireNutri nem requireEquipe`);
  }
  for (const chave of lista) {
    const e = todas.find((x) => x.chave === chave);
    if (!e) v.push(`${chave}: está em ROTAS_DA_RECEPCAO e não existe`);
    else if (!EQUIPE.some((g) => e.guardas.has(g))) v.push(`${chave}: está em ROTAS_DA_RECEPCAO e não chama requireEquipe`);
  }
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
    const chaves = entradas(DO_PAINEL).map((e) => e.chave);
    expect(chaves).toContain('/painel/agenda/consultas/[id]/cobranca-actions.ts#registrarCobrancaAction');
    expect(chaves).toContain('/painel/pacientes/[id]/documentos/actions.ts#reenviarLinkAction');
    expect(chaves).toContain('/painel/preferencias/actions.ts#escolherTemaAction');
    expect(chaves).toContain('/api/painel/relatorios/csv');
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
  });
});
