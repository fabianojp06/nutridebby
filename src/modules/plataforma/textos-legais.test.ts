import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aditivoIa, textoCorrido } from '@/modules/ia/textos-legais';
import { formatarData } from '@/modules/pacientes/datas';
import {
  TERMO_PACIENTE,
  TERMO_PACIENTE_MUDOU,
  TERMO_PACIENTE_ROTULO,
  TERMO_PACIENTE_TITULO,
  TERMO_PACIENTE_VERSAO,
  TERMO_PACIENTE_VERSAO_DATA,
} from '@/modules/pacientes/termo-paciente';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_TEXTOS } from '@/modules/pacientes/termo-paciente-textos';
import { DPA_MUDOU, DPA_PARAGRAFOS, DPA_ROTULO, DPA_TERMO, DPA_TEXTOS, DPA_TITULO, DPA_VERSAO, DPA_VERSAO_DATA } from './dpa';
import { EMAIL_PRIVACIDADE } from './privacidade';

/**
 * P08-06 (15/10/2026): o Termo de Uso e Privacidade do paciente e o DPA da nutricionista saem da 0.1 provisória para a
 * 1.0 definitiva (na linha da A-D27). O texto em vigor e o rótulo do aceite citam a versão em vigor; as versões antigas
 * ficam no mapa, para mostrar o que quem aceitou nelas leu.
 */
const OPERADORA = 'WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07';
// a data da versão é fixada uma vez (TERMO_PACIENTE_VERSAO_DATA e DPA_VERSAO_DATA); o resto deriva dela, para a troca
// da data no dia do deploy mexer só nessas duas linhas
const DATA_TERMO = formatarData(TERMO_PACIENTE_VERSAO_DATA);
const DATA_DPA = formatarData(DPA_VERSAO_DATA);

describe('Termo de Uso e Privacidade do paciente 1.0', () => {
  it('versão 1.0, sem nada de provisório no que é mostrado, com a data no rodapé', () => {
    expect(TERMO_PACIENTE_VERSAO).toBe('1.0');
    expect(TERMO_PACIENTE).toBe('termo-paciente-1.0');
    expect(TERMO_PACIENTE_VERSAO_DATA).toBe('2026-10-15');
    for (const t of [TERMO_PACIENTE_TITULO, TERMO_PACIENTE_ROTULO, ...TERMO_PACIENTE_PARAGRAFOS]) expect(t).not.toMatch(/provis/i);
    expect(TERMO_PACIENTE_ROTULO).toBe('Li e aceito o Termo de Uso e Privacidade (versão 1.0)');
    expect(TERMO_PACIENTE_PARAGRAFOS).toHaveLength(16);
    expect(TERMO_PACIENTE_PARAGRAFOS.at(-1)).toBe(`Versão 1.0, de ${DATA_TERMO}.`);
    expect(TERMO_PACIENTE_PARAGRAFOS.join(' ')).not.toContain('{data}');
  });

  it('cita a operadora e os suboperadores em uso em produção (sem Sentry nem o R2, que não estão em uso)', () => {
    const texto = TERMO_PACIENTE_PARAGRAFOS.join(' ');
    expect(texto).toContain(OPERADORA);
    for (const s of ['Hostinger', 'Resend', 'Cloudflare', 'Backblaze', 'WhatsApp (Meta)', 'YouTube', 'Vimeo', 'ANPD']) expect(texto).toContain(s);
    expect(texto).not.toMatch(/sentry|R2\b/i);
  });

  it('servidor no Brasil e cópia de segurança fora, criptografada (Hostinger em Campinas/SP, conferido em 15/10/2026)', () => {
    const texto = TERMO_PACIENTE_PARAGRAFOS.join(' ');
    expect(texto).toContain('Hostinger (servidor, no Brasil)');
    expect(texto).toContain('O servidor fica no Brasil. A cópia de segurança fica fora do Brasil, criptografada antes de sair, e a Backblaze não tem a chave para abri-la.');
    expect(texto).not.toMatch(/podem ficar em outro país/);
  });

  it('cita o canal de privacidade da operadora no parágrafo dela', () => {
    expect(EMAIL_PRIVACIDADE).toBe('privacidade@wsscloud.tech');
    expect(TERMO_PACIENTE_PARAGRAFOS[2]).toContain(OPERADORA);
    expect(TERMO_PACIENTE_PARAGRAFOS[2]).toContain('Para falar com a operadora sobre privacidade, escreva para privacidade@wsscloud.tech.');
  });

  it('aviso de /p/termo para quem aceitou uma versão anterior', () => {
    expect(TERMO_PACIENTE_MUDOU).toBe(`O termo mudou (versão 1.0, de ${DATA_TERMO}). Leia e aceite para continuar usando o app.`);
  });

  it('o mapa guarda a 0.1 provisória (o que quem aceitou leu) e a 1.0 em vigor é a mostrada', () => {
    expect(Object.keys(TERMO_PACIENTE_TEXTOS).sort()).toEqual(['0.1-provisorio', '1.0']);
    expect(TERMO_PACIENTE_TEXTOS[TERMO_PACIENTE_VERSAO]).toEqual({ data: TERMO_PACIENTE_VERSAO_DATA, paragrafos: TERMO_PACIENTE_PARAGRAFOS });
    const antiga = TERMO_PACIENTE_TEXTOS['0.1-provisorio'];
    expect(antiga.data).toBe('2026-09-30');
    expect(antiga.paragrafos[0]).toBe('Versão provisória, a ser substituída pelo texto revisado por advogado antes do uso com pacientes reais.');
    expect(antiga.paragrafos).toHaveLength(5);
  });
});

