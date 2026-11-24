import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio } from '../../../test/documentos';
import { espiarErrosDoBanco } from '../../../test/erros-do-banco';
import { novoPaciente } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { signedDocumentNotes, signedDocuments, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { cancelarDocumento } from './cancelamento';
import { criarParecer, criarReceita, lerDocumento, salvarRascunhoParecer, salvarRascunhoReceita } from './documentos';
import type { ConteudoParecer } from './parecer';
import { declararFitoterapia, salvarDadosParaDocumentos } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';
import { retificarDocumento } from './retificacao';

/**
 * SUS-109 (regra 3): o NUL e o surrogate UTF-16 sem par digitados num documento não chegam ao banco — o Postgres recusaria
 * (22P05/22P02 no jsonb, 22021 no text) com um trecho do texto, que pode ser dado de saúde, no log e no erro do app. O
 * espião anota o SQLSTATE de todo erro do banco: cada caso confere que ele fica vazio, que o texto gravado vem sem esses
 * caracteres e que o emoji (par válido) continua.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;
/** "Ferritina<c> baixa 🙂" → "Ferritina baixa 🙂". */
const sujo = (t: string, c: string) => `${t}${c} baixa 🙂`;
const limpo = (t: string) => `${t} baixa 🙂`;

/** Roda a gravação; o erro do banco (se houver) aparece como o SQLSTATE anotado, antes de qualquer outra conferência. */
async function semErroDoBanco<T>(f: () => Promise<T>): Promise<T> {
  errosDoBanco.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(errosDoBanco).toEqual([]);
  if (!r.ok) throw r.e;
  return r.v;
}

async function consultorio() {
  const c = await novoConsultorio(app.db);
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
  return { ...c, tenant: t as TenantRow };
}
const nota = (ctx: Parameters<typeof withTenant>[0], docId: string) =>
  withTenant(ctx, async (tx) => (await tx.select().from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, docId)))[0], app.db);

