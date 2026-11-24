import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { urlWhatsappAniversario } from './whatsapp';

/** Plano 23 (RN-435, US-413 "Abrir no WhatsApp", PL-21): o link wa.me montado no navegador, com o texto fixo. */
describe('urlWhatsappAniversario (RN-435)', () => {
  it('wa.me com os dígitos do número e o texto fixo da RN-435, sem rodapé, sem link e sem http no texto', () => {
    const url = urlWhatsappAniversario('+5511912345678', 'Ana', 'Debby Silva');
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe('https://wa.me/5511912345678');
    const texto = u.searchParams.get('text');
    expect(texto).toBe('Feliz aniversário, Ana! Debby Silva deseja a você um novo ano com muita saúde.');
    expect(texto).not.toMatch(/http|www\.|NutriDebby|\/aniversario\//i);
    expect([...u.searchParams.keys()]).toEqual(['text']);
  });

  it('acentos e espaços vão codificados; o número sai só com dígitos', () => {
    const url = urlWhatsappAniversario('+55 (21) 98888-7777', 'José', 'Dra. Ângela Moura');
    expect(url.startsWith('https://wa.me/5521988887777?text=')).toBe(true);
    expect(url).not.toContain(' ');
    expect(new URL(url).searchParams.get('text')).toBe('Feliz aniversário, José! Dra. Ângela Moura deseja a você um novo ano com muita saúde.');
  });

  it('é o único dono da URL (PL-21) e é puro: sem server-only nem banco', () => {
    const fonte = readFileSync('src/app/painel/agenda/aniversariantes/whatsapp.ts', 'utf8');
    expect(fonte).not.toMatch(/server-only|@\/db\/|use server/);
  });
});
