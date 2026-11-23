import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { PDF_MINIMO } from '../../test/ia';
import { COTA_BYTES, salvarArquivo, salvarArquivos } from '@/modules/plataforma/armazenamento';
import { definirRecebimentoDeExames } from '@/modules/plataforma/recebimento-exames';
import { withConta, withTenant, type TenantContext } from './tenant';

// SUS-102 (0126): o gatilho `tenants_por_sessao` — paciente, público e conta não mudam `tenants` (salvo a reserva de cota do
// paciente no próprio consultório, até a cota) nem tocam outra linha; a nutricionista só muda o próprio, sem as colunas da
// admin; só o worker e o contexto vazio criam e apagam consultório
const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-sus102-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const SEM_SESSAO = 'as sessões de paciente, pública e de conta não mudam o consultório';
const SO_O_PROPRIO = 'a sessão da nutricionista só muda o próprio consultório';
const DA_ADMIN = 'só a admin muda a situação, a cota de WhatsApp, as métricas de base e o aceite do DPA';
const SEM_CRIAR = 'as sessões do consultório não criam nem apagam consultório';
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

/** As colunas que o SUS-102 cita: situação, endereço público, configuração da agenda e o aceite do DPA. */
const mudancas = (id: string): [string, SQL][] => [
  ['status', sql`update tenants set status = 'suspensa' where id = ${id}`],
  ['slug', sql`update tenants set slug = ${`sus-${randomUUID().slice(0, 8)}`} where id = ${id}`],
  ['antecedencia_min_h', sql`update tenants set antecedencia_min_h = 5 where id = ${id}`],
  ['dpa_*', sql`update tenants set dpa_aceito_em = now(), dpa_versao = 'sus-102' where id = ${id}`],
];

const linha = async (id: string) =>
  (await app.db.execute(sql`select status, slug, antecedencia_min_h, dpa_versao, armazenamento_bytes from tenants where id = ${id}`)).rows[0] as {
    status: string;
    slug: string;
    antecedencia_min_h: number;
    dpa_versao: string | null;
    armazenamento_bytes: string;
  };

async function cenario() {
  const A = await novoTenant(app.db);
  const B = await novoTenant(app.db);
  const p = await novoPaciente(app.db, A.ctx);
  return { A, B, p };
}

type Sessao = { nome: string; rodar: (s: SQL) => Promise<unknown> };
const sessoes = (tenantId: string, patientId: string): Sessao[] => [
  { nome: 'paciente', rodar: (s) => withTenant(ctxPaciente(tenantId, patientId), (tx) => tx.execute(s), app.db) },
  { nome: 'paciente sem conta', rodar: (s) => withTenant({ tenantId, role: 'paciente', patientId, semConta: true }, (tx) => tx.execute(s), app.db) },
  { nome: 'publico', rodar: (s) => withTenant({ tenantId, role: 'publico' }, (tx) => tx.execute(s), app.db) },
  { nome: 'conta', rodar: (s) => withConta(randomUUID(), (tx) => tx.execute(s), app.db) },
];

