import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { consultorioDoChat, mensagemDoDono, naSessao, pacienteDoChat, recadoPara } from '../../../../test/mensagens';
import { novoPaciente, type TenantDeTeste } from '../../../../test/pacientes';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { secoesDoInicio } from '../inicio';
import { montarAdicionar } from '../adicionar';
import { SECOES_DA_FICHA } from './index';
import { secaoMensagens } from './mensagens';

// Plano 25, T6c (US-451, RN-468, §4.4; CH-D26, CH-D44): a seção "Mensagens" do Início da ficha — "{n} não lidas", até 3
// itens com rótulo genérico, nunca o texto, sem auditRead; "Enviar mensagem" no Adicionar só para o titular ativo.
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});
const FUSO = 'America/Sao_Paulo';
const TENANT = { fuso: FUSO, documentosLiberados: false, examesPacienteAtivadoEm: null };
const F = MSG_MENSAGENS.ficha;

async function consultorio(): Promise<TenantDeTeste> {
  const T = await consultorioDoChat(app.db, owner.pool);
  await owner.pool.query("update tenants set crn = 'CRN-4 12345' where id = $1", [T.tenantId]);
  return T;
}
const paciente = async (id: string) =>
  (await owner.pool.query<{ id: string; status: string; anonimizado_em: Date | null }>('select id, status, anonimizado_em from patients where id = $1', [id])).rows.map((r) => ({
    id: r.id,
    status: r.status,
    anonimizadoEm: r.anonimizado_em,
  }))[0];
const leituras = async (T: TenantDeTeste) => (await naSessao(app.db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`))[0].n as number;
const daMensagens = async (T: TenantDeTeste, id: string) => (await secoesDoInicio(T.ctx, TENANT, await paciente(id), { db: app.db })).find((s) => s.id === 'mensagens')!;

describe('Plano 25 — seção "Mensagens" do Início (US-451)', () => {
  it('no fim do registro, com o título, sempre disponível, "Ver todos" para a conversa e "Enviar mensagem" em Outros', () => {
    expect(SECOES_DA_FICHA.at(-1)).toBe(secaoMensagens);
    expect(secaoMensagens.id).toBe('mensagens');
    expect(secaoMensagens.titulo).toBe(F.secao);
    expect(secaoMensagens.aba).toBe('');
    expect(secaoMensagens.verTodos!('0b6c3c9e-8a3f-4a1d-9a54-6f7c2a1e9d11')).toBe('/painel/mensagens/0b6c3c9e-8a3f-4a1d-9a54-6f7c2a1e9d11');
    expect(secaoMensagens.leitura).toBeUndefined();
    expect(secaoMensagens.noApp).toBeUndefined();
    expect(secaoMensagens.adicionar).toEqual([{ grupo: 'outros', rotulo: F.enviarMensagem, destino: { href: '/painel/mensagens/{id}' } }]);
    for (const status of ['ativo', 'arquivado', 'bloqueado']) expect(secaoMensagens.disponivel(TENANT, { id: 'x', status, anonimizadoEm: null }, 0)).toBe(true);
    expect(secaoMensagens.rotuloDoTotal!(2)).toBe('2 não lidas');
    expect(secaoMensagens.rotuloDoTotal!(1)).toBe('1 não lida');
  });

  it('"{n} não lidas" (só as do paciente depois do marcador do consultório), os 3 últimos com o rótulo genérico, a data e "Sinal de risco"; nunca o texto; sem auditRead', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(app.db, T);
    await mensagemDoDono(owner.pool, T, ana, { texto: 'SEGREDO-1', criadaEm: '2026-11-10T13:00:00Z' });
    await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'SEGREDO-2', criadaEm: '2026-11-11T13:00:00Z' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'SEGREDO-3', risco: 'emergencia', criadaEm: '2026-11-12T13:00:00Z' });
    await recadoPara(app.db, T, [ana.p], 'SEGREDO-4');
    const antes = await leituras(T);
    const s = await daMensagens(T, ana.p);
    expect(await leituras(T)).toBe(antes);
    expect(s.resumo.total).toBe(2);
    expect(s.rotuloDoTotal).toBe('2 não lidas');
    expect(s.verTodos).toBe(`/painel/mensagens/${ana.p}`);
    expect(s.podeAdicionar).toBe(true);
    expect(s.resumo.ultimos.map((i) => [i.rotulo, i.data, i.situacao ?? null])).toEqual([
      [F.recado, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), null],
      [F.mensagemDoPaciente, '2026-11-12', F.sinalDeRisco],
      [F.mensagemEnviada, '2026-11-11', null],
    ]);
    for (const i of s.resumo.ultimos) {
      expect(Object.keys(i).sort()).toEqual(i.situacao ? ['data', 'href', 'id', 'noApp', 'rotulo', 'situacao'] : ['data', 'href', 'id', 'noApp', 'rotulo']);
      expect(i.href).toBe(`/painel/mensagens/${ana.p}`);
    }
    expect(JSON.stringify(s)).not.toContain('SEGREDO');
    // o resumo da seção, direto: só as chaves do contrato
    const r = await (await import('@/db/tenant')).withTenant(T.ctx, (tx) => secaoMensagens.resumo(tx, ana.p, FUSO), app.db);
    expect(Object.keys(r).sort()).toEqual(['podeAdicionar', 'total', 'ultimos']);
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
  });

  it('sem mensagens: total 0, sem itens; "Enviar mensagem" no Adicionar com o {id} trocado pelo paciente', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const s = await daMensagens(T, p.id);
    expect(s.resumo).toEqual({ total: 0, ultimos: [] });
    expect(s.rotuloDoTotal).toBe('0 não lidas');
    const grupos = montarAdicionar(p.id, [s]);
    expect(grupos).toEqual([{ grupo: 'outros', titulo: expect.any(String), itens: [{ rotulo: F.enviarMensagem, href: `/painel/mensagens/${p.id}` }] }]);
  });

  it('titular arquivado, bloqueado ou anonimizado: a seção aparece, sem "Enviar mensagem" (podeAdicionar: false)', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Caio Reis' });
    await owner.pool.query("update patients set status = 'arquivado' where id = $1", [p.id]);
    expect((await daMensagens(T, p.id)).podeAdicionar).toBe(false);
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date + 30 where id = $1", [p.id]);
    expect((await daMensagens(T, p.id)).podeAdicionar).toBe(false);
    const q = await novoPaciente(app.db, T.ctx, { nome: 'Davi Melo' });
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date - 2, anonimizado_em = now() where id = $1", [q.id]);
    expect((await daMensagens(T, q.id)).podeAdicionar).toBe(false);
  });

  it('o arquivo da seção não lê a coluna do texto nem o nome do anexo', () => {
    const src = readFileSync('src/modules/ficha/secoes/mensagens.ts', 'utf8');
    expect(src).not.toMatch(/\btexto\b|anexo_nome|anexoNome|auditRead/);
  });
});
