import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { consultorioDoChat, naSessao, pacienteDoChat, recadoPara, type PacienteDoChat } from '../../../../../test/mensagens';
import type { TenantDeTeste } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { LIMITE_MENSAGENS_HORA, MSG_PORTAL_MENSAGENS, SOCORRO_DO_RISCO } from '@/modules/mensagens/constantes';
import { conversaNoPainel, pausarConversa } from '@/modules/mensagens/conversa';
import { enviarComoNutri, enviarComoPaciente } from '@/modules/mensagens/envio';
import { salvarConfiguracao } from '@/modules/mensagens/horario';

// Plano 25, T7 (US-443; RN-449, RN-450, RN-451, RN-452, RN-471, RN-472, RN-473; §6.2 e §7.3): a conversa no app, com o banco
// de verdade; só a sessão e o runtime do Next simulados (requirePaciente devolve o vínculo que o `?v=` escolheria).
const sessao = vi.hoisted(() => ({ atual: null as unknown, caminhos: [] as string[] }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: vi.fn(async (caminho: string) => {
    sessao.caminhos.push(caminho);
    if (sessao.atual === null) throw new Error('redirect /entrar');
    return sessao.atual;
  }),
}));
vi.mock('next/cache', () => cache);
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/p/mensagens',
}));
const { default: Mensagens, metadata } = await import('./page');
const { enviarMensagemAction } = await import('./actions');
const { CampoDoPortal, SituacaoDoPortal } = await import('./conversa-portal');

const db = getDb();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // o envio enfileira os avisos
  await closeDb();
  await owner.pool.end();
});
beforeEach(() => {
  cache.revalidatePath.mockClear();
  sessao.caminhos = [];
});
const P = MSG_PORTAL_MENSAGENS;
const CRN = 'CRN-4 12345';
const NOME_PROF = 'Débora Nutricionista';