describe('Contrato de tratamento de dados (DPA) 1.0', () => {
  it('versão 1.0, sem nada de provisório no que é mostrado, com a data no rodapé', () => {
    expect(DPA_VERSAO).toBe('1.0');
    expect(DPA_TERMO).toBe('dpa-1.0');
    expect(DPA_VERSAO_DATA).toBe('2026-10-15');
    for (const t of [DPA_TITULO, DPA_ROTULO, ...DPA_PARAGRAFOS]) expect(t).not.toMatch(/provis/i);
    expect(DPA_ROTULO).toBe('Li e aceito o contrato de tratamento de dados (DPA), versão 1.0');
    expect(DPA_MUDOU).toBe(`O contrato de tratamento de dados mudou (versão 1.0, de ${DATA_DPA}). Leia e aceite para continuar usando o painel.`);
    expect(DPA_PARAGRAFOS).toHaveLength(16);
    expect(DPA_PARAGRAFOS.at(-1)).toBe(`Versão 1.0, de ${DATA_DPA}.`);
    expect(DPA_PARAGRAFOS.join(' ')).not.toContain('{data}');
    // cláusulas numeradas de 1 a 15, na ordem (o aditivo de IA remete a elas)
    expect(DPA_PARAGRAFOS.slice(0, 15).map((p) => Number(p.split('.')[0]))).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('a cláusula 8 lista os suboperadores em uso e remete a IA ao aditivo (o aditivo cita "as listadas no DPA")', () => {
    expect(DPA_PARAGRAFOS[0]).toContain(OPERADORA);
    const c8 = DPA_PARAGRAFOS[7];
    expect(c8).toMatch(/^8\. Suboperadores/);
    for (const s of ['Hostinger', 'Resend', 'Cloudflare', 'Backblaze', 'Google, Apple, Mozilla e Microsoft', 'YouTube', 'Vimeo', 'aditivo de IA']) expect(c8).toContain(s);
    const texto = DPA_PARAGRAFOS.join(' ');
    expect(texto).not.toMatch(/sentry|R2\b|Anthropic/i);
    // servidor no Brasil (Campinas/SP, conferido em 15/10/2026); a Backblaze não tem região no Brasil
    expect(c8).toContain('Hostinger (servidor, banco de dados e arquivos, no Brasil)');
    expect(c8).toContain('guarda da cópia de segurança, fora do Brasil, criptografada antes do envio; a Backblaze não tem a chave para abri-la');
    expect(DPA_PARAGRAFOS[6]).toContain('O servidor é contratado da Hostinger e fica no Brasil.');
    // canal de privacidade: pedidos de titular (cláusula 5) e avisos à OPERADORA (cláusula 15)
    expect(DPA_PARAGRAFOS[4]).toMatch(/^5\. Direitos dos titulares\./);
    expect(DPA_PARAGRAFOS[4]).toContain('inclusive pelo e-mail privacidade@wsscloud.tech');
    expect(DPA_PARAGRAFOS[14]).toMatch(/^15\. Outros textos e mudanças\./);
    expect(DPA_PARAGRAFOS[14]).toContain('os da CONTROLADORA à OPERADORA vão a privacidade@wsscloud.tech');
  });

  it('o aditivo de IA remete à lista de suboperadores do DPA, que remete o fornecedor de IA ao aditivo', () => {
    const c3 = textoCorrido(aditivoIa('anthropic-us').paragrafos[2]);
    expect(c3).toMatch(/^3\. Fornecedor e país\./);
    expect(c3).toContain('além das listadas no DPA');
    expect(DPA_PARAGRAFOS[7]).toContain('O fornecedor de inteligência artificial, quando a CONTROLADORA ativa a IA, está descrito no aditivo de IA.');
    expect(DPA_PARAGRAFOS[9]).toContain('o país onde cada suboperador trata os dados');
  });

  it('o mapa guarda a 0.1 provisória e a 1.0 em vigor é a mostrada', () => {
    expect(Object.keys(DPA_TEXTOS).sort()).toEqual(['0.1-provisorio', '1.0']);
    expect(DPA_TEXTOS[DPA_VERSAO]).toEqual({ data: DPA_VERSAO_DATA, paragrafos: DPA_PARAGRAFOS });
    const antiga = DPA_TEXTOS['0.1-provisorio'];
    expect(antiga.data).toBe('2026-09-28');
    expect(antiga.paragrafos.at(-1)).toBe('Versão provisória 0.1, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.');
    expect(antiga.paragrafos).toHaveLength(8);
  });
});

describe('telas de aceite mostram o texto inteiro (P08-06)', () => {
  // O termo 1.0 e o DPA 1.0 têm 16 parágrafos: numa caixa de altura fixa com rolagem própria, no celular, não dá para ler
  // o que se aceita (como em /p/termo, o texto fica na página).
  it.each([
    ['src/app/n/[slug]/agendar-form.tsx', 'termo-titulo'],
    ['src/app/convite/paciente/[token]/page.tsx', 'termo-titulo'],
    ['src/app/convite/[token]/page.tsx', 'dpa-titulo'],
    ['src/app/painel/dpa/page.tsx', 'aria-label={DPA_TITULO}'],
  ])('%s sem max-h nem overflow na caixa do texto', (arquivo, marca) => {
    const linha = readFileSync(arquivo, 'utf8').split('\n').find((l) => l.includes('<section') && l.includes(marca));
    expect(linha).toBeDefined();
    expect(linha).not.toMatch(/max-h-|overflow-y-auto|tabIndex/);
  });
});

describe('textos fora do bundle do navegador (P08-06)', () => {
  // os formulários de cliente importam o rótulo de `termo-paciente.ts`; o mapa com todas as versões fica em
  // `termo-paciente-textos.ts`, que só páginas (servidor) importam
  const arquivos = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  it('nenhum arquivo "use client" importa termo-paciente-textos', () => {
    const cliente = arquivos('src').filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));
    expect(cliente.length).toBeGreaterThan(0);
    for (const f of cliente) expect(readFileSync(f, 'utf8'), f).not.toContain('termo-paciente-textos');
  });
  it('termo-paciente.ts (importado pelos formulários) não tem o texto do termo', () => {
    expect(readFileSync('src/modules/pacientes/termo-paciente.ts', 'utf8')).not.toContain('paragrafos: [');
  });
});

describe('o aceite grava só a versão que a pessoa leu (P08-06, /code-review do PR #38)', () => {
  // o formulário manda a versão mostrada (campo `versao`); com a página aberta durante um deploy de versão nova, a action
  // recusa em vez de gravar o aceite de um texto que a pessoa não viu (a página pública já guarda a versão no pedido)
  it.each([
    ['src/app/p/termo/termo-form.tsx', 'src/app/p/termo/actions.ts', 1],
    ['src/app/convite/paciente/[token]/form.tsx', 'src/app/convite/paciente/[token]/actions.ts', 2],
    ['src/app/painel/dpa/form.tsx', 'src/app/painel/actions.ts', 1],
    ['src/app/convite/[token]/form.tsx', 'src/app/convite/[token]/actions.ts', 1],
  ])('%s manda a versão e a action confere', (formulario, acao, conferencias) => {
    expect(readFileSync(formulario, 'utf8')).toContain('<input type="hidden" name="versao" value={');
    expect(readFileSync(acao, 'utf8').split('leuAVersaoEmVigor(formData,').length - 1).toBe(conferencias);
  });
});
