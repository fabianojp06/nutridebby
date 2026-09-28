import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { detectarTipo } from '@/lib/file-type';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from './armazenamento';
import { apontarLogo, LogoOcupadoError, MSG_SVG_FILTRO, processarLogo, SvgFiltroError, trocarLogo } from './logo';

afterAll(() => closeDb());
const imagem = (w: number, h: number, formato: 'png' | 'jpeg') =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2E7D32' } })[formato]().toBuffer();
const SVG_COM_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><rect width="64" height="64" fill="#2E7D32"/></svg>',
);
// T10-R1: um <filter> pequeno referenciado por um <rect> grande já basta para custar CPU real —
// não é preciso repetir; o teste só confirma que a recusa acontece antes do sharp entrar em cena.
const SVG_COM_FILTRO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500"><filter id="f"><feGaussianBlur stdDeviation="500"/></filter><rect width="1500" height="1500" filter="url(#f)"/></svg>',
);
async function novoTenant(prefixo: string) {
  const [t] = await getDb().insert(tenants).values({ slug: `${prefixo}-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Logo' }).returning();
  return t;
}

describe('processarLogo (US-005: PNG/JPEG/SVG, máx. 512 px)', () => {
  it('reduz para caber em 512 px e devolve PNG', async () => {
    const out = await processarLogo(await imagem(1024, 600, 'jpeg'));
    expect(detectarTipo(out)?.ext).toBe('png');
    expect(await sharp(out).metadata()).toMatchObject({ width: 512, height: 300 });
  });
  it('não aumenta imagem pequena', async () => {
    expect(await sharp(await processarLogo(await imagem(100, 80, 'png'))).metadata()).toMatchObject({ width: 100, height: 80 });
  });
  it('SVG com <script> vira PNG (Review Focus 3)', async () => {
    const out = await processarLogo(SVG_COM_SCRIPT);
    expect(detectarTipo(out)?.ext).toBe('png');
  });
  it('PDF, HTML e imagem corrompida são recusados', async () => {
    for (const b of [Buffer.from('%PDF-1.4'), Buffer.from('<html></html>'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)])]) {
      await expect(processarLogo(b)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    }
  });

  // T10-R3a: substitui o `out.includes('script')` — verificações reais de conteúdo, não de texto solto.
  it('SVG com <image href/xlink:href="file://…"> não copia pixels do arquivo local para o logo (SSRF/LFI)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nd-svg-ssrf-'));
    try {
      const vermelho = path.join(dir, 'vermelho.png');
      writeFileSync(vermelho, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer());
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">` +
          `<image href="file://${vermelho}" xlink:href="file://${vermelho}" x="0" y="0" width="64" height="64"/></svg>`,
      );
      const out = await processarLogo(svg);
      const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let temVermelho = false;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50) {
          temVermelho = true;
          break;
        }
      }
      expect(temVermelho).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SVG com <!ENTITY> é recusado no caminho do logo (XXE)', async () => {
    const comEntidade = Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "x">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>');
    await expect(processarLogo(comEntidade)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
  });

  // T10-R1a/d
  it('SVG com <filter>/<fe…> é recusado antes de chamar o sharp, com a mensagem exata (rápido)', async () => {
    const inicio = performance.now();
    await expect(processarLogo(SVG_COM_FILTRO)).rejects.toThrow(MSG_SVG_FILTRO);
    expect(performance.now() - inicio).toBeLessThan(200);
  });
  it('recusa filtro com prefixo de namespace e maiúsculas (<svg:filter>, <FEGAUSSIANBLUR>)', async () => {
    const variantes = [
      '<svg xmlns:svg="http://www.w3.org/2000/svg"><svg:filter id="f"></svg:filter></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><FEGAUSSIANBLUR stdDeviation="1"/></svg>',
    ];
    for (const v of variantes) await expect(processarLogo(Buffer.from(v))).rejects.toBeInstanceOf(SvgFiltroError);
  });

  // T10-R1c/d
  it('duas chamadas simultâneas: a segunda é recusada com 429 enquanto a primeira processa', async () => {
    const buf = await imagem(300, 300, 'png');
    const p1 = processarLogo(buf);
    const p2 = processarLogo(buf);
    await expect(p2).rejects.toBeInstanceOf(LogoOcupadoError);
    await expect(p1).resolves.toBeInstanceOf(Buffer);
  });
});