async function consultorio(o: { contatos?: boolean } = {}) {
  const T = await consultorioDoChat(db, owner.pool);
  await owner.pool.query('update tenants set nome_profissional = $1, crn = $2, contato_email = $3, contato_telefone_e164 = $4 where id = $5', [
    NOME_PROF,
    CRN,
    o.contatos ? 'contato@debby.test' : null,
    o.contatos ? '+5521987654321' : null,
    T.tenantId,
  ]);
  return T;
}
/** A sessão do portal como requirePaciente a devolveria (o vínculo escolhido, o consultório dele). */
async function entrarComo(T: TenantDeTeste, c: PacienteDoChat, ctx: TenantContext = c.P) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx, tenant, vinculo: { patientId: c.p, tenantId: T.tenantId } };
}
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const arvore = (busca: Record<string, string> = {}) => Mensagens({ searchParams: Promise.resolve(busca) } as never);
const pagina = async (busca: Record<string, string> = {}) => html(await arvore(busca));
const leituras = async (T: TenantDeTeste) => (await naSessao(db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler' and entidade = 'chat'`))[0].n as number;
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const erro = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const regiao = (h: string) => /<p(?=[^>]*\brole="status")(?=[^>]*id="regiao-da-conversa")[^>]*>([\s\S]*?)<\/p>/.exec(h)?.[1];
const campo = (h: string) => /<textarea(?=[^>]*id="texto-mensagem")[^>]*>([\s\S]*?)<\/textarea>/.exec(h);
const itemCom = (h: string, texto: string) => [...h.matchAll(/<li\b[^>]*data-mensagem="[^"]+"[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]).find((li) => li.includes(texto)) ?? '';

describe('/p/mensagens — a conversa no app (US-443)', () => {
  it('<title> "Mensagens"; cabeçalho de detalhe com "Voltar" para Hoje; requirePaciente com a rota da conversa; sem sessão, o redirect dele', async () => {
    expect(metadata).toEqual({ title: 'Mensagens' });
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const h = await pagina();
    expect(sessao.caminhos).toEqual(['/p/mensagens']);
    expect(h).toMatch(/<h1 id="titulo-da-tela"[^>]*>Mensagens<\/h1>/);
    expect(h).toMatch(/<a [^>]*aria-label="Voltar para Hoje"[^>]*href="\/p\/inicio"|<a [^>]*href="\/p\/inicio"[^>]*aria-label="Voltar para Hoje"/);
    sessao.atual = null;
    expect(await erro(pagina())).toBe('redirect /entrar');
  });

  it('RN-471: "Conversa com {nome profissional}, nutricionista, {crn}" (sem "CRN" repetido) e os contatos do perfil, quando há; RN-450: o aviso de urgência sempre', async () => {
    const T = await consultorio({ contatos: true });
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const h = await pagina();
    expect(h).toContain(`>${P.conversaCom(NOME_PROF, CRN)}<`);
    expect(h).toContain('Conversa com Débora Nutricionista, nutricionista, CRN-4 12345');
    expect(h).not.toContain('CRN CRN');
    expect(h).toMatch(/<a [^>]*href="mailto:contato@debby\.test"[^>]*>contato@debby\.test<\/a>/);
    expect(h).toMatch(/<a [^>]*href="tel:\+5521987654321"[^>]*>\(21\) 98765-4321<\/a>/);
    // o aviso, com o 192 discável
    expect(h.replace(/<[^>]+>/g, '')).toContain(P.avisoUrgencia);
    expect(h).toMatch(/<a href="tel:192"/);
    const semContato = await consultorio();
    const bia = await pacienteDoChat(db, semContato);
    await entrarComo(semContato, bia);
    const h2 = await pagina();
    expect(h2).not.toMatch(/mailto:|tel:\+/);
    expect(h2.replace(/<[^>]+>/g, '')).toContain(P.avisoUrgencia);
  });

  it('as mensagens: "Você" nas do paciente, o carimbo da linha nas da nutricionista, o recado com "Recado do consultório · …", a hora em <time>; uma leitura auditada; a região viva montada e vazia; o campo', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await enviarComoNutri(T.ctx, ana.p, { texto: 'Oi, Ana. Estou aqui.' }, db);
    await enviarComoPaciente(ana.P, { texto: 'Oi! Tenho uma dúvida.' }, db);
    await recadoPara(db, T, [ana.p], 'Feriado na sexta');
    await entrarComo(T, ana);
    const antes = await leituras(T);
    const h = await pagina();
    expect(await leituras(T)).toBe(antes + 1);
    expect(h).toMatch(/<ul(?=[^>]*aria-label="Mensagens")[^>]*>/);
    expect(itemCom(h, 'Oi! Tenho uma dúvida.')).toContain(`>${P.voce}<`);
    expect(itemCom(h, 'Oi, Ana. Estou aqui.')).toContain(P.carimbo(NOME_PROF, CRN));
    const recado = itemCom(h, 'Feriado na sexta');
    expect(recado).toContain('data-recado=""');
    expect(recado).toContain(P.carimboRecado(NOME_PROF, CRN)); // o carimbo gravado pelo gatilho na cópia (RN-475)
    expect(h.match(/<time dateTime="\d{4}-\d{2}-\d{2}T[^"]+">\d{2}:\d{2}<\/time>/g)?.length).toBe(3);
    expect(h).not.toContain('CRN CRN');
    expect(regiao(h)).toBe('');
    expect(h).toMatch(new RegExp(`<label[^>]*for="texto-mensagem"[^>]*>${P.campo}</label>`));
    expect(campo(h)?.[0]).toMatch(/name="texto"/);
    expect(h).toContain(`>${P.enviar}</button>`);
    expect(h).toMatch(/id="rodape-da-conversa"[^>]*class="[^"]*\bsticky\b[^"]*\bbottom-0\b/);
  });

  it('RN-448: "Enviada" nas próprias ainda não lidas; "Lida" na última própria que a nutricionista já passou', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await enviarComoPaciente(ana.P, { texto: 'primeira' }, db);
    await enviarComoPaciente(ana.P, { texto: 'segunda' }, db);
    await entrarComo(T, ana);
    const h = await pagina();
    expect(h.match(new RegExp(`>${P.enviada}<`, 'g'))).toHaveLength(2);
    await conversaNoPainel(T.ctx, ana.p, {}, db); // a nutricionista abre
    const depois = await pagina();
    expect(depois.match(new RegExp(`>${P.lida}<`, 'g'))).toHaveLength(1);
    expect(itemCom(depois, 'segunda')).toContain(`>${P.lida}<`);
  });

  it('vazio: "Nenhuma mensagem ainda…" e o campo', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const h = await pagina();
    expect(h).toContain(P.vazio);
    expect(campo(h)).not.toBeNull();
  });

  it('RN-451/RN-472: horário desligado → nada; ligado sem faixas → o aviso de sem horário; com faixas, o resumo e, fora delas, o aviso de fora do horário com o envio permitido', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const texto = (h: string) => h.replace(/<[^>]+>/g, '');
    let h = await pagina();
    expect(texto(h)).not.toContain('Horário de atendimento por mensagens');
    expect(h).not.toContain(P.semHorario);
    // ligado e sem faixas
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [] }, db);
    h = await pagina();
    expect(h).toContain(P.semHorario);
    // faixas só num dia que não é hoje: fora do horário, e o campo continua
    const hoje = new Date(`${partesNoFuso(new Date(), 'America/Sao_Paulo').data}T12:00:00Z`).getUTCDay();
    const outroDia = (hoje + 3) % 7;
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [{ diaSemana: outroDia, inicioMin: 540, fimMin: 1080 }] }, db);
    h = await pagina();
    expect(texto(h)).toMatch(/Horário de atendimento por mensagens: .+9h às 18h\./);
    expect(h).toContain(P.foraDoHorario);
    expect(campo(h)).not.toBeNull();
    // todos os dias, o dia inteiro: dentro do horário, sem o aviso
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicioMin: 0, fimMin: 1440 })) }, db);
    h = await pagina();
    expect(texto(h)).toContain('Horário de atendimento por mensagens:');
    expect(h).not.toContain(P.foraDoHorario);
    // desligado com as faixas guardadas: o paciente não vê horário nem aviso
    await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: true, faixas: [{ diaSemana: outroDia, inicioMin: 540, fimMin: 1080 }] }, db);
    h = await pagina();
    expect(texto(h)).not.toContain('Horário de atendimento por mensagens');
    expect(h).not.toContain(P.foraDoHorario);
  });

  it('RN-449: o socorro logo abaixo da mensagem de risco, pelo `risco` gravado — sintoma agudo ≠ emergência; mensagem sem risco, sem socorro', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const agudo = await enviarMensagemAction(null, form({ texto: 'estou com dor no peito e falta de ar', js: '1' }));
    expect(agudo).toMatchObject({ enviada: true, erro: null, texto: '', textoFixo: 'sintoma_agudo' });
    await enviarMensagemAction(null, form({ texto: 'não aguento mais, quero sumir', js: '1' }));
    await enviarMensagemAction(null, form({ texto: 'Posso trocar o arroz?', js: '1' }));
    const h = await pagina();
    const semTags = (s: string) => s.replace(/<[^>]+>/g, '');
    const li1 = itemCom(h, 'estou com dor no peito');
    expect(semTags(li1)).toContain(SOCORRO_DO_RISCO.sintoma_agudo);
    expect(semTags(li1)).not.toContain(SOCORRO_DO_RISCO.emergencia);
    expect(li1).toMatch(/data-socorro=""/);
    expect(li1.indexOf('estou com dor no peito')).toBeLessThan(li1.indexOf('data-socorro'));
    const li2 = itemCom(h, 'quero sumir');
    expect(semTags(li2)).toContain(SOCORRO_DO_RISCO.emergencia);
    expect(li2).toMatch(/href="tel:188"/);
    expect(itemCom(h, 'Posso trocar o arroz?')).not.toContain('data-socorro');
  });

  it('só recados (sem a conversa liberada): os recados, o texto da US-443 e nenhum campo', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T, { liberar: false });
    await recadoPara(db, T, [ana.p], 'Feriado na segunda');
    await entrarComo(T, ana);
    const h = await pagina();
    expect(h).toContain('Feriado na segunda');
    expect(h).toContain(P.soRecados);
    expect(campo(h)).toBeNull();
    expect(h).not.toContain(`>${P.enviar}</button>`);
  });

  it('pausada: o texto e sem campo; o envio que encontra a conversa pausada devolve o texto novo e o rascunho', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [] }, db);
    expect(await pausarConversa(T.ctx, ana.p, db)).toBe('ok');
    const h = await pagina();
    expect(h).toContain(P.pausada);
    expect(campo(h)).toBeNull();
    expect(h).not.toContain(P.semHorario); // sem envio aberto, sem horário (nem "fica guardada e será lida…")
    expect(await enviarMensagemAction(null, form({ texto: 'escrevi antes da pausa', js: '1' }))).toMatchObject({
      erro: P.erros.pausadaNoEnvio,
      texto: 'escrevi antes da pausa',
      enviada: false,
    });
  });

  it('enviarMensagemAction: vazio e longo devolvem o erro e o texto; com JS devolve o estado; sem JS volta pela página (redirect); enviou → revalida a conversa', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    expect(await enviarMensagemAction(null, form({ texto: '   ', js: '1' }))).toMatchObject({ erro: P.erros.semConteudo, texto: '   ', enviada: false });
    const longo = 'a'.repeat(2001);
    expect(await enviarMensagemAction(null, form({ texto: longo, js: '1' }))).toMatchObject({ erro: P.erros.textoLongo, texto: longo });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
    expect(await enviarMensagemAction(null, form({ texto: 'com JS', js: '1' }))).toMatchObject({ erro: null, texto: '', enviada: true, textoFixo: null });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/p/mensagens');
    expect(await erro(enviarMensagemAction(null, form({ texto: 'sem JS' })))).toBe('redirect /p/mensagens');
    expect((await pagina()).replace(/<[^>]+>/g, '')).toContain('sem JS');
  });

  it('muitas seguidas: o texto da §6.2 com o rascunho; com sinal de risco no texto recusado, também o socorro (RN-449, revisão da T3 M8)', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    for (let i = 0; i < LIMITE_MENSAGENS_HORA; i++) await enviarComoPaciente(ana.P, { texto: `mensagem ${i}` }, db);
    expect(await enviarMensagemAction(null, form({ texto: 'mais uma', js: '1' }))).toMatchObject({ erro: P.erros.muitas, texto: 'mais uma', textoFixo: null });
    expect(await enviarMensagemAction(null, form({ texto: 'estou com dor no peito e falta de ar', js: '1' }))).toMatchObject({
      erro: P.erros.muitas,
      texto: 'estou com dor no peito e falta de ar',
      textoFixo: 'sintoma_agudo',
    });
  });

  it('erro inesperado: "Não foi possível enviar. Tente de novo." com o rascunho, nunca um 500 cru', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana, { ...ana.P, actorUserId: undefined }); // sessão sem conta: o módulo recusa antes da transação
    expect(await enviarMensagemAction(null, form({ texto: 'meu rascunho', js: '1' }))).toMatchObject({ erro: P.erros.falha, texto: 'meu rascunho', enviada: false });
  });

  it('?erro= sem JS: os códigos da §6.2 junto ao campo; código fora da lista não mostra nada; na conversa pausada, na região viva', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const codigos = { formato: P.erros.formato, tamanho: P.erros.tamanho, cota: P.erros.cota, limite: P.erros.limiteFotos, muitas: P.erros.muitas, conversa: P.erros.pausadaNoEnvio, falha: P.erros.falha };
    for (const [codigo, texto] of Object.entries(codigos)) {
      const h = await pagina({ erro: codigo });
      expect(h, codigo).toMatch(new RegExp(`<div[^>]*role="alert"[^>]*><p[^>]*id="erro-mensagem"[^>]*>${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`));
      expect(campo(h)?.[0], codigo).toMatch(/aria-describedby="aviso-urgencia erro-mensagem"/);
    }
    for (const codigo of ['outro', 'toString', '__proto__']) {
      const h = await pagina({ erro: codigo });
      expect(h, codigo).not.toContain('id="erro-mensagem"');
      expect(regiao(h), codigo).toBe('');
    }
    expect(await pausarConversa(T.ctx, ana.p, db)).toBe('ok');
    expect(regiao(await pagina({ erro: 'conversa' }))).toBe(P.erros.pausadaNoEnvio);
  });

  it('"Ver mensagens anteriores" com ?antes= (o id da primeira mostrada); a página anterior não consulta a situação', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    for (let i = 0; i < 52; i++) await enviarComoNutri(T.ctx, ana.p, { texto: `n${i}` }, db);
    await entrarComo(T, ana);
    const h = await pagina();
    const m = /<a [^>]*href="\/p\/mensagens\?antes=([0-9a-f-]{36})"[^>]*>Ver mensagens anteriores<\/a>/.exec(h);
    expect(m).not.toBeNull();
    const anterior = await pagina({ antes: m![1] });
    expect(anterior).toContain('>n0<');
    expect(anterior).not.toContain('>n51<');
    const situacao = (busca: Record<string, string>) => achar(arvore(busca), SituacaoDoPortal);
    expect((await situacao({}))).toMatchObject({ consultar: true, abrirNoFim: true });
    // re-revisão da T7: a visão das anteriores não rola até o fim (nem consulta)
    expect((await situacao({ antes: m![1] }))).toMatchObject({ consultar: false, abrirNoFim: false });
  });

  it('R-450: a tela do push (/p/mensagens?v=<consultório>) com paciente de dois consultórios abre a conversa do consultório do ?v= (o vínculo que requirePaciente escolhe)', async () => {
    const A = await consultorio();
    const B = await consultorio();
    const naA = await pacienteDoChat(db, A);
    await enviarComoNutri(A.ctx, naA.p, { texto: 'mensagem do consultório A' }, db);
    const naB = await pacienteDoChat(db, B);
    await enviarComoNutri(B.ctx, naB.p, { texto: 'mensagem do consultório B' }, db);
    await owner.pool.query("update tenants set nome_profissional = 'Outra Nutricionista B' where id = $1", [B.tenantId]);
    await entrarComo(B, naB); // ?v=<B>: requirePaciente devolve o vínculo de B
    const h = await pagina({ v: B.tenantId });
    expect(h).toContain('mensagem do consultório B');
    expect(h).not.toContain('mensagem do consultório A');
    expect(h).toContain(P.conversaCom('Outra Nutricionista B', CRN));
  });

  it('texto como texto (RNF-444): sem HTML e sem link automático', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await enviarComoNutri(T.ctx, ana.p, { texto: '<b>negrito</b> https://exemplo.com' }, db);
    await entrarComo(T, ana);
    const h = await pagina();
    expect(h).toContain('&lt;b&gt;negrito&lt;/b&gt; https://exemplo.com');
    expect(h).not.toMatch(/<a [^>]*href="https:\/\/exemplo\.com"/);
  });

  it('rascunho × mensagem nova (rodada da T6b, C1): o refresh com mensagem nova e "Lida" novo não muda a chave de nada entre a página e o campo nem a região viva', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await enviarComoPaciente(ana.P, { texto: 'primeira' }, db);
    await entrarComo(T, ana);
    const antes = caminhoAte(await arvore(), CampoDoPortal);
    const regiaoAntes = caminhoAte(await arvore(), SituacaoDoPortal);
    expect(antes).not.toBeNull();
    expect(regiaoAntes).not.toBeNull();
    await enviarComoNutri(T.ctx, ana.p, { texto: 'nova da nutricionista' }, db); // chega mensagem nova (o refresh da tela)
    await conversaNoPainel(T.ctx, ana.p, {}, db); // e a nutricionista lê (o "Lida" muda)
    expect(caminhoAte(await arvore(), CampoDoPortal)).toEqual(antes);
    expect(caminhoAte(await arvore(), SituacaoDoPortal)).toEqual(regiaoAntes);
    for (const passo of [...antes!, ...regiaoAntes!]) expect(passo, 'nenhuma chave com id de mensagem no caminho').not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(readFileSync('src/app/p/(portal)/mensagens/page.tsx', 'utf8')).not.toMatch(/<ProvedorDaLeitura\s[^>]*key=/);
  });

  it('RN-473: todo <Link> da conversa sem prefetch; nenhum dangerouslySetInnerHTML', () => {
    const dir = 'src/app/p/(portal)/mensagens';
    const fontes = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    const links = fontes.match(/<Link\b[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(/prefetch=\{false\}/);
    expect(fontes).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('rodada da T7 (revisão de interface e CFN)', () => {
  const rodape = (h: string) => /<div id="rodape-da-conversa"[^>]*>([\s\S]*)<\/div><\/main>/.exec(h)?.[1] ?? '';

  it('I1: pausada e só recados — o texto fica no rodapé, no lugar do campo; o aviso de urgência no topo, com o id que descreve o campo', async () => {
    const T = await consultorio();
    const so = await pacienteDoChat(db, T, { liberar: false });
    await recadoPara(db, T, [so.p], 'Feriado');
    await entrarComo(T, so);
    let h = await pagina();
    expect(rodape(h)).toContain(P.soRecados);
    expect(h.indexOf(P.soRecados)).toBeGreaterThan(h.indexOf('id="rodape-da-conversa"'));
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    h = await pagina();
    expect(h).toMatch(/<p id="aviso-urgencia"[^>]*>/);
    expect(h.indexOf('id="aviso-urgencia"')).toBeLessThan(h.indexOf('aria-label="Mensagens"'));
    expect(campo(h)?.[0]).toMatch(/aria-describedby="aviso-urgencia"/);
    expect(await pausarConversa(T.ctx, ana.p, db)).toBe('ok');
    h = await pagina();
    expect(rodape(h)).toContain(P.pausada);
    expect(h.split(P.pausada)).toHaveLength(2); // uma vez só
  });

  it('minors: sem o selo "Offline — exibindo última versão" nesta tela (só a região da conversa é status); o e-mail longo quebra', async () => {
    const T = await consultorio({ contatos: true });
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const h = await pagina();
    expect(h.match(/role="status"/g)).toHaveLength(1);
    expect(h).toMatch(/<a [^>]*href="mailto:[^"]*"[^>]*class="[^"]*\bwrap-anywhere\b|<a [^>]*class="[^"]*\bwrap-anywhere\b[^"]*"[^>]*href="mailto:/);
  });

  it('CFN M2 (CH-D77): o socorro do texto recusado em QUALQUER recusa — conversa pausada no meio, texto longo, erro inesperado', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await entrarComo(T, ana);
    const longo = `não aguento mais, quero sumir ${'a'.repeat(2000)}`;
    expect(await enviarMensagemAction(null, form({ texto: longo, js: '1' }))).toMatchObject({ erro: P.erros.textoLongo, textoFixo: 'risco_emergencia', enviada: false });
    expect(await pausarConversa(T.ctx, ana.p, db)).toBe('ok');
    expect(await enviarMensagemAction(null, form({ texto: 'vomito de proposito', js: '1' }))).toMatchObject({ erro: P.erros.pausadaNoEnvio, textoFixo: 'risco_transtorno' });
    expect(await enviarMensagemAction(null, form({ texto: 'Posso trocar o arroz?', js: '1' }))).toMatchObject({ erro: P.erros.pausadaNoEnvio, textoFixo: null });
    await entrarComo(T, ana, { ...ana.P, actorUserId: undefined });
    expect(await enviarMensagemAction(null, form({ texto: 'estou com dor no peito', js: '1' }))).toMatchObject({ erro: P.erros.falha, textoFixo: 'sintoma_agudo' });
  });
});

type No = { type?: unknown; key?: string | null; props?: Record<string, unknown> & { children?: unknown } };
const nomeDo = (t: unknown) => (typeof t === 'string' ? t : typeof t === 'function' ? t.name : typeof t === 'symbol' ? String(t) : 'objeto');
/** O caminho (tipo e chave de cada elemento) da raiz até o primeiro elemento do tipo `alvo`; null se não achar. */
function caminhoAte(raiz: unknown, alvo: unknown): string[] | null {
  const andar = (n: unknown, caminho: string[]): string[] | null => {
    if (Array.isArray(n)) {
      for (const x of n) {
        const r = andar(x, caminho);
        if (r) return r;
      }
      return null;
    }
    if (!n || typeof n !== 'object') return null;
    const no = n as No;
    const aqui = [...caminho, `${nomeDo(no.type)}#${no.key ?? ''}`];
    if (no.type === alvo) return aqui;
    return andar(no.props?.children, aqui);
  };
  return andar(raiz, []);
}
/** As props do primeiro elemento do tipo `alvo` na árvore devolvida pela página. */
async function achar(raiz: Promise<unknown>, alvo: unknown): Promise<Record<string, unknown> | null> {
  const andar = (n: unknown): Record<string, unknown> | null => {
    if (Array.isArray(n)) {
      for (const x of n) {
        const r = andar(x);
        if (r) return r;
      }
      return null;
    }
    if (!n || typeof n !== 'object') return null;
    const no = n as No;
    if (no.type === alvo) return no.props ?? {};
    return andar(no.props?.children);
  };
  return andar(await raiz);
}
