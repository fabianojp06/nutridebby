import { describe, expect, it } from 'vitest';
import {
  TERMO_PACIENTE,
  TERMO_PACIENTE_PARAGRAFOS,
  TERMO_PACIENTE_ROTULO,
  TERMO_PACIENTE_TEXTOS,
  TERMO_PACIENTE_TITULO,
  TERMO_PACIENTE_VERSAO,
  TERMO_PACIENTE_VERSAO_DATA,
} from '@/modules/pacientes/termo-paciente';
import { DPA_PARAGRAFOS, DPA_ROTULO, DPA_TERMO, DPA_TEXTOS, DPA_TITULO, DPA_VERSAO, DPA_VERSAO_DATA } from './dpa';

/**
 * P08-06 (15/10/2026): o Termo de Uso e Privacidade do paciente e o DPA da nutricionista saem da 0.1 provisória para a
 * 1.0 definitiva (na linha da A-D27). O texto em vigor e o rótulo do aceite citam a versão em vigor; as versões antigas
 * ficam no mapa, para mostrar o que quem aceitou nelas leu.
 */
const OPERADORA = 'WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07';

describe('Termo de Uso e Privacidade do paciente 1.0', () => {
  it('versão 1.0, sem nada de provisório no que é mostrado, com a data no rodapé', () => {
    expect(TERMO_PACIENTE_VERSAO).toBe('1.0');
    expect(TERMO_PACIENTE).toBe('termo-paciente-1.0');
    expect(TERMO_PACIENTE_VERSAO_DATA).toBe('2026-10-15');
    for (const t of [TERMO_PACIENTE_TITULO, TERMO_PACIENTE_ROTULO, ...TERMO_PACIENTE_PARAGRAFOS]) expect(t).not.toMatch(/provis/i);
    expect(TERMO_PACIENTE_ROTULO).toBe('Li e aceito o Termo de Uso e Privacidade (versão 1.0)');
    expect(TERMO_PACIENTE_PARAGRAFOS).toHaveLength(16);
    expect(TERMO_PACIENTE_PARAGRAFOS.at(-1)).toBe('Versão 1.0, de 15/10/2026.');
    expect(TERMO_PACIENTE_PARAGRAFOS.join(' ')).not.toContain('{data}');
  });

  it('cita a operadora e os suboperadores em uso em produção (sem Sentry nem o R2, que não estão em uso)', () => {
    const texto = TERMO_PACIENTE_PARAGRAFOS.join(' ');
    expect(texto).toContain(OPERADORA);
    for (const s of ['Hostinger', 'Resend', 'Cloudflare', 'Backblaze', 'WhatsApp (Meta)', 'YouTube', 'Vimeo', 'ANPD']) expect(texto).toContain(s);
    expect(texto).not.toMatch(/sentry|R2\b/i);
  });

  it('o mapa guarda a 0.1 provisória (o que quem aceitou leu) e a 1.0 em vigor é a mostrada', () => {
    expect(Object.keys(TERMO_PACIENTE_TEXTOS).sort()).toEqual(['0.1-provisorio', '1.0']);
    expect(TERMO_PACIENTE_TEXTOS[TERMO_PACIENTE_VERSAO]).toEqual({ data: '2026-10-15', paragrafos: TERMO_PACIENTE_PARAGRAFOS });
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
    expect(DPA_ROTULO).toBe('Li e aceito o contrato de tratamento de dados (DPA) (versão 1.0)');
    expect(DPA_PARAGRAFOS).toHaveLength(16);
    expect(DPA_PARAGRAFOS.at(-1)).toBe('Versão 1.0, de 15/10/2026.');
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
  });

  it('o mapa guarda a 0.1 provisória e a 1.0 em vigor é a mostrada', () => {
    expect(Object.keys(DPA_TEXTOS).sort()).toEqual(['0.1-provisorio', '1.0']);
    expect(DPA_TEXTOS[DPA_VERSAO]).toEqual({ data: '2026-10-15', paragrafos: DPA_PARAGRAFOS });
    const antiga = DPA_TEXTOS['0.1-provisorio'];
    expect(antiga.data).toBe('2026-09-28');
    expect(antiga.paragrafos.at(-1)).toBe('Versão provisória 0.1, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.');
    expect(antiga.paragrafos).toHaveLength(8);
  });
});