describe('SUS-109: texto com NUL ou surrogate sem par nos documentos', () => {
  it('premissa e controle do espião: gravados direto, o banco recusa com 22P05/22P02 (jsonb) e 22021 (text)', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const docId = await criarReceita(c.T.ctx, p.id, { db: app.db });
    const esperado = { NUL: ['22P05', '22021'], 'surrogate alto sem par': ['22P02'], 'surrogate baixo sem par': ['22P02'] } as const;
    for (const [nome, ch] of INVALIDOS) {
      errosDoBanco.length = 0;
      const conteudo = { versao: 1, tipo: 'receita', itens: [], orientacoes: sujo('Com água', ch) };
      await expect(withTenant(c.T.ctx, (tx) => tx.update(signedDocuments).set({ conteudo }).where(eq(signedDocuments.id, docId)), app.db)).rejects.toThrow();
      // no text, o driver troca o surrogate por U+FFFD em silêncio: só o NUL é recusado
      const texto = withTenant(c.T.ctx, (tx) => tx.update(signedDocumentNotes).set({ justificativaUso: sujo('Uso', ch) }).where(eq(signedDocumentNotes.documentoId, docId)), app.db);
      if (ch === '\u0000') await expect(texto).rejects.toThrow();
      else await texto;
      expect([...new Set(errosDoBanco)], nome).toEqual(esperado[nome]);
    }
  });

  it.each(INVALIDOS)('parecer: avaliação, conduta e encaminhamentos com %s', async (_nome, ch) => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const docId = await criarParecer(c.T.ctx, p.id, { db: app.db });
    const conteudo = { exameIds: [], avaliacao: sujo('Ferritina\r\n', ch), conduta: sujo('Ferro', ch), encaminhamentos: sujo('Hematologia', ch) };
    await semErroDoBanco(() => salvarRascunhoParecer(c.T.ctx, p.id, docId, { conteudo }, { db: app.db }));
    const d = (await lerDocumento(c.T.ctx, p.id, docId, app.db))!;
    expect(d.conteudo as ConteudoParecer).toMatchObject({ avaliacao: limpo('Ferritina\n'), conduta: limpo('Ferro'), encaminhamentos: limpo('Hematologia') });
  });

  it.each(INVALIDOS)('receita: itens, orientações e justificativa com %s', async (_nome, ch) => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const docId = await criarReceita(c.T.ctx, p.id, { db: app.db });
    const item = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: sujo('Vitamina D3', ch), quantidade: 2000, unidade: 'UI' }], forma: sujo('Cápsula', ch), via: 'oral', posologia: sujo('1 ao dia', ch), duracao: sujo('30 dias', ch), manipulado: false };
    await semErroDoBanco(() =>
      salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, docId, { conteudo: { itens: [item], orientacoes: sujo('Com água', ch) }, justificativa: sujo('Deficiência', ch) }, { db: app.db }),
    );
    const d = (await lerDocumento(c.T.ctx, p.id, docId, app.db))!;
    const r = d.conteudo as ConteudoReceita;
    expect(r.orientacoes).toBe(limpo('Com água'));
    expect(r.itens[0]).toMatchObject({ composicao: [{ nome: limpo('Vitamina D3') }], forma: limpo('Cápsula'), posologia: limpo('1 ao dia'), duracao: limpo('30 dias') });
    expect(d.justificativa).toBe(limpo('Deficiência'));
  });

  it.each(INVALIDOS)('retificação: o motivo da receita e o do parecer com %s', async (_nome, ch) => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    for (const tipo of ['receita', 'parecer'] as const) {
      const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', tipo });
      await withTenant(c.T.ctx, (tx) => tx.insert(signedDocumentNotes).values({ tenantId: c.T.tenantId, patientId: p.id, documentoId: v1.id }), app.db);
      const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
      const motivoRetificacao = sujo('Dose\r\n', ch);
      await semErroDoBanco(() =>
        tipo === 'receita'
          ? salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, v2, { conteudo: { itens: [], orientacoes: '' }, justificativa: '', motivoRetificacao }, { db: app.db })
          : salvarRascunhoParecer(c.T.ctx, p.id, v2, { conteudo: { exameIds: [], avaliacao: 'A.' }, motivoRetificacao }, { db: app.db }),
      );
      expect((await lerDocumento(c.T.ctx, p.id, v2, app.db))!.motivoRetificacao, tipo).toBe(limpo('Dose\n'));
    }
  });

  it.each(INVALIDOS)('cancelamento: o motivo com %s', async (_nome, ch) => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const d = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    await semErroDoBanco(() => cancelarDocumento(c.T.ctx, p.id, d.id, sujo('Dose digitada errada', ch), { db: app.db, appUrl: 'https://x' }));
    expect((await nota(c.T.ctx, d.id)).motivoCancelamento).toBe(limpo('Dose digitada errada'));
  });

  it.each(INVALIDOS)('perfil profissional: o nome e o registro da fitoterapia com %s', async (_nome, ch) => {
    const c = await consultorio();
    await semErroDoBanco(() =>
      salvarDadosParaDocumentos(c.T.ctx, { nomeProfissional: sujo('Débora Silva', ch), contatoEmail: 'd@x.com', contatoTelefone: '(11) 91234-5678' }, app.db),
    );
    await semErroDoBanco(() => declararFitoterapia(c.T.ctx, { registro: sujo('CRN-3 12345', ch), confirmo: 'on' }, { db: app.db }));
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
    expect(t).toMatchObject({ nomeProfissional: limpo('Débora Silva'), fitoterapiaRegistro: limpo('CRN-3 12345') });
  });

  it('o espião vê o erro de um comando cru (sanidade do controle)', async () => {
    errosDoBanco.length = 0;
    await expect(app.pool.query(`select 'a'::int`)).rejects.toThrow();
    expect(errosDoBanco).toContain('22P02');
    await expect(app.db.execute(sql`select ${'\u0000'}::text`)).rejects.toThrow();
    expect(errosDoBanco).toContain('22021');
  });
});
