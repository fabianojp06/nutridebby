// D21 / P09-05: ícones do PWA a partir dos SVG (rodar com `pnpm icones` quando a arte mudar; os PNG ficam no repositório).
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const conjuntos: [string, [string, number][]][] = [
  ['public/icones/icone.svg', [
    ['public/icones/icone-192.png', 192],
    ['public/icones/icone-512.png', 512],
    ['public/icones/icone-maskable-512.png', 512],
    ['public/icones/apple-touch-icon.png', 180],
  ]],
  ['public/icones/painel.svg', [
    ['public/icones/painel-192.png', 192],
    ['public/icones/painel-512.png', 512],
    ['public/icones/painel-maskable-512.png', 512],
    ['public/icones/painel-apple-touch-icon.png', 180],
  ]],
];
let n = 0;
for (const [origem, saidas] of conjuntos) {
  const svg = await readFile(origem);
  for (const [arquivo, lado] of saidas) {
    await sharp(svg, { density: 384 }).resize(lado, lado).png({ compressionLevel: 9 }).toFile(arquivo);
    n++;
  }
}
console.log(`ícones gerados: ${n}`);
