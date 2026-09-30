import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hash, verify } from '@node-rs/argon2';

// algorithm: 2 = Argon2id (o enum `Algorithm` é const enum e não funciona com isolatedModules)
const ARGON2 = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON2);
export const verifyPassword = (h: string, pw: string) => verify(h, pw);

let common: Set<string> | undefined;
export function commonPasswords(): ReadonlySet<string> {
  if (!common) {
    const file = readFileSync(path.join(process.cwd(), 'src/lib/common-passwords.txt'), 'utf8');
    common = new Set(file.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
  }
  return common;
}
