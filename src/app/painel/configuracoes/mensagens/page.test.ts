import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { consultorioDoChat } from '../../../../../test/mensagens';
import type { TenantDeTeste } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { lerConfiguracao } from '@/modules/mensagens/horario';

// Plano 25, T6c (US-446, RN-451, RN-472, §6.2 "Configuração", §7.5): a tela "Atendimento por mensagens", com o banco de
// verdade; só a sessão e o runtime do Next simulados.
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/cache', () => cache);
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
const { default: Configuracao } = await import('./page');
const { salvarHorarioAction } = await import('./actions');
const { FormularioDoHorario } = await import('./horario-form');
const { estadoDeFalha, configDoFormulario } = await import('./formulario');

const db = getDb();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
const C = MSG_MENSAGENS.configuracao;

async function consultorio(): Promise<TenantDeTeste> {
  const T = await consultorioDoChat(db, owner.pool);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant };
  return T;
}
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const tela = async (busca: Record<string, string> = {}) => html(await Configuracao({ searchParams: Promise.resolve(busca) } as never));
const form = (pares: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of pares) f.append(k, v);
  return f;
};
const erro = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const fieldset = (h: string, dia: string) => new RegExp(`<fieldset[^>]*>\\s*<legend[^>]*>${dia}</legend>[\\s\\S]*?</fieldset>`).exec(h)?.[0] ?? '';