describe('0126: tenants_por_sessao (SUS-102)', () => {
  it('paciente, público e conta não mudam status, slug, agenda nem DPA — nem do próprio consultório, nem de outro', async () => {
    const { A, B, p } = await cenario();
    const antes = { A: await linha(A.tenantId), B: await linha(B.tenantId) };
    for (const s of sessoes(A.tenantId, p.id))
      for (const alvo of [A.tenantId, B.tenantId])
        for (const [coluna, upd] of mudancas(alvo))
          await expect(s.rodar(upd), `${s.nome} × ${coluna} × ${alvo === A.tenantId ? 'próprio' : 'outro'}`).rejects.toSatisfy(negadoPor(SEM_SESSAO));
    expect(await linha(A.tenantId)).toEqual(antes.A);
    expect(await linha(B.tenantId)).toEqual(antes.B);
    // controle positivo: o UPDATE que não muda nada passa no próprio consultório (o gatilho recusa a mudança, não o comando)…
    const semMudar = (id: string) => sql`update tenants set status = status, slug = slug where id = ${id}`;
    for (const s of sessoes(A.tenantId, p.id).filter((x) => x.nome !== 'conta')) await s.rodar(semMudar(A.tenantId));
    // …mas nunca em outro (também trava a linha); a conta não tem consultório: nenhuma linha
    for (const s of sessoes(A.tenantId, p.id))
      await expect(s.rodar(semMudar(B.tenantId)), `${s.nome} × sem mudança × outro`).rejects.toSatisfy(negadoPor(SEM_SESSAO));
    await expect(withConta(randomUUID(), (tx) => tx.execute(semMudar(A.tenantId)), app.db)).rejects.toSatisfy(negadoPor(SEM_SESSAO));
  });

  it('o paciente reserva a cota de armazenamento pelo caminho legítimo (salvarArquivo); fora dele, nem o contador', async () => {
    const { A, B, p } = await cenario();
    const ctxP = ctxPaciente(A.tenantId, p.id);
    const antes = Number((await linha(A.tenantId)).armazenamento_bytes);
    await salvarArquivo(ctxP, { tipo: 'diario_foto_original', conteudo: PNG(), permitidos: ['png'], patientId: p.id }, { db: app.db, dataDir });
    expect(Number((await linha(A.tenantId)).armazenamento_bytes)).toBe(antes + PNG().length); // controle positivo
    const rodar = (s: SQL) => withTenant(ctxP, (tx) => tx.execute(s), app.db);
    // baixar o próprio contador (fugir da cota), mexer no de outro consultório ou levar outra coluna junto: recusado
    await expect(rodar(sql`update tenants set armazenamento_bytes = 0 where id = ${A.tenantId}`)).rejects.toSatisfy(negadoPor(SEM_SESSAO));
    await expect(rodar(sql`update tenants set armazenamento_bytes = armazenamento_bytes + 1 where id = ${B.tenantId}`)).rejects.toSatisfy(negadoPor(SEM_SESSAO));
    await expect(rodar(sql`update tenants set armazenamento_bytes = armazenamento_bytes + 1, status = 'suspensa' where id = ${A.tenantId}`)).rejects.toSatisfy(
      negadoPor(SEM_SESSAO),
    );
    // público e conta não têm caminho que reserve cota
    for (const s of sessoes(A.tenantId, p.id).filter((x) => x.nome === 'publico' || x.nome === 'conta'))
      await expect(s.rodar(sql`update tenants set armazenamento_bytes = armazenamento_bytes + 1 where id = ${A.tenantId}`), s.nome).rejects.toSatisfy(negadoPor(SEM_SESSAO));
    expect(Number((await linha(A.tenantId)).armazenamento_bytes)).toBe(antes + PNG().length);
  });

  it('o paciente reserva a cota pelo segundo caminho legítimo (salvarArquivos, original do exame enviado)', async () => {
    const { A, p } = await cenario();
    const antes = Number((await linha(A.tenantId)).armazenamento_bytes);
    await salvarArquivos(ctxPaciente(A.tenantId, p.id), { tipo: 'exame_original', conteudos: [PDF_MINIMO, PDF_MINIMO], permitidos: ['pdf'], patientId: p.id }, { db: app.db, dataDir });
    expect(Number((await linha(A.tenantId)).armazenamento_bytes)).toBe(antes + 2 * PDF_MINIMO.length);
  });

  it('o teto da reserva do paciente no banco é o COTA_BYTES de salvarArquivo', async () => {
    const { A, p } = await cenario();
    await app.db.execute(sql`update tenants set armazenamento_bytes = ${COTA_BYTES - 10} where id = ${A.tenantId}`);
    const rodar = (s: SQL) => withTenant(ctxPaciente(A.tenantId, p.id), (tx) => tx.execute(s), app.db);
    await expect(rodar(sql`update tenants set armazenamento_bytes = ${COTA_BYTES + 1} where id = ${A.tenantId}`)).rejects.toSatisfy(negadoPor(SEM_SESSAO));
    await rodar(sql`update tenants set armazenamento_bytes = ${COTA_BYTES} where id = ${A.tenantId}`); // até a cota, inclusive
    expect(Number((await linha(A.tenantId)).armazenamento_bytes)).toBe(COTA_BYTES);
  });

  it('a nutricionista muda o próprio consultório (configuração comum e pelo módulo), nunca outro', async () => {
    const { A, B } = await cenario();
    const rodar = (s: SQL, ctx: TenantContext = A.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
    await rodar(sql`update tenants set antecedencia_min_h = 6, cancelamento_min_h = 8 where id = ${A.tenantId}`); // controle positivo
    expect((await linha(A.tenantId)).antecedencia_min_h).toBe(6);
    await definirRecebimentoDeExames(A.ctx, true, { db: app.db }); // caminho do módulo (Configurações)
    const [rec] = (await app.db.execute(sql`select exames_paciente_ativado_em from tenants where id = ${A.tenantId}`)).rows as { exames_paciente_ativado_em: unknown }[];
    expect(rec.exames_paciente_ativado_em).not.toBeNull();
    // trocar o próprio id: recusado
    await expect(rodar(sql`update tenants set id = gen_random_uuid() where id = ${A.tenantId}`)).rejects.toSatisfy(negadoPor(SO_O_PROPRIO));
    const antesB = await linha(B.tenantId);
    for (const [coluna, upd] of mudancas(B.tenantId)) await expect(rodar(upd), coluna).rejects.toSatisfy(negadoPor(SO_O_PROPRIO));
    // até o UPDATE sem mudança em outro consultório é recusado (a sessão nunca toca outra linha)
    await expect(rodar(sql`update tenants set status = status where id = ${B.tenantId}`)).rejects.toSatisfy(negadoPor(SO_O_PROPRIO));
    expect(await linha(B.tenantId)).toEqual(antesB);
    // os gatilhos de antes seguem com a mesma regra e a mesma mensagem (rodam antes, em ordem alfabética)
    await expect(rodar(sql`update tenants set ia_liberada = true where id = ${A.tenantId}`)).rejects.toSatisfy(negadoPor('só a admin muda'));
  });

  it('a nutricionista nunca muda as colunas da admin do próprio consultório (situação, cota de WhatsApp, métricas, DPA)', async () => {
    const { A } = await cenario();
    const id = A.tenantId;
    const antes = (await app.db.execute(sql`select status, wa_cota_mensal, taxa_faltas_base, go_live_em, dpa_aceito_em, dpa_versao from tenants where id = ${id}`)).rows[0];
    const rodar = (s: SQL) => withTenant(A.ctx, (tx) => tx.execute(s), app.db);
    const daAdmin: [string, SQL][] = [
      ['status', sql`update tenants set status = 'suspensa' where id = ${id}`],
      ['wa_cota_mensal', sql`update tenants set wa_cota_mensal = wa_cota_mensal + 100 where id = ${id}`],
      ['taxa_faltas_base', sql`update tenants set taxa_faltas_base = 12.5 where id = ${id}`],
      ['go_live_em', sql`update tenants set go_live_em = '2026-10-01' where id = ${id}`],
      ['dpa_aceito_em', sql`update tenants set dpa_aceito_em = now() where id = ${id}`],
      ['dpa_versao', sql`update tenants set dpa_versao = 'sus-102' where id = ${id}`],
    ];
    for (const [coluna, upd] of daAdmin) await expect(rodar(upd), coluna).rejects.toSatisfy(negadoPor(DA_ADMIN));
    expect((await app.db.execute(sql`select status, wa_cota_mensal, taxa_faltas_base, go_live_em, dpa_aceito_em, dpa_versao from tenants where id = ${id}`)).rows[0]).toEqual(antes);
    // controle positivo: configuração da nutricionista e o contador (apagarArquivo devolve o espaço na sessão dela)
    await rodar(sql`update tenants set agendamento_publico_ativo = true, armazenamento_bytes = armazenamento_bytes + 10 where id = ${id}`);
    await rodar(sql`update tenants set armazenamento_bytes = greatest(armazenamento_bytes - 10, 0) where id = ${id}`);
    expect((await app.db.execute(sql`select agendamento_publico_ativo from tenants where id = ${id}`)).rows[0]).toEqual({ agendamento_publico_ativo: true });
  });

  it('só o worker e o contexto vazio (admin, seed) criam e apagam consultório', async () => {
    const { A, B, p } = await cenario();
    const novo = () => sql`insert into tenants (slug, nome_exibicao) values (${`sus-${randomUUID().slice(0, 8)}`}, 'SUS-102')`;
    const todas: Sessao[] = [{ nome: 'nutri', rodar: (s) => withTenant(A.ctx, (tx) => tx.execute(s), app.db) }, ...sessoes(A.tenantId, p.id)];
    for (const s of todas) {
      await expect(s.rodar(novo()), `${s.nome} × insert`).rejects.toSatisfy(negadoPor(SEM_CRIAR));
      for (const alvo of [A.tenantId, B.tenantId])
        await expect(s.rodar(sql`delete from tenants where id = ${alvo}`), `${s.nome} × delete`).rejects.toSatisfy(negadoPor(SEM_CRIAR));
    }
    expect((await app.db.execute(sql`select count(*)::int as n from tenants where id in (${A.tenantId}, ${B.tenantId})`)).rows[0]).toEqual({ n: 2 });
    // controle positivo: worker e contexto vazio criam e apagam (consultório sem filhos)
    const worker = (s: SQL) => withTenant({ tenantId: A.tenantId, role: 'worker' }, (tx) => tx.execute(s), app.db);
    const criado = async (rodar: (s: SQL) => Promise<unknown>) =>
      ((await rodar(sql`${novo()} returning id`)) as { rows: { id: string }[] }).rows[0].id;
    const c1 = await criado(worker);
    const c2 = await criado((s) => app.db.execute(s));
    await worker(sql`delete from tenants where id = ${c2}`);
    await app.db.execute(sql`delete from tenants where id = ${c1}`);
    expect((await app.db.execute(sql`select count(*)::int as n from tenants where id in (${c1}, ${c2})`)).rows[0]).toEqual({ n: 0 });
  });

  it('os gatilhos de antes continuam recusando primeiro, com a mensagem deles, nas sessões de paciente', async () => {
    const { A, p } = await cenario();
    await expect(
      withTenant(ctxPaciente(A.tenantId, p.id), (tx) => tx.execute(sql`update tenants set ia_nutri_ativada_em = now() where id = ${A.tenantId}`), app.db),
    ).rejects.toSatisfy(negadoPor('só a equipe e o worker'));
  });

  it('worker e contexto vazio (admin, migrations, scripts) continuam podendo, em qualquer consultório', async () => {
    const { A, B } = await cenario();
    await withTenant({ tenantId: A.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update tenants set ia_aviso_mes = '2026-11' where id = ${B.tenantId}`), app.db);
    await app.db.execute(sql`update tenants set status = 'suspensa', antecedencia_min_h = 4 where id = ${B.tenantId}`);
    expect(await linha(B.tenantId)).toMatchObject({ status: 'suspensa', antecedencia_min_h: 4 });
  });
});
