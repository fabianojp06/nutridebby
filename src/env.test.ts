import { describe, expect, it } from 'vitest';
import { parseEnv, parseMigratorEnv, parseServerEnv } from './env';

const DATABASE_URL = 'postgres://nutri_app:app@localhost:54329/nutri';
const DATABASE_URL_MIGRATOR = 'postgres://nutri_owner:owner@localhost:54329/nutri';

const base = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL,
  AUTH_SECRET: 'x'.repeat(32),
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