describe('/painel/configuracoes/mensagens (US-446)', () => {
  it('h1, as duas chaves no topo (padrões sem linha: horário desligado, aviso ligado), um <fieldset> com <legend> por dia e "Salvar"', async () => {
    await consultorio();
    const h = await tela();
    expect(h).toMatch(new RegExp(`<h1[^>]*>${C.titulo}</h1>`));
    expect(h).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*name="horario")(?![^>]*checked)[^>]*>/);
    expect(h).toContain(C.mostrarHorario);
    expect(h).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*name="aviso")(?=[^>]*checked="")[^>]*>/);
    expect(h).toContain(C.avisoEmail);
    // a ajuda do aviso ligada ao campo
    const idAjuda = new RegExp(`<p[^>]*id="([^"]+)"[^>]*>${C.ajudaAviso}</p>`).exec(h)?.[1];
    expect(idAjuda).toBeTruthy();
    expect(h).toMatch(new RegExp(`<input(?=[^>]*name="aviso")(?=[^>]*aria-describedby="${idAjuda}")[^>]*>`));
    for (const dia of C.dias) expect(fieldset(h, dia), dia).toBeTruthy();
    expect(h.match(/<fieldset/g)?.length).toBe(7);
    expect(h.match(new RegExp(`>${C.acrescentarFaixa}</button>`, 'g'))?.length).toBe(7);
    expect(h).toContain(`>${C.salvar}</button>`);
    expect(h).toMatch(/<p(?=[^>]*role="status")[^>]*><\/p>/);
  });

  it('cada faixa: "Das"/"Às" em <select> de 15 em 15 min com "24:00" no fim e o nome acessível completo; "Remover faixa {k} de {dia}"', () => {
    const h = html(
      createElement(FormularioDoHorario, {
        inicial: { horarioAtivo: true, avisoEmail: true, faixas: [{ diaSemana: 1, inicioMin: 540, fimMin: 720 }, { diaSemana: 1, inicioMin: 840, fimMin: 1440 }] },
      }),
    );
    const segunda = fieldset(h, 'Segunda');
    const selects = [...segunda.matchAll(/<select[^>]*>[\s\S]*?<\/select>/g)].map((m) => m[0]);
    expect(selects).toHaveLength(4);
    expect(selects[0]).toMatch(/aria-label="Segunda, faixa 1, das"/);
    expect(selects[1]).toMatch(/aria-label="Segunda, faixa 1, às"/);
    expect(selects[3]).toMatch(/aria-label="Segunda, faixa 2, às"/);
    const opcoes = [...selects[0].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    expect(opcoes).toHaveLength(97);
    expect(opcoes[0]).toEqual(['0', '00:00']);
    expect(opcoes[1]).toEqual(['15', '00:15']);
    expect(opcoes.at(-1)).toEqual(['1440', '24:00']);
    expect(selects[0]).toMatch(/<option[^>]*value="540"[^>]*selected=""/);
    expect(selects[3]).toMatch(/<option[^>]*value="1440"[^>]*selected=""/);
    expect(segunda).toMatch(new RegExp(`<label[^>]*>${C.das}</label>`));
    expect(segunda).toMatch(new RegExp(`<label[^>]*>${C.as}</label>`));
    expect(segunda).toMatch(/<button(?=[^>]*type="button")(?=[^>]*aria-label="Remover faixa 2 de Segunda")[^>]*>Remover faixa<\/button>/);
    expect(fieldset(h, 'Domingo')).not.toContain('<select');
  });

  it('salvar: grava e volta com "Configuração salva." na região de status; a tela mostra o que foi gravado', async () => {
    const T = await consultorio();
    const r = await erro(salvarHorarioAction(null, form([['horario', 'sim'], ['inicio-1', '540'], ['fim-1', '720'], ['inicio-1', '840'], ['fim-1', '1440'], ['inicio-5', '480'], ['fim-5', '600']])));
    expect(r).toMatch(/^redirect \/painel\/configuracoes\/mensagens\?ok=salva&r=[0-9a-f]{8}$/);
    expect(cache.revalidatePath).toHaveBeenCalled();
    expect(await lerConfiguracao(T.ctx, db)).toEqual({
      horarioAtivo: true,
      avisoEmail: false,
      faixas: [
        { diaSemana: 1, inicioMin: 540, fimMin: 720 },
        { diaSemana: 1, inicioMin: 840, fimMin: 1440 },
        { diaSemana: 5, inicioMin: 480, fimMin: 600 },
      ],
    });
    const h = await tela({ ok: 'salva', r: 'abcdef01' });
    // rodada da T6c (I3): a região fica sempre montada (sem key), focável, e recebe o foco quando `r` muda
    expect(h).toMatch(new RegExp(`<p(?=[^>]*role="status")(?=[^>]*tabindex="-1")[^>]*>${C.salva}</p>`, 'i'));
    expect(readFileSync('src/app/painel/configuracoes/mensagens/page.tsx', 'utf8')).not.toMatch(/<p key=/);
    expect(h).toMatch(/<input(?=[^>]*name="horario")(?=[^>]*checked="")[^>]*>/);
    expect(h).toMatch(/<input(?=[^>]*name="aviso")(?![^>]*checked)[^>]*>/);
    expect(fieldset(h, 'Segunda').match(/<select/g)).toHaveLength(4);
    expect(await tela({ ok: 'outra' })).toMatch(/<p(?=[^>]*role="status")[^>]*><\/p>/);
  });

  it('os erros exatos junto à faixa (aria-describedby, aria-invalid), com as faixas enviadas de volta; nada gravado', async () => {
    const T = await consultorio();
    const casos: [[string, string][], string, string][] = [
      [[['inicio-2', '720'], ['fim-2', '540']], C.fimAntesDoInicio, 'Terça, faixa 1, das'],
      [[['inicio-2', '540'], ['fim-2', '720'], ['inicio-2', '600'], ['fim-2', '900']], C.sobreposicao, 'Terça, faixa 2, das'],
      [[['inicio-3', '0'], ['fim-3', '60'], ['inicio-3', '120'], ['fim-3', '180'], ['inicio-3', '240'], ['fim-3', '300'], ['inicio-3', '360'], ['fim-3', '420']], C.faixasDemais, 'Quarta, faixa 4, das'],
    ];
    for (const [pares, mensagem, rotulo] of casos) {
      const estado = await salvarHorarioAction(null, form([['aviso', 'sim'], ...pares]));
      expect(estado, mensagem).toMatchObject({ erro: { mensagem } });
      const h = html(createElement(FormularioDoHorario, { inicial: { horarioAtivo: false, avisoEmail: true, faixas: [] }, estadoInicial: estado }));
      const id = new RegExp(`<p(?=[^>]*id="([^"]+)")(?=[^>]*role="alert")[^>]*>${mensagem}</p>`).exec(h)?.[1];
      expect(id, mensagem).toBeTruthy();
      expect(h).toMatch(new RegExp(`<select(?=[^>]*aria-label="${rotulo}")(?=[^>]*aria-describedby="${id}")(?=[^>]*aria-invalid="true")[^>]*>`));
    }
    expect(await lerConfiguracao(T.ctx, db)).toEqual({ horarioAtivo: false, avisoEmail: true, faixas: [] });
  });

  it('valor que o formulário não produz (fora do passo de 15 min, texto) é recusado sem gravar', async () => {
    const T = await consultorio();
    expect(await erro(salvarHorarioAction(null, form([['inicio-1', '545'], ['fim-1', '720']])))).toMatch(/faixa inválida/);
    expect(await erro(salvarHorarioAction(null, form([['inicio-1', 'abc'], ['fim-1', '720']])))).toMatch(/faixa inválida/);
    expect(await lerConfiguracao(T.ctx, db)).toEqual({ horarioAtivo: false, avisoEmail: true, faixas: [] });
  });

  it('o hub: o cartão "Atendimento por mensagens" no fim de CARTOES; page e action com requireNutri', () => {
    const hub = readFileSync('src/app/painel/configuracoes/page.tsx', 'utf8');
    const cartoes = /const CARTOES = \[([\s\S]*?)\];/.exec(hub)?.[1] ?? '';
    const linhas = cartoes.split('\n').filter((l) => l.includes('href:'));
    expect(linhas.at(-1)).toContain("'/painel/configuracoes/mensagens'");
    expect(linhas.at(-1)).toMatch(/MSG_MENSAGENS\.configuracao\.hubTitulo/);
    expect(linhas.at(-1)).toMatch(/MSG_MENSAGENS\.configuracao\.hubDescricao/);
    expect(readFileSync('src/app/painel/configuracoes/mensagens/page.tsx', 'utf8')).toMatch(/requireNutri\(/);
    expect(readFileSync('src/app/painel/configuracoes/mensagens/actions.ts', 'utf8')).toMatch(/requireNutri\(/);
  });

  it('rodada da T6c (I4): falha ao salvar no servidor → "Não foi possível salvar. Tente de novo." com a configuração enviada de volta (nada se perde)', async () => {
    const T = await consultorio();
    // um erro inesperado do módulo (aqui, a sessão que não é `nutri`): log só de nome e SQLSTATE, a tela com o texto da CH-D76
    sessao.atual = { ...(sessao.atual as object), ctx: { ...T.ctx, role: 'worker' } };
    const estado = await salvarHorarioAction(null, form([['horario', 'sim'], ['inicio-4', '540'], ['fim-4', '600']]));
    expect(estado).toMatchObject({ erro: null, erroGeral: C.falha, config: { horarioAtivo: true, avisoEmail: false, faixas: [{ diaSemana: 4, inicioMin: 540, fimMin: 600 }] } });
    expect(C.falha).toBe('Não foi possível salvar. Tente de novo.');
    const h = html(createElement(FormularioDoHorario, { inicial: { horarioAtivo: false, avisoEmail: true, faixas: [] }, estadoInicial: estado }));
    expect(h).toMatch(new RegExp(`<p(?=[^>]*role="alert")[^>]*>${C.falha}</p>`));
    expect(fieldset(h, 'Quinta').match(/<select/g)).toHaveLength(2);
  });

  it('rodada da T6c (I4): rede caída no cliente → o mesmo texto e a configuração tirada do formulário enviado', () => {
    const dados = form([['aviso', 'sim'], ['inicio-0', '60'], ['fim-0', '120']]);
    expect(configDoFormulario(dados)).toEqual({ horarioAtivo: false, avisoEmail: true, faixas: [{ diaSemana: 0, inicioMin: 60, fimMin: 120 }] });
    const e = estadoDeFalha(dados, { horarioAtivo: true, avisoEmail: true, faixas: [] });
    expect(e).toMatchObject({ erro: null, erroGeral: C.falha, config: { avisoEmail: true, faixas: [{ diaSemana: 0, inicioMin: 60, fimMin: 120 }] } });
    // formulário adulterado no cliente: volta a configuração que estava na tela
    expect(estadoDeFalha(form([['inicio-0', 'x'], ['fim-0', '1']]), { horarioAtivo: true, avisoEmail: false, faixas: [] }).config).toEqual({ horarioAtivo: true, avisoEmail: false, faixas: [] });
    const f = readFileSync('src/app/painel/configuracoes/mensagens/horario-form.tsx', 'utf8');
    expect(f).toMatch(/seguraFalhaDeRede\(/);
  });

  it('rodada da T6c (I1, I2): o foco vai à faixa com erro (rolada ao centro); ao acrescentar, ao "Das" da nova; ao remover, à vizinha ou ao "Acrescentar faixa"', () => {
    const f = readFileSync('src/app/painel/configuracoes/mensagens/horario-form.tsx', 'utf8');
    expect(f).toMatch(/scrollIntoView\(\{ block: 'center' \}\)/);
    expect(f).toMatch(/`faixa-\$\{erro\.dia\}-\$\{erro\.k\}-das`/);
    expect(f).toMatch(/id=\{`acrescentar-\$\{dia\}`\}/);
    expect(f).toMatch(/focarDepois\.current = /);
    // re-revisão da T7: o alvo "mensagens-24h" ficou órfão (nenhum guia aponta para ele) e saiu
    expect(f).not.toContain('mensagens-24h');
  });

  it('P25-06c: os <select> das faixas são não controlados (defaultValue), para o reset automático do formulário depois da action manter o que foi escolhido', () => {
    // O React 19 chama form.reset() depois de toda action do `<form action>`. Um `<select value>` montado no cliente não
    // marca `defaultSelected` em nenhuma opção, e o reset leva todos ao primeiro valor ("00:00") — depois do erro de faixa e
    // da rede caída, a nutricionista perdia o que tinha escolhido. Com `defaultValue`, a opção montada (a da configuração
    // devolvida, depois da remontagem pela `marca`) é a `defaultSelected`, e o reset a mantém.
    const f = readFileSync('src/app/painel/configuracoes/mensagens/horario-form.tsx', 'utf8');
    const selects = f.match(/<select\n[\s\S]*?\n\s*>\n/g) ?? []; // a tag de abertura inteira (com o `=>` dos handlers)
    expect(selects).toHaveLength(2);
    for (const s of selects) {
      expect(s).toMatch(/\bdefaultValue=\{/);
      expect(s).not.toMatch(/\svalue=\{/);
    }
    // as chaves do topo também ficam não controladas
    const chaves = f.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(chaves).toHaveLength(2);
    for (const c of chaves) {
      expect(c).toMatch(/\bdefaultChecked=\{/);
      expect(c).not.toMatch(/\schecked=\{/);
    }
  });

  it('re-revisão da T7 (minor): a região do "Configuração salva." vazia não ocupa espaço (sem margem quando vazia, junto ao h1)', () => {
    const f = readFileSync('src/app/painel/configuracoes/mensagens/horario-form.tsx', 'utf8');
    expect(f).toMatch(/<p ref=\{ref\} role="status" tabIndex=\{-1\} className="[^"]*\bmt-2\b[^"]*\bempty:mt-0\b/);
    const pg = readFileSync('src/app/painel/configuracoes/mensagens/page.tsx', 'utf8');
    expect(pg).toMatch(/<div>\s*<h1[\s\S]*?<\/h1>\s*<AvisoDeSalvo[^>]*\/>\s*<\/div>/);
  });
});
