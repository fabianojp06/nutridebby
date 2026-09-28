import { describe, expect, it } from 'vitest';
import { parseEnv, parseMigratorEnv, parseServerEnv, parseWorkerEnv } from './env';

const DATABASE_URL = 'postgres://nutri_app:app@localhost:54329/nutri';
const DATABASE_URL_MIGRATOR = 'postgres://nutri_owner:owner@localhost:54329/nutri';

const KEY = Buffer.alloc(32, 7).toString('base64');

const base = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL,
  AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: KEY,
};

describe('parseEnv (app)', () => {
  it('aceita configuração válida sem DATABASE_URL_MIGRATOR e aplica padrão de LOG_LEVEL', () => {
    expect(parseEnv(base).LOG_LEVEL).toBe('info');
  });
  it('não expõe DATABASE_URL_MIGRATOR mesmo que esteja no ambiente', () => {
    expect(parseEnv({ ...base, DATABASE_URL_MIGRATOR })).not.toHaveProperty('DATABASE_URL_MIGRATOR');
  });
  it('recusa DATABASE_URL ausente com mensagem clara', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
  it('recusa AUTH_SECRET com menos de 32 caracteres', () => {
    expect(() => parseEnv({ ...base, AUTH_SECRET: 'curto' })).toThrow(/AUTH_SECRET/);
  });
  it('recusa APP_URL que não é URL', () => {
    expect(() => parseEnv({ ...base, APP_URL: 'app' })).toThrow(/APP_URL/);
  });
  it('recusa DATABASE_URL inválida (não-URL) sem exceção crua', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'postgresonly' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, DATABASE_URL: 'postgresonly' })).not.toThrow(TypeError);
  });
  it('TRUSTED_PROXIES ausente vira lista vazia', () => {
    expect(parseEnv(base).TRUSTED_PROXIES).toEqual([]);
  });
  it('TRUSTED_PROXIES com CIDRs separados por vírgula vira lista', () => {
    expect(parseEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, 172.16.0.0/12' }).TRUSTED_PROXIES).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
    ]);
  });
});

describe('parseServerEnv (worker)', () => {
  it('só precisa de DATABASE_URL: sem AUTH_SECRET, APP_URL nem DATABASE_URL_MIGRATOR', () => {
    expect(parseServerEnv({ DATABASE_URL })).toEqual({ NODE_ENV: 'development', DATABASE_URL, LOG_LEVEL: 'info' });
  });
  it('recusa DATABASE_URL ausente', () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });
  it('NODE_ENV="" não vira o padrão em silêncio (T2-R2): continua recusado', () => {
    expect(() => parseServerEnv({ DATABASE_URL, NODE_ENV: '' })).toThrow(/NODE_ENV/);
  });
  it('LOG_LEVEL="" não vira o padrão em silêncio (T2-R2): continua recusado', () => {
    expect(() => parseServerEnv({ DATABASE_URL, LOG_LEVEL: '' })).toThrow(/LOG_LEVEL/);
  });
});

describe('parseMigratorEnv (migrations)', () => {
  it('exige DATABASE_URL_MIGRATOR', () => {
    expect(() => parseMigratorEnv({ DATABASE_URL })).toThrow(/DATABASE_URL_MIGRATOR/);
  });
  it('aceita os dois roles, sem exigir AUTH_SECRET nem APP_URL', () => {
    expect(parseMigratorEnv({ DATABASE_URL, DATABASE_URL_MIGRATOR })).toEqual({ DATABASE_URL, DATABASE_URL_MIGRATOR });
  });
  it('recusa app e migrator com o mesmo usuário do banco', () => {
    expect(() =>
      parseMigratorEnv({ DATABASE_URL, DATABASE_URL_MIGRATOR: 'postgres://nutri_app:x@localhost:54329/nutri' }),
    ).toThrow(/roles diferentes/);
  });
});

