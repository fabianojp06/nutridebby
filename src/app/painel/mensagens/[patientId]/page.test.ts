import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { consultorioDoChat, mensagemDoDono, naSessao, pacienteDoChat, recadoPara } from '../../../../../test/mensagens';
import { novoPaciente, type TenantDeTeste } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { liberarConversa, minhaConversa, pausarConversa } from '@/modules/mensagens/conversa';

// Plano 25, T6b (US-440, US-441, US-450; RN-441, RN-442, RN-448, RN-471, RN-475; §6.2 e §7.2): a conversa no painel, com o
// banco de verdade; só a sessão e o runtime do Next simulados.
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
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/painel/mensagens',
}));
const { default: Conversa, metadata } = await import('./page');
const { enviarAction, liberarAction, pausarAction, retomarAction } = await import('./actions');
const { FormularioDeLiberacao, LiberarDialogo } = await import('./liberar-dialogo');
const { CampoDaConversa } = await import('./campo');
const { SituacaoDaConversa } = await import('./situacao');
const { ListaDeMensagens } = await import('./lista-de-mensagens');

const db = getDb();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // o envio enfileira os avisos ao paciente
  await closeDb();
  await owner.pool.end();
});
beforeEach(() => cache.revalidatePath.mockClear());
const M = MSG_MENSAGENS;
const CRN = 'CRN-4 12345';
const NOME_PROF = 'Débora Nutricionista';

async function consultorio(o: { carimbo?: boolean } = {}) {
  const T = await consultorioDoChat(db, owner.pool);
  await owner.pool.query('update tenants set crn = $1 where id = $2', [o.carimbo === false ? null : CRN, T.tenantId]);
  await sessaoDe(T);
  return T;
}
async function sessaoDe(T: TenantDeTeste) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant };
}
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const conversa = async (patientId: string, busca: Record<string, string> = {}) =>
  html(await Conversa({ params: Promise.resolve({ patientId }), searchParams: Promise.resolve(busca) } as never));
