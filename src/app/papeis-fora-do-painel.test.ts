import { describe, expect, it } from 'vitest';
import { arquivosDoApp, rotaDoArquivo, semComentarios, type Arquivo } from '../../test/fonte';
import { FORA_DO_PAINEL } from './painel/rotas-da-recepcao';

/**
 * Plano 26 (RE-D67, RN-513): fora de `src/app/painel` e `src/app/api/painel` não há `requireEquipe`; quem decide é a
 * lista de papéis de cada `requireUser(` (e `requireUserComTenant(`), `requireApiUser(` e `lerSessaoApi(`. Todo arquivo de `src/app` fora do painel com
 * uma dessas chamadas tem a decisão explícita para a recepção: **aceita** (a lista de papéis tem `recepcao` e a rota está em
 * `FORA_DO_PAINEL`) ou **recusa** (nenhuma lista tem `recepcao`). Arquivo novo sem decisão quebra aqui.
 */
type Decisao = 'aceita' | 'recusa';
const PAPEIS_FORA_DO_PAINEL: Record<string, Decisao> = {
  // entrada e sessão da recepção (RE-D67, RE-D45)
  'inicio/page.tsx': 'aceita',
  'conta/outro-papel/page.tsx': 'aceita',
  'conta/seguranca/page.tsx': 'aceita',
  'conta/acesso-desativado/page.tsx': 'aceita',
  'api/sessao/ativa/route.ts': 'aceita',
  // administração da plataforma: só o admin
  'admin/actions.ts': 'recusa',
  'admin/page.tsx': 'recusa',
  'admin/contas/nova/page.tsx': 'recusa',
  'admin/contas/[id]/page.tsx': 'recusa',
  'admin/servidor/page.tsx': 'recusa',
  'admin/seguranca/page.tsx': 'recusa',
  // portal e convite do paciente: só o paciente
  'p/escolher/page.tsx': 'recusa',
  'p/escolher/actions.ts': 'recusa',
  'p/sem-acesso/page.tsx': 'recusa',
  'api/p/vinculo/route.ts': 'recusa',
  'api/p/push/route.ts': 'recusa',
  'convite/paciente/[token]/actions.ts': 'recusa',
};

const CHAMADA = /\b(requireUser|requireUserComTenant|requireApiUser|lerSessaoApi)\s*\(/g;

/** A lista de papéis de cada chamada (literal ou constante do próprio arquivo); `null` se não der para ler. */
function listasDePapeis(fonte: string): (string[] | null)[] {
  const s = semComentarios(fonte);
  return [...s.matchAll(CHAMADA)].map((m) => {
    const resto = s.slice(m.index! + m[0].length);
    // requireUser(<papéis>, …) e requireUserComTenant(<papéis>, …); requireApiUser(req, <papéis>, …) e lerSessaoApi(req, <papéis>)
    const arg = (m[1].startsWith('requireUser') ? /^\s*(\[[^\]]*\]|\w+)/ : /^\s*\w+\s*,\s*(\[[^\]]*\]|\w+)/).exec(resto)?.[1];
    if (!arg) return null;
    const literal = arg.startsWith('[') ? arg : new RegExp(`const\\s+${arg}\\b[^=]*=\\s*(\\[[^\\]]*\\])`).exec(s)?.[1];
    return literal ? [...literal.matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : null;
  });
}

function violacoesForaDoPainel(arquivos: Arquivo[], decisoes: Record<string, Decisao>, fora: readonly string[]): string[] {
  const v: string[] = [];
  const aceitas = new Set<string>();
  for (const { arquivo, fonte } of arquivos) {
    const listas = listasDePapeis(fonte);
    const decisao = decisoes[arquivo];
    if (!listas.length) {
      if (decisao) v.push(`${arquivo}: tem decisão e não chama requireUser/requireApiUser/lerSessaoApi`);
      continue;
    }
    if (!decisao) {
      v.push(`${arquivo}: sem decisão para a recepção em PAPEIS_FORA_DO_PAINEL`);
      continue;
    }
    if (listas.some((l) => l === null)) v.push(`${arquivo}: lista de papéis que a guarda não lê`);
    const comRecepcao = listas.filter((l) => l?.includes('recepcao')).length;
    if (decisao === 'aceita') {
      if (comRecepcao !== listas.length) v.push(`${arquivo}: aceita a recepção, mas nem toda chamada tem 'recepcao'`);
      const rota = rotaDoArquivo(arquivo);
      if (!fora.includes(rota)) v.push(`${arquivo}: aceita a recepção e ${rota} não está em FORA_DO_PAINEL`);
      aceitas.add(rota);
    } else if (comRecepcao > 0) v.push(`${arquivo}: recusa a recepção, mas uma chamada tem 'recepcao'`);
  }
  for (const rota of fora) if (!aceitas.has(rota)) v.push(`${rota}: está em FORA_DO_PAINEL e nenhum arquivo aceita a recepção`);
  for (const arquivo of Object.keys(decisoes)) if (!arquivos.some((a) => a.arquivo === arquivo)) v.push(`${arquivo}: tem decisão e não existe`);
  return v;
}