describe('parseEnv — Plano 02', () => {
  it('recusa ENCRYPTION_KEY ausente ou que não tem 32 bytes em base64', () => {
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: undefined })).toThrow(/ENCRYPTION_KEY é obrigatória/);
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });
  it('em produção exige TRUSTED_PROXIES (item adiado do Plano 01)', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/TRUSTED_PROXIES é obrigatória em produção/);
    expect(parseEnv({ ...base, NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.1.0/24' }).TRUSTED_PROXIES).toEqual([
      '10.0.1.0/24',
    ]);
  });
  it('recusa TRUSTED_PROXIES com item que não é IP nem CIDR', () => {
    expect(() => parseEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, rede-do-traefik' })).toThrow(/IPs\/CIDRs/);
  });
  it('recusa TRUSTED_PROXIES com IPv4 fora de faixa ou prefixo fora do intervalo (PF-F6)', () => {
    expect(() => parseEnv({ ...base, TRUSTED_PROXIES: '999.1.1.1/99' })).toThrow(/IPs\/CIDRs/);
    expect(() => parseEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/33' })).toThrow(/IPs\/CIDRs/);
  });
  it('recusa TRUSTED_PROXIES com IPv6 malformado (PF-F6)', () => {
    expect(() => parseEnv({ ...base, TRUSTED_PROXIES: '::::' })).toThrow(/IPs\/CIDRs/);
  });
  it('aceita IPv4 e IPv6 simples, com e sem prefixo', () => {
    expect(parseEnv({ ...base, TRUSTED_PROXIES: '10.0.1.2, ::1, 2001:db8::/32' }).TRUSTED_PROXIES).toEqual([
      '10.0.1.2',
      '::1',
      '2001:db8::/32',
    ]);
  });
});

describe('parseWorkerEnv (worker)', () => {
  it('exige APP_URL e ENCRYPTION_KEY, mas não AUTH_SECRET nem DATABASE_URL_MIGRATOR', () => {
    const env = parseWorkerEnv({
      DATABASE_URL,
      APP_URL: 'http://localhost:3100',
      ENCRYPTION_KEY: KEY,
      EMAIL_FROM: 'a@b.dev',
      MAILPIT_URL: 'http://localhost:8025',
    });
    expect(env).toMatchObject({ APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY });
    expect(env).not.toHaveProperty('AUTH_SECRET');
    expect(() => parseWorkerEnv({ DATABASE_URL, ENCRYPTION_KEY: KEY })).toThrow(/APP_URL/);
  });

  const w = { DATABASE_URL, APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY, EMAIL_FROM: 'NutriDebby <nao-responda@exemplo.com>' };
  it('fora de produção usa Mailpit por padrão e exige MAILPIT_URL', () => {
    expect(parseWorkerEnv({ ...w, MAILPIT_URL: 'http://localhost:8025' }).EMAIL_TRANSPORT).toBe('mailpit');
    expect(() => parseWorkerEnv(w)).toThrow(/MAILPIT_URL/);
  });
  it('em produção usa Resend por padrão e exige RESEND_API_KEY', () => {
    expect(() => parseWorkerEnv({ ...w, NODE_ENV: 'production' })).toThrow(/RESEND_API_KEY é obrigatória/);
    expect(parseWorkerEnv({ ...w, NODE_ENV: 'production', RESEND_API_KEY: 're_x' }).EMAIL_TRANSPORT).toBe('resend');
  });
  it('EMAIL_TRANSPORT=mailpit explícito vale até em produção (E2E do CI)', () => {
    expect(parseWorkerEnv({ ...w, NODE_ENV: 'production', EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://localhost:8025' }).EMAIL_TRANSPORT).toBe(
      'mailpit',
    );
  });
  it('recusa EMAIL_FROM sem endereço', () => {
    expect(() => parseWorkerEnv({ ...w, EMAIL_FROM: 'NutriDebby', MAILPIT_URL: 'http://localhost:8025' })).toThrow(/EMAIL_FROM/);
  });
  it('RESEND_API_KEY em branco (placeholder de .env) conta como ausente: mensagem de negócio, não de tipo', () => {
    expect(() => parseWorkerEnv({ ...w, NODE_ENV: 'production', RESEND_API_KEY: '' })).toThrow(/RESEND_API_KEY é obrigatória/);
  });
});
