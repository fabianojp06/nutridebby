// Ajudantes novoConsultorio/outroDocumento/novoPreparoNoBanco de test/documentos.ts (T8).
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento, pngDeclarando } from '../../../test/documentos';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { receberDigitalizada } from './digitalizada';
import { expirarPdfsDeDocumentoPendentes } from './documento-pdf-job';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';

/** R1 da revisão da T9: o `apagarArquivo` de uma foto antiga pode cair (lock, conexão); o teste o faz cair sob demanda. */
const falhaAoApagar = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/modules/plataforma/armazenamento', async (original) => {
  const m = await original<typeof import('@/modules/plataforma/armazenamento')>();
  return { ...m, apagarArquivo: (...a: Parameters<typeof m.apagarArquivo>) => (falhaAoApagar.ligada ? Promise.reject(new Error('conexão caiu')) : m.apagarArquivo(...a)) };
});

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});
const png = () => sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).png().toBuffer();
const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n');
const recusa = (c: string) => (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === c;
const deps = (dataDir: string, codigo: 'ok' | 'invalido' = 'ok') => ({ db: app.db, dataDir, headers: new Headers(), confirmar2fa: async () => codigo });
describe('digitalizada (RN-157, D4)', () => {
  it('PDF como "digitalizado" é recusado (só fotos); 6 fotos também, com o texto da US-144; o código do 2FA é pedido em todo envio', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(receberDigitalizada(x.acesso, x.id, [pdf], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('imagens'));
    const f = await png();
    const seis = await receberDigitalizada(x.acesso, x.id, Array(6).fill(f), '123456', deps(x.dataDir)).catch((e: unknown) => e);
    expect(seis).toSatisfy(recusa('fotos'));
    expect((seis as RecusaAssinaturaError).mensagem()).toBe('Envie de 1 a 5 fotos, até 10 MB no total.');
    await expect(receberDigitalizada(x.acesso, x.id, [f], '000000', deps(x.dataDir, 'invalido'))).rejects.toSatisfy(recusa('codigo_2fa'));
  });

  it('PNG que declara 30.000 × 30.000 → recusa "fotos" (US-144: acima de 40 MP) pelo cabeçalho, sem decodificar (o processo segue de pé)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(receberDigitalizada(x.acesso, x.id, [pngDeclarando(30_000, 30_000)], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('fotos'));
  });

  it('D24: no reenvio, se uma foto do envio anterior não sai, o envio vira "falhou" e as fotos não se somam', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await receberDigitalizada(x.acesso, x.id, [await png(), await png()], '123456', deps(x.dataDir));
    const ler = async () => (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows[0] as { digitalizacao: string[]; digitalizacao_status: string };
    const antigas = (await ler()).digitalizacao;
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update signed_documents set digitalizacao_status = 'falhou' where id = ${x.id}`), app.db); // o job falhou
    falhaAoApagar.ligada = true;
    try {
      await expect(receberDigitalizada(x.acesso, x.id, [await png()], '123456', deps(x.dataDir))).rejects.toThrow('conexão caiu');
    } finally {
      falhaAoApagar.ligada = false;
    }
    expect(await ler()).toEqual({ digitalizacao: antigas, digitalizacao_status: 'falhou' }); // nenhuma foto nova somada às antigas
    await receberDigitalizada(x.acesso, x.id, [await png()], '123456', deps(x.dataDir)); // "Envie as fotos de novo"
    const d = await ler();
    expect(d.digitalizacao_status).toBe('pendente');
    expect(d.digitalizacao).toHaveLength(1);
    expect(antigas).not.toContain(d.digitalizacao[0]);
  });

  it('versão lida: "Voltar a editar" e um novo preparo durante o envio → 409 e nenhuma foto presa à versão nova', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const noMeio = async () => (await novoPreparoNoBanco(x, app.db), 'ok' as const);
    await expect(receberDigitalizada(x.acesso, x.id, [await png()], '123456', { ...deps(x.dataDir), confirmar2fa: noMeio })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ digitalizacao: null, digitalizacao_status: null });
  });

  it('fotos aceitas: guardadas como documento_digitalizado (o paciente não vê), status "pendente" e o job na fila', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await receberDigitalizada(x.acesso, x.id, [await png(), await png()], '123456', deps(x.dataDir));
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows as { status: string; digitalizacao: string[]; digitalizacao_status: string }[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', digitalizacao_status: 'pendente' });
    expect(d.digitalizacao).toHaveLength(2);
    const jobs = await (await getBoss()).findJobs<{ documentoId: string }>('documento-digitalizado');
    expect(jobs.some((j) => j.data.documentoId === x.id)).toBe(true);
  });

  it('D24: dois envios ao mesmo tempo → um passa e o outro recebe 409; as fotos não se somam', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const [f1, f2] = [await png(), await png()];
    const r = await Promise.allSettled([
      receberDigitalizada(x.acesso, x.id, [f1, f1, f1], '123456', deps(x.dataDir)),
      receberDigitalizada(x.acesso, x.id, [f2, f2, f2], '123456', deps(x.dataDir)),
    ]);
    expect(r.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows as { digitalizacao: string[]; digitalizacao_status: string }[];
    expect(d.digitalizacao).toHaveLength(3);
    expect(d.digitalizacao_status).toBe('pendente');
  });

  it('D24: "recebendo" ou "pendente" esquecido há mais de 1 h vira "falhou" na varredura e libera um envio novo', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update signed_documents set digitalizacao_status = 'recebendo', digitalizacao_em = now() - interval '2 hours' where id = ${x.id}`), app.db);
    // só o tenant do teste: o banco é compartilhado (a varredura de todos expiraria envios "recebendo" de outros testes)
    expect(await expirarPdfsDeDocumentoPendentes(app.db, new Date(), { tenantId: x.T.tenantId })).toBe(1);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d.digitalizacao_status).toBe('falhou');
    await receberDigitalizada(x.acesso, x.id, [await png()], '123456', deps(x.dataDir)); // "Envie as fotos de novo"
  });

  it('Minor 9: fitoterápico formulado com a habilitação retirada depois do preparo → "sem_habilitacao", nada gravado', async () => {
    const c = await novoConsultorio(app.db);
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 à noite', nomePopular: '', duracao: '', padronizacao: '' };
    const x = await outroDocumento(c, app.db, { conteudo: { versao: 1, tipo: 'receita', itens: [fito], orientacoes: '', copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: true }, paciente: { nome: 'Ana Souza' } } } });
    await expect(receberDigitalizada({ ...x.acesso, tenant: { ...x.acesso.tenant, fitoterapiaRegistro: null } }, x.id, [await png()], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('sem_habilitacao'));
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ digitalizacao: null, digitalizacao_status: null });
  });
});