describe('trocarLogo', () => {
  it('grava o novo, aponta tenants.logo_path e apaga o anterior (a cota só conta o atual)', async () => {
    const t = await novoTenant('logo');
    const ctx = { tenantId: t.id, role: 'nutri' as const };
    const primeiro = await trocarLogo(ctx, await imagem(300, 300, 'png'));
    const segundo = await trocarLogo(ctx, await imagem(200, 200, 'png'));
    const [r] = await getDb().select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toBe(segundo);
    expect(() => readFileSync(path.join(getEnv().DATA_DIR, primeiro))).toThrow();
    expect(r.armazenamentoBytes).toBe(readFileSync(path.join(getEnv().DATA_DIR, segundo)).length);
  });

  // T10-R3b
  it('o UPDATE falha depois do salvarArquivo: o arquivo novo é apagado e a cota devolvida', async () => {
    const t = await novoTenant('logo-falha');
    const ctx = { tenantId: t.id, role: 'nutri' as const };
    const dbQuebrado = { ...getDb(), transaction: () => Promise.reject(new Error('falha simulada de banco')) } as unknown as Db;
    await expect(trocarLogo(ctx, await imagem(100, 100, 'png'), { db: dbQuebrado })).rejects.toThrow('falha simulada de banco');
    const [r] = await getDb().select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toBeNull();
    expect(r.armazenamentoBytes).toBe(0); // salvarArquivo tinha reservado a cota; foi devolvida
  });

  // T10-R3b: duas trocas concorrentes do mesmo tenant não devem deixar um arquivo órfão contado
  // na cota. Testa `apontarLogo` diretamente (o núcleo atômico que `trocarLogo` usa) para não
  // depender do tempo real do sharp — o semáforo de processamento (T10-R1c) já garante que duas
  // chamadas a `trocarLogo`/`processarLogo` de verdade nunca rodam ao mesmo tempo; a corrida que
  // este teste cobre é a troca do ponteiro em si, entre um `salvarArquivo` e outro. Duas chamadas
  // "soltas" via `Promise.all` não provam nada por si (num banco local rápido, elas tendem a
  // rodar em sequência de qualquer jeito, com ou sem a trava) — por isso o teste segura a
  // primeira transação aberta de propósito e confirma que a segunda fica bloqueada até a
  // primeira confirmar: é exatamente o `SELECT ... FOR UPDATE` fazendo o trabalho, não timing.
  it('SELECT ... FOR UPDATE bloqueia a segunda troca até a primeira confirmar (trava real, não timing)', async () => {
    const t = await novoTenant('logo-lock');
    const ctx = { tenantId: t.id, role: 'nutri' as const };
    const salvo1 = await salvarArquivo(ctx, { tipo: 'logo', conteudo: await imagem(150, 150, 'png'), permitidos: ['png'] });
    const salvo2 = await salvarArquivo(ctx, { tipo: 'logo', conteudo: await imagem(250, 250, 'png'), permitidos: ['png'] });

    let liberar!: () => void;
    const segure = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    // Reproduz o que `apontarLogo` faz, mas segura a transação aberta (linha travada) até o
    // teste mandar liberar — simula a janela real entre o SELECT FOR UPDATE e o commit.
    const primeira = getDb().transaction(async (tx) => {
      await tx.select({ logoPath: tenants.logoPath }).from(tenants).where(eq(tenants.id, t.id)).for('update');
      await segure;
      await tx.update(tenants).set({ logoPath: salvo1.caminho, updatedAt: new Date() }).where(eq(tenants.id, t.id));
    });

    let segundaResolveu = false;
    const segunda = apontarLogo(ctx, salvo2.caminho, getDb()).then((antigo) => {
      segundaResolveu = true;
      return antigo;
    });

    await new Promise((r) => setTimeout(r, 150)); // tempo de sobra para a segunda tentar e bloquear
    expect(segundaResolveu).toBe(false); // ainda travada pela primeira transação, não commitada

    liberar();
    await primeira;
    const antigo2 = await segunda;
    expect(segundaResolveu).toBe(true);
    expect(antigo2).toBe(salvo1.caminho); // viu o caminho que a primeira de fato gravou, não o valor antigo (null)

    await apagarArquivo(ctx, { caminho: salvo1.caminho }); // o vencedor final é salvo2 (a segunda troca)
    const [r] = await getDb().select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toBe(salvo2.caminho);
    expect(() => readFileSync(path.join(getEnv().DATA_DIR, salvo1.caminho))).toThrow(); // sem órfão em disco
    expect(r.armazenamentoBytes).toBe(salvo2.bytes); // sem órfão na cota
  });
});