const FORA = arquivosDoApp('.').filter((a) => !/^(painel|api\/painel)\//.test(a.arquivo));

describe('PAPEIS_FORA_DO_PAINEL (RE-D67): decisão explícita para a recepção fora do painel', () => {
  it('todo requireUser/requireApiUser/lerSessaoApi de src/app fora do painel tem a decisão, e a decisão bate com a lista de papéis', () => {
    expect(violacoesForaDoPainel(FORA, PAPEIS_FORA_DO_PAINEL, FORA_DO_PAINEL)).toEqual([]);
  });

  describe('controle positivo (rascunhos)', () => {
    const base = Object.fromEntries(FORA.map((a) => [a.arquivo, a]));
    const com = (...extras: Arquivo[]) => [...Object.values(base), ...extras];

    it('arquivo novo sem decisão → violação', () => {
      const novo = { arquivo: 'rascunho/page.tsx', fonte: "export default async function P() {\n  await requireUser(['nutri'], '/rascunho');\n}\n" };
      expect(violacoesForaDoPainel(com(novo), PAPEIS_FORA_DO_PAINEL, FORA_DO_PAINEL)).toEqual(['rascunho/page.tsx: sem decisão para a recepção em PAPEIS_FORA_DO_PAINEL']);
    });
    it('"recusa" com recepcao na lista, e "aceita" sem ela ou fora de FORA_DO_PAINEL → violação', () => {
      const recusa = { arquivo: 'rascunho/actions.ts', fonte: "export async function a(req: Request) {\n  await requireApiUser(req, ['paciente', 'recepcao']);\n}\n" };
      expect(violacoesForaDoPainel(com(recusa), { ...PAPEIS_FORA_DO_PAINEL, 'rascunho/actions.ts': 'recusa' }, FORA_DO_PAINEL)).toEqual([
        "rascunho/actions.ts: recusa a recepção, mas uma chamada tem 'recepcao'",
      ]);
      const aceita = { arquivo: 'rascunho/page.tsx', fonte: "const PAPEIS = ['admin', 'nutri'] as const;\nexport default async function P() {\n  await requireUser(PAPEIS, '/rascunho');\n}\n" };
      expect(violacoesForaDoPainel(com(aceita), { ...PAPEIS_FORA_DO_PAINEL, 'rascunho/page.tsx': 'aceita' }, FORA_DO_PAINEL)).toEqual([
        "rascunho/page.tsx: aceita a recepção, mas nem toda chamada tem 'recepcao'",
        'rascunho/page.tsx: aceita a recepção e /rascunho não está em FORA_DO_PAINEL',
      ]);
    });
    it('a constante da lista de papéis é lida (lerSessaoApi(req, EQUIPE)); chamada só em comentário não conta', () => {
      expect(listasDePapeis("const EQUIPE: readonly AppRole[] = ['admin', 'nutri', 'recepcao'];\nconst a = await lerSessaoApi(req, EQUIPE);")).toEqual([['admin', 'nutri', 'recepcao']]);
      expect(listasDePapeis("/** requireUser(['admin'], …) */\n// requireUser(['nutri'], '/x')\nexport const x = 1;")).toEqual([]);
    });
    it('rota de FORA_DO_PAINEL sem arquivo que aceite → violação', () => {
      expect(violacoesForaDoPainel(FORA, PAPEIS_FORA_DO_PAINEL, [...FORA_DO_PAINEL, '/conta/nova'])).toEqual(['/conta/nova: está em FORA_DO_PAINEL e nenhum arquivo aceita a recepção']);
    });
  });
});