const erro = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const leituras = async (T: TenantDeTeste) => (await naSessao(db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler' and entidade = 'chat'`))[0].n as number;
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const regiao = (h: string) => /<p(?=[^>]*\brole="status")[^>]*>([\s\S]*?)<\/p>/.exec(h);
const hoje = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

describe('/painel/mensagens/[patientId] — a conversa (US-441)', () => {
  it('o <title> é "Mensagens" (nunca o nome do paciente)', () => {
    expect(metadata).toEqual({ title: 'Mensagens' });
  });

  it('nome, "Abrir ficha", "Liberada em…", as mensagens com hora (<time datetime>), autor, carimbo sem "CRN" repetido, risco, recado; a região viva montada e vazia; auditRead uma vez', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T, { nome: 'Ana Souza Lima' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'Preciso de ajuda', risco: 'emergencia' });
    await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'Oi, Ana. Estou aqui.' });
    await recadoPara(db, T, [ana.p], 'Feriado na sexta');
    const antes = await leituras(T);
    const h = await conversa(ana.p);
    expect(await leituras(T)).toBe(antes + 1);
    expect(h).toMatch(/<h1[^>]*>Ana Souza Lima<\/h1>/);
    expect(h).toMatch(new RegExp(`<a (?=[^>]*href="/painel/pacientes/${ana.p}")[^>]*>${M.conversa.abrirFicha}</a>`));
    expect(h).toContain(M.estados.liberadaEm(hoje(), 'aceite por escrito'));
    expect(h).toMatch(/<ul(?=[^>]*aria-label="Mensagens")[^>]*>/);
    expect(h).toContain(`>${M.conversa.hoje}<`);
    expect(h).toContain('Preciso de ajuda');
    expect(h).toContain('Oi, Ana. Estou aqui.');
    // hora de cada mensagem no fuso, com o instante completo no datetime
    expect(h.match(/<time dateTime="\d{4}-\d{2}-\d{2}T[^"]+">\d{2}:\d{2}<\/time>/g)?.length).toBe(3);
    // autores (RN-471): o primeiro nome do paciente, "Você" e o carimbo da linha sob o bloco da equipe
    expect(h).toContain('>Ana<');
    expect(h).toContain(`>${M.conversa.voce}<`);
    expect(h).toContain(M.conversa.carimbo(NOME_PROF, CRN));
    expect(h).not.toContain('CRN CRN');
    expect(h).not.toMatch(/CRN CRN-|· CRN CRN/);
    // risco: o selo de alerta na mensagem do paciente
    expect(h).toMatch(/border-erro[^"]*"><svg aria-hidden="true"[\s\S]*?<\/svg>Sinal de risco</);
    // a cópia do recado (CH-D68): o rótulo "Recado" e o carimbo da linha
    const recado = /<li[^>]*data-recado=""[^>]*>[\s\S]*?<\/li>/.exec(h)?.[0] ?? '';
    expect(recado).toContain('Feriado na sexta');
    expect(recado).toContain(`>${M.conversa.recado}<`);
    expect(recado).toContain(M.conversa.carimbo(NOME_PROF, CRN));
    // a região viva sempre montada, vazia, sem rolar (sem ?ok=)
    expect(regiao(h)?.[1]).toBe('');
    expect(h).toMatch(/<p(?=[^>]*\brole="status")(?=[^>]*tabindex="-1")[^>]*>/i);
    // o campo e o envio
    expect(h).toMatch(new RegExp(`<label[^>]*for="texto-mensagem"[^>]*>${M.conversa.campo}</label>`));
    expect(h).toMatch(/<textarea(?=[^>]*id="texto-mensagem")(?=[^>]*name="texto")[^>]*>/);
    expect(h).toContain(`>${M.conversa.enviar}</button>`);
    expect(h).toContain(`>${M.pausa.botao}</button>`);
    expect(h).not.toContain(M.pausa.retomar);
  });

  it('"Enviada" nas próprias ainda não lidas; "Lida" na última própria que o paciente já passou', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'primeira' });
    await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'segunda' });
    const h = await conversa(ana.p);
    expect(h.match(new RegExp(`>${M.conversa.enviada}<`, 'g'))).toHaveLength(2);
    expect(h).not.toContain(`>${M.conversa.lida}<`);
    await minhaConversa(ana.P, {}, db); // o paciente abre
    const depois = await conversa(ana.p);
    expect(depois.match(new RegExp(`>${M.conversa.lida}<`, 'g'))).toHaveLength(1);
    expect(depois).not.toContain(`>${M.conversa.enviada}<`);
    expect(depois.indexOf(`>${M.conversa.lida}<`)).toBeGreaterThan(depois.indexOf('segunda'));
  });

  it('?ok= anuncia na região viva (que recebe o foco, sem rolar); código fora da lista não mostra nada', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    expect(regiao(await conversa(ana.p, { ok: 'liberada' }))?.[1]).toBe(M.liberacao.sucesso);
    expect(regiao(await conversa(ana.p, { ok: 'pausada' }))?.[1]).toBe(M.pausa.sucesso);
    expect(regiao(await conversa(ana.p, { ok: 'retomada' }))?.[1]).toBe(M.pausa.retomada);
    expect(regiao(await conversa(ana.p, { ok: '<script>' }))?.[1]).toBe('');
    expect(readFileSync('src/app/painel/mensagens/[patientId]/situacao.tsx', 'utf8')).toMatch(/focarAviso[\s\S]*\.focus\(/);
  });

  it('não liberada: o texto e "Liberar conversa", sem campo; o diálogo tem o select ("Escolha" e as duas formas), a confirmação e o erro junto ao campo', async () => {
    const T = await consultorio();
    const bia = await pacienteDoChat(db, T, { nome: 'Bia Lima', liberar: false });
    const h = await conversa(bia.p);
    expect(h).toContain(M.estados.naoLiberada('Bia Lima'));
    expect(h).toContain(`>${M.liberacao.botao}</button>`);
    expect(h).not.toContain(`>${M.conversa.enviar}</button>`);
    expect(h).not.toContain(M.pausa.botao);
    expect(h).not.toContain('<textarea');
    const dialogo = html(createElement(FormularioDeLiberacao, { patientId: bia.p, nome: 'Bia Lima', aoCancelar: () => undefined }));
    // rodada da T6b (minor): a orientação do TCLE é a descrição do diálogo (aria-describedby), não um parágrafo do formulário
    const casca = html(createElement(LiberarDialogo, { patientId: bia.p, nome: 'Bia Lima' }));
    const idDescricao = /<dialog[^>]*aria-describedby="([^"]+)"/.exec(casca)?.[1];
    expect(idDescricao).toBeTruthy();
    expect(casca).toContain(`<p id="${idDescricao}" class="mt-2">${M.liberacao.texto}</p>`);
    expect(dialogo).not.toContain(M.liberacao.texto);
    expect(dialogo).toContain(M.liberacao.avisoENutricionista);
    expect(dialogo).toMatch(new RegExp(`<label[^>]*for="forma-tcle"[^>]*>${M.liberacao.perguntaForma.replace(/[()?]/g, '\\$&')}</label>`));
    const opcoes = [...dialogo.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    expect(opcoes).toEqual([
      ['', M.liberacao.opcaoInicial],
      ['termo_assinado', 'Termo assinado (em papel ou digital)'],
      ['aceite_escrito', 'Aceite por escrito (mensagem ou e-mail)'],
    ]);
    expect(dialogo).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*name="confirmacao")[^>]*>/);
    expect(dialogo).toContain(M.liberacao.confirmacao);
    expect(dialogo).toContain(`>${M.liberacao.liberar}</button>`);
    expect(dialogo).toContain(`>${M.liberacao.cancelar}</button>`);
    expect(dialogo).not.toContain(M.liberacao.erro);
    const comErro = html(
      createElement(FormularioDeLiberacao, { patientId: bia.p, nome: 'Bia Lima', aoCancelar: () => undefined, estadoInicial: { marca: 'x', erro: M.liberacao.erro, forma: 'termo_assinado', confirmou: false, semCarimbo: false } }),
    );
    const idErro = new RegExp(`<p(?=[^>]*id="([^"]+)")[^>]*>${M.liberacao.erro}</p>`).exec(comErro)?.[1];
    expect(idErro).toBeTruthy();
    expect(comErro).toMatch(new RegExp(`<select(?=[^>]*aria-describedby="${idErro}")(?=[^>]*aria-invalid="true")[^>]*>`));
    expect(comErro).toMatch(/<option[^>]*value="termo_assinado"[^>]*selected=""/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/liberar-dialogo.tsx', 'utf8')).toMatch(/<Dialogo\b/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/liberar-dialogo.tsx', 'utf8')).not.toMatch(/window\.confirm|ConfirmarBotao/);
  });

  it('liberarAction: sem a forma ou a confirmação → o erro (nada gravado); com as duas → ?ok=liberada e a conversa liberada', async () => {
    const T = await consultorio();
    const bia = await pacienteDoChat(db, T, { nome: 'Bia Lima', liberar: false });
    const semForma = await liberarAction(bia.p, null, form({ confirmacao: 'sim' }));
    expect(semForma).toMatchObject({ erro: M.liberacao.erro, forma: '', confirmou: true });
    const semConfirmar = await liberarAction(bia.p, null, form({ forma: 'aceite_escrito' }));
    expect(semConfirmar).toMatchObject({ erro: M.liberacao.erro, forma: 'aceite_escrito', confirmou: false });
    expect(await conversa(bia.p)).toContain(M.estados.naoLiberada('Bia Lima'));
    // rodada da T6c (minor 2 da T6b): `r` muda a cada ato, para a região reanunciar e refocar o mesmo texto
    expect(await erro(liberarAction(bia.p, null, form({ forma: 'termo_assinado', confirmacao: 'sim' })))).toMatch(new RegExp(`^redirect /painel/mensagens/${bia.p}\\?ok=liberada&r=[0-9a-f]{8}$`));
    expect(cache.revalidatePath).toHaveBeenCalledWith('/painel', 'layout');
    expect(await conversa(bia.p)).toContain(M.estados.liberadaEm(hoje(), 'termo assinado'));
  });

  it('sem carimbo: liberar mostra o texto com o link ao Perfil (sem o botão); a ação devolve o mesmo texto', async () => {
    const T = await consultorio({ carimbo: false });
    const p = await novoPaciente(db, T.ctx, { nome: 'Caio Reis' });
    const h = await conversa(p.id);
    expect(h).toMatch(/Para liberar a conversa, preencha seu nome e seu CRN em <a (?=[^>]*href="\/painel\/configuracoes\/perfil")[^>]*>Configurações<\/a>\./);
    expect(h).not.toContain(`>${M.liberacao.botao}</button>`);
    expect(await liberarAction(p.id, null, form({ forma: 'aceite_escrito', confirmacao: 'sim' }))).toMatchObject({ erro: M.liberacao.semCarimbo, semCarimbo: true });
  });

  it('liberada e o carimbo apagado depois: no lugar do campo, o texto do envio com o link ao Perfil', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await owner.pool.query('update tenants set crn = null where id = $1', [T.tenantId]);
    await sessaoDe(T);
    const h = await conversa(ana.p);
    expect(h).toMatch(/Para enviar, preencha seu nome e seu CRN em <a (?=[^>]*href="\/painel\/configuracoes\/perfil")[^>]*>Configurações<\/a>\./);
    expect(h).not.toContain('<textarea');
    expect(await pausarAction(ana.p)).toMatchObject({ erro: M.pausa.semCarimbo, semCarimbo: true }); // CH-D75
  });

  it('pausada: o selo, "Retomar conversa" e sem campo; pausar → ?ok=pausada; retomar → ?ok=retomada', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T, { nome: 'Ana Souza' });
    expect(await erro(pausarAction(ana.p))).toMatch(new RegExp(`^redirect /painel/mensagens/${ana.p}\\?ok=pausada&r=[0-9a-f]{8}$`));
    expect(cache.revalidatePath).toHaveBeenCalledWith('/painel', 'layout');
    const h = await conversa(ana.p);
    expect(h).toContain(M.estados.seloPausada);
    expect(h).toContain(`>${M.pausa.retomar}</button>`);
    expect(h).not.toContain(`>${M.pausa.botao}</button>`);
    expect(h).not.toContain('<textarea');
    expect(await erro(retomarAction(ana.p))).toMatch(new RegExp(`^redirect /painel/mensagens/${ana.p}\\?ok=retomada&r=[0-9a-f]{8}$`));
    const r = await conversa(ana.p);
    expect(r).toContain('<textarea');
    expect(r).not.toContain(M.estados.seloPausada);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/pausar-dialogo.tsx', 'utf8')).toMatch(/<Dialogo\b/);
  });

  it('arquivado e bloqueado: só leitura (o texto, as mensagens e nenhum campo ou ato)', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await mensagemDoDono(owner.pool, T, ana, { texto: 'mensagem antiga' });
    await owner.pool.query("update patients set status = 'arquivado' where id = $1", [ana.p]);
    const a = await conversa(ana.p);
    expect(a).toContain(M.estados.arquivado);
    expect(a).toContain('mensagem antiga');
    for (const t of ['<textarea', `>${M.pausa.botao}</button>`, `>${M.liberacao.botao}</button>`]) expect(a).not.toContain(t);
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date + 30 where id = $1", [ana.p]);
    const b = await conversa(ana.p);
    expect(b).toContain(M.estados.bloqueado);
    expect(b).not.toContain('<textarea');
  });

  it('anonimizado: o texto da conversa apagada, sem lista nem campo', async () => {
    const T = await consultorio();
    const p = await novoPaciente(db, T.ctx, { nome: 'Davi Melo' });
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date - 2, anonimizado_em = now() where id = $1", [p.id]);
    const h = await conversa(p.id);
    expect(h).toContain(M.estados.anonimizado);
    expect(h).not.toMatch(/aria-label="Mensagens"|<textarea/);
  });

  it('id inexistente, inválido ou de outro consultório → notFound()', async () => {
    const outro = await consultorio();
    const deOutro = await pacienteDoChat(db, outro);
    await consultorio();
    expect(await erro(conversa(deOutro.p))).toBe('notFound');
    expect(await erro(conversa(crypto.randomUUID()))).toBe('notFound');
    expect(await erro(conversa('abc'))).toBe('notFound');
  });

  it('paciente sem conta: o aviso com o nome; o envio grava a mensagem sem nenhuma notificação', async () => {
    const T = await consultorio();
    const p = await novoPaciente(db, T.ctx, { nome: 'Eva Reis' });
    expect(await liberarConversa(T.ctx, p.id, { forma: 'termo_assinado', confirmou: true }, db)).toBe('ok');
    const h = await conversa(p.id);
    expect(h).toContain(M.estados.semAcesso('Eva Reis'));
    expect(h).toContain('<textarea');
    const r = await enviarAction(p.id, null, form({ texto: 'Bem-vinda!', js: '1' }));
    expect(r).toMatchObject({ erro: null, texto: '', enviada: true });
    const [{ n }] = await naSessao(db, T.ctx, sql`select count(*)::int as n from notifications where tenant_id = ${T.tenantId} and patient_id = ${p.id}`);
    expect(n).toBe(0);
    expect(await conversa(p.id)).toContain('Bem-vinda!');
  });

  it('enviarAction: vazio e longo devolvem o erro e o texto; conversa pausada → o erro com o texto; com JS devolve o estado; sem JS volta pela página (redirect)', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    expect(await enviarAction(ana.p, null, form({ texto: '   ', js: '1' }))).toMatchObject({ erro: M.erros.semConteudo, texto: '   ', enviada: false });
    const longo = 'a'.repeat(2001);
    expect(await enviarAction(ana.p, null, form({ texto: longo, js: '1' }))).toMatchObject({ erro: M.erros.textoLongo, texto: longo });
    const ok = await enviarAction(ana.p, null, form({ texto: 'Olá!', js: '1' }));
    expect(ok).toMatchObject({ erro: null, texto: '', enviada: true });
    expect(typeof (ok as { marca: string }).marca).toBe('string');
    expect(cache.revalidatePath).toHaveBeenCalledWith('/painel', 'layout');
    expect(await erro(enviarAction(ana.p, null, form({ texto: 'Sem JS' })))).toBe(`redirect /painel/mensagens/${ana.p}`);
    expect(await conversa(ana.p)).toContain('Sem JS');
    await pausarConversa(T.ctx, ana.p, db);
    expect(await enviarAction(ana.p, null, form({ texto: 'Na pausa', js: '1' }))).toMatchObject({ erro: M.erros.conversaFechada, texto: 'Na pausa', enviada: false });
  });

  it('erro inesperado (paciente de outro consultório, o carimbo limpo no meio): o texto genérico da §6.2 com o texto de volta, nunca um 500 cru', async () => {
    const outro = await consultorio();
    const deOutro = await pacienteDoChat(db, outro);
    await consultorio();
    expect(await enviarAction(deOutro.p, null, form({ texto: 'Oi', js: '1' }))).toMatchObject({ erro: M.erros.falha, texto: 'Oi', enviada: false });
    // CH-D75: o erro genérico de cada ato
    expect(await liberarAction(deOutro.p, null, form({ forma: 'aceite_escrito', confirmacao: 'sim' }))).toMatchObject({ erro: M.liberacao.falha });
    // rodada da T6c (minor 5 da T6b): o erro genérico não marca os campos como inválidos
    const generico = html(
      createElement(FormularioDeLiberacao, { patientId: deOutro.p, nome: 'x', aoCancelar: () => undefined, estadoInicial: { marca: 'g', erro: M.liberacao.falha, forma: 'aceite_escrito', confirmou: true, semCarimbo: false } }),
    );
    expect(generico).toContain(M.liberacao.falha);
    expect(generico).not.toContain('aria-invalid');
    const pausa = await pausarAction(deOutro.p);
    expect(pausa).toMatchObject({ erro: M.pausa.falha, semCarimbo: false });
    expect(typeof (pausa as { marca?: unknown }).marca).toBe('string'); // minor 3 da T6b: o erro repetido é reanunciado
    expect(await erro(retomarAction(deOutro.p))).toMatch(new RegExp(`^redirect /painel/mensagens/${deOutro.p}\\?erro=retomar&r=[0-9a-f]{8}$`));
  });

  it('"Ver mensagens anteriores" com ?antes= (o id da primeira mostrada), sem prefetch; a página anterior mostra as mais antigas', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    const base = Date.parse('2026-11-20T12:00:00Z');
    for (let i = 0; i < 51; i++) await mensagemDoDono(owner.pool, T, ana, { texto: `m${i}`, criadaEm: new Date(base + i * 60_000).toISOString() });
    const h = await conversa(ana.p);
    expect(h).not.toContain('>m0<');
    const primeira = /data-mensagem="([0-9a-f-]{36})"/.exec(h)?.[1];
    expect(h).toMatch(new RegExp(`<a (?=[^>]*href="/painel/mensagens/${ana.p}\\?antes=${primeira}")[^>]*>${M.conversa.verAnteriores}</a>`));
    expect(await conversa(ana.p, { antes: primeira! })).toContain('>m0<');
  });

  it('rodada da T6b: ?erro=retomar mostra "Não foi possível retomar a conversa. Tente de novo." na região; código fora da lista, nada', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    expect(regiao(await conversa(ana.p, { erro: 'retomar' }))?.[1]).toBe(M.pausa.falhaRetomar);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/pausar-dialogo.tsx', 'utf8')).toMatch(/<p key=\{estado\.marca\} role="alert"/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/situacao.tsx', 'utf8')).toMatch(/\[focarAviso, aviso, marcador\]/);
    expect(regiao(await conversa(ana.p, { erro: 'outra' }))?.[1]).toBe('');
  });

  it('rodada da T6b (C1): uma mensagem nova (ou a leitura do paciente) não muda a chave de nada entre a página e o campo nem a região viva — o rascunho e o foco ficam', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T, { nome: 'Ana Souza' });
    await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'primeira' });
    const arvore = async () => Conversa({ params: Promise.resolve({ patientId: ana.p }), searchParams: Promise.resolve({}) } as never);
    const antes = caminhoAte(await arvore(), CampoDaConversa);
    const regiaoAntes = caminhoAte(await arvore(), SituacaoDaConversa);
    expect(antes).not.toBeNull();
    expect(regiaoAntes).not.toBeNull();
    await mensagemDoDono(owner.pool, T, ana, { texto: 'nova do paciente' }); // chega mensagem nova (o refresh da tela)
    await minhaConversa(ana.P, {}, db); // e o paciente lê (o "Lida" muda)
    expect(caminhoAte(await arvore(), CampoDaConversa)).toEqual(antes);
    expect(caminhoAte(await arvore(), SituacaoDaConversa)).toEqual(regiaoAntes);
    for (const passo of antes!) expect(passo, 'nenhuma chave com id de mensagem no caminho').not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/page.tsx', 'utf8')).not.toMatch(/<ProvedorDaLeitura\s[^>]*key=/);
  });

  it('rodada da T6b (minors): os separadores de dia não são itens da lista; sem nome gravado, nada de <p> vazio de autor', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await mensagemDoDono(owner.pool, T, ana, { texto: 'ontem', criadaEm: new Date(Date.now() - 86_400_000).toISOString() });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'hoje' });
    const h = await conversa(ana.p);
    const lista = /<ul(?=[^>]*aria-label="Mensagens")[^>]*>([\s\S]*)<\/ul>/.exec(h)?.[1] ?? '';
    const filhos = [...lista.matchAll(/<li\b([^>]*)>/g)].map((m) => m[1]);
    expect(filhos.length).toBeGreaterThanOrEqual(2);
    for (const a of filhos) expect(a).toMatch(/data-mensagem="/);
    expect(lista).toContain(`>${M.conversa.hoje}<`);
    expect(lista).toContain(`>${M.conversa.ontem}<`);
    // a mensagem da equipe de outra usuária sem o nome gravado (o CHECK não deixa no banco; a tela não confia nisso)
    const semNome = html(
      createElement(ListaDeMensagens, {
        fuso: 'America/Sao_Paulo',
        primeiroNome: 'Ana',
        mensagens: [{ id: crypto.randomUUID(), autor: 'nutri', minha: false, autorNome: null, autorCrn: null, texto: 'oi', recado: false, duvidaEm: null, risco: null, anexo: null, criadaEm: new Date() }],
      }),
    );
    expect(semNome).not.toMatch(/<p class="text-sm font-semibold"><\/p>/);
  });
});

describe('rodada da T6b — diálogos (I2 e minors)', () => {
  it('I2: o <form> do diálogo de liberar não remonta (a chave só nos campos); o foco vai ao primeiro campo inválido ou ao link do Perfil', () => {
    const f = readFileSync('src/app/painel/mensagens/[patientId]/liberar-dialogo.tsx', 'utf8');
    expect(f).not.toMatch(/<form[^>]*\bkey=/);
    expect(f).toMatch(/<CamposDaLiberacao key=\{estado\?\.marca/);
    expect(f).toMatch(/link-perfil-liberacao/);
    expect(f).toMatch(/forma-tcle/);
    expect(f).toMatch(/confirmacao-tcle/);
    expect(f).toMatch(/\.focus\(\)/);
  });
  it('minor: ao fechar o diálogo de pausar, o erro anterior não volta (o formulário remonta a cada abertura); o erro do campo é reanunciado', () => {
    const p = readFileSync('src/app/painel/mensagens/[patientId]/pausar-dialogo.tsx', 'utf8');
    expect(p).toMatch(/<FormularioDePausa key=\{aberturas\}/);
  });
});

type No = { type?: unknown; key?: string | null; props?: { children?: unknown } };
/** O caminho (tipo e chave de cada elemento) da raiz até o primeiro elemento do tipo `alvo`; null se não achar. */
function caminhoAte(raiz: unknown, alvo: unknown): string[] | null {
  const nome = (t: unknown) => (typeof t === 'string' ? t : typeof t === 'function' ? t.name : typeof t === 'symbol' ? String(t) : 'objeto');
  // rodada da T6c (minor 6 da T6b): o índice do irmão entra em cada passo — o React reconcilia pela posição sem `key`
  const andar = (n: unknown, caminho: string[], indice: number): string[] | null => {
    if (Array.isArray(n)) {
      for (const [i, x] of n.entries()) {
        const r = andar(x, caminho, i);
        if (r) return r;
      }
      return null;
    }
    if (!n || typeof n !== 'object') return null;
    const no = n as No;
    const aqui = [...caminho, `${indice}:${nome(no.type)}#${no.key ?? ''}`];
    if (no.type === alvo) return aqui;
    return andar(no.props?.children, aqui, 0);
  };
  return andar(raiz, [], 0);
}
