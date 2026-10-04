import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { EVOLUTION_WEBHOOK_SECRET_EXEMPLO, parseEnv, parseMigratorEnv, parseServerEnv, parseWorkerEnv } from './env';

const DATABASE_URL = 'postgres://nutri_app:app@localhost:54329/nutri';
const DATABASE_URL_MIGRATOR = 'postgres://nutri_owner:owner@localhost:54329/nutri';

const KEY = Buffer.alloc(32, 7).toString('base64');

const base = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL,
  AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: KEY,
  FILE_URL_SECRET: 's'.repeat(32),
  DATA_DIR: './data',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
};

describe('parseEnv (app)', () => {
  it('recusa chaves de teste do Turnstile em produção fora de localhost', () => {
    const prod = { ...base, NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.0.0/8' };
    expect(() => parseEnv({ ...prod, APP_URL: 'https://app.exemplo.com' })).toThrow(/TURNSTILE_\* de teste não pode ser usada em produção/);
    expect(() => parseEnv({ ...prod, APP_URL: 'https://app.exemplo.com', TURNSTILE_SITE_KEY: '0x4AAAAAAAreal', TURNSTILE_SECRET_KEY: '2x0000000000000000000000000000000AA' })).toThrow(/produção/);
    expect(() => parseEnv({ ...prod, APP_URL: 'https://app.exemplo.com', TURNSTILE_SITE_KEY: '0x4AAAAAAAreal', TURNSTILE_SECRET_KEY: 'segredo-real-xyz' })).not.toThrow();
    expect(() => parseEnv({ ...prod, APP_URL: 'http://localhost:3100' })).not.toThrow();
    expect(() => parseEnv({ ...prod, APP_URL: 'http://127.0.0.1:3100' })).not.toThrow();
    expect(() => parseEnv({ ...base, APP_URL: 'https://app.exemplo.com' })).not.toThrow(); // dev/test: livre
  });
  it('exige as chaves do Turnstile (INT-06)', () => {
    expect(() => parseEnv({ ...base, TURNSTILE_SECRET_KEY: undefined })).toThrow(/TURNSTILE_SECRET_KEY/);
    expect(() => parseEnv({ ...base, TURNSTILE_SITE_KEY: '' })).toThrow(/TURNSTILE_SITE_KEY/);
  });
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
  it('P08-01: SENTRY_DSN é opcional, só https; vazio = desligado', () => {
    expect(parseEnv({ ...base, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
    expect(parseEnv({ ...base, SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2' }).SENTRY_DSN).toBe('https://abc@o1.ingest.de.sentry.io/2');
    expect(() => parseEnv({ ...base, SENTRY_DSN: 'http://abc@o1.ingest.sentry.io/2' })).toThrow('SENTRY_DSN deve começar com https://');
  });
  it('P08-05: CSP_MODO é opcional (valendo | relatorio); outro valor é recusado', () => {
    expect(parseEnv({ ...base, CSP_MODO: '' }).CSP_MODO).toBeUndefined();
    expect(parseEnv({ ...base, CSP_MODO: 'relatorio' }).CSP_MODO).toBe('relatorio');
    expect(() => parseEnv({ ...base, CSP_MODO: 'outro' })).toThrow('CSP_MODO deve ser valendo ou relatorio');
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
  it('recusa ENCRYPTION_KEY em base64 não canônica (M2): a chave errada só apareceria ao decifrar', () => {
    const outraUltima = KEY.slice(0, 42) + (KEY[42] === 'c' ? 'd' : 'c') + '='; // mesmos 32 bytes, bits de sobra ≠ 0
    expect(Buffer.from(outraUltima, 'base64')).toEqual(Buffer.from(KEY, 'base64'));
    for (const ruim of [outraUltima, `${KEY}\n`, ` ${KEY}`, KEY.replace('=', ''), KEY.replaceAll('/', '_').replaceAll('+', '-').replace('B', '-')]) {
      expect(() => parseEnv({ ...base, ENCRYPTION_KEY: ruim }), JSON.stringify(ruim)).toThrow(/32 bytes em base64/);
    }
    expect(parseEnv({ ...base, ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }).ENCRYPTION_KEY).toBeTruthy(); // a do CI
  });
  it('APP_URL inválida em produção dá a mensagem de configuração, não TypeError (M18)', () => {
    const prod = { ...base, NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.0.0/8' };
    expect(() => parseEnv({ ...prod, APP_URL: 'nao-e-url' })).toThrow(/^Configuração inválida — APP_URL/);
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

describe('parseEnv — armazenamento', () => {
  it('exige FILE_URL_SECRET com 32+ caracteres e resolve DATA_DIR para caminho absoluto', () => {
    expect(() => parseEnv({ ...base, FILE_URL_SECRET: 'curta' })).toThrow(/FILE_URL_SECRET/);
    expect(parseEnv(base).DATA_DIR).toMatch(/^\/.*\/data$/);
    expect(() => parseEnv({ ...base, DATA_DIR: undefined })).toThrow(/DATA_DIR/);
  });
});

describe('parseWorkerEnv (worker)', () => {
  it('P08-01: SENTRY_* vêm do schema comum — a mesma regra no worker que no app', () => {
    const w = { DATABASE_URL, APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY, EMAIL_FROM: 'a@b.dev', MAILPIT_URL: 'http://localhost:8025', DATA_DIR: './data' };
    expect(parseWorkerEnv({ ...w, SENTRY_DSN: '', SENTRY_ENVIRONMENT: 'producao' })).toMatchObject({ SENTRY_DSN: undefined, SENTRY_ENVIRONMENT: 'producao' });
    expect(() => parseWorkerEnv({ ...w, SENTRY_DSN: 'http://abc@o1.ingest.sentry.io/2' })).toThrow('SENTRY_DSN deve começar com https://');
    expect(() => parseWorkerEnv({ ...w, SENTRY_ENVIRONMENT: 'Produção' })).toThrow('SENTRY_ENVIRONMENT');
  });
  it('exige APP_URL e ENCRYPTION_KEY, mas não AUTH_SECRET nem DATABASE_URL_MIGRATOR', () => {
    const env = parseWorkerEnv({
      DATABASE_URL,
      APP_URL: 'http://localhost:3100',
      ENCRYPTION_KEY: KEY,
      EMAIL_FROM: 'a@b.dev',
      MAILPIT_URL: 'http://localhost:8025',
      DATA_DIR: './data',
    });
    expect(env).toMatchObject({ APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY });
    expect(env).not.toHaveProperty('AUTH_SECRET');
    expect(() => parseWorkerEnv({ DATABASE_URL, ENCRYPTION_KEY: KEY })).toThrow(/APP_URL/);
  });

  const w = {
    DATABASE_URL,
    APP_URL: 'http://localhost:3100',
    ENCRYPTION_KEY: KEY,
    EMAIL_FROM: 'NutriDebby <nao-responda@exemplo.com>',
    DATA_DIR: './data',
  };
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
  it('APP_URL normalizado: sem query, sem hash e sem barras no fim (links montados por urlDoApp)', () => {
    expect(parseEnv({ ...base, APP_URL: 'https://app.exemplo.com//?x=1#y' }).APP_URL).toBe('https://app.exemplo.com');
    expect(parseEnv({ ...base, APP_URL: 'https://exemplo.com/nutri/' }).APP_URL).toBe('https://exemplo.com/nutri');
    expect(parseWorkerEnv({ ...w, APP_URL: 'http://localhost:3100/', MAILPIT_URL: 'http://localhost:8025' }).APP_URL).toBe('http://localhost:3100');
  });
});

describe('WhatsApp pela Evolution (D1, D4)', () => {
  const evo = { EVOLUTION_API_URL: 'http://nutri_evolution:8080', EVOLUTION_API_KEY: 'k'.repeat(32), EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32) };
  const prod = { ...base, NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.0.0/8', APP_URL: 'https://app.exemplo.com', TURNSTILE_SITE_KEY: '0x4AAAAAAAreal', TURNSTILE_SECRET_KEY: '0x4AAAAAAArealsecret' };
  const interna = 'http://nutridebby_app:3000/api/webhooks/whatsapp';
  it('app: as três juntas ou nenhuma; segredo com 32+ caracteres', () => {
    expect(parseEnv({ ...base, ...evo }).EVOLUTION_API_URL).toBe('http://nutri_evolution:8080');
    expect(parseEnv(base).EVOLUTION_API_URL).toBeUndefined();
    expect(() => parseEnv({ ...base, EVOLUTION_API_URL: evo.EVOLUTION_API_URL })).toThrow(/juntas/);
    expect(() => parseEnv({ ...base, ...evo, EVOLUTION_WEBHOOK_SECRET: 'curto' })).toThrow(/32 caracteres/);
  });
  it('produção (rodada 1): só uma das três → erro; o webhook só por endereço interno, a URL pública só com EVOLUTION_WEBHOOK_URL_PUBLICA=1 (D4)', () => {
    for (const so of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_WEBHOOK_SECRET'] as const) expect(() => parseEnv({ ...prod, [so]: evo[so] }), so).toThrow(/juntas/);
    expect(parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: interna }).EVOLUTION_WEBHOOK_URL).toBe(interna);
    expect(parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: 'http://10.0.1.7:3000/api/webhooks/whatsapp' }).EVOLUTION_API_URL).toBe(evo.EVOLUTION_API_URL);
    expect(() => parseEnv({ ...prod, ...evo })).toThrow(/EVOLUTION_WEBHOOK_URL é obrigatória em produção/);
    const publica = 'https://app.exemplo.com/api/webhooks/whatsapp';
    expect(() => parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: publica })).toThrow(/endereço interno/);
    for (const falsa of ['http://10.exemplo.com/api/webhooks/whatsapp', 'http://[2001:db8::1]:3000/api/webhooks/whatsapp', 'http://8.8.8.8/api/webhooks/whatsapp']) {
      expect(() => parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: falsa }), falsa).toThrow(/endereço interno/);
    }
    expect(parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: publica, EVOLUTION_WEBHOOK_URL_PUBLICA: '1' }).EVOLUTION_WEBHOOK_URL_PUBLICA).toBe('1');
  });
  it('produção: o segredo de exemplo do .env.example é recusado (como as chaves de teste do Turnstile); em localhost e em dev vale', () => {
    const exemplo = { EVOLUTION_WEBHOOK_SECRET: EVOLUTION_WEBHOOK_SECRET_EXEMPLO };
    expect(() => parseEnv({ ...prod, ...evo, ...exemplo, EVOLUTION_WEBHOOK_URL: interna })).toThrow(/EVOLUTION_WEBHOOK_SECRET de exemplo não pode ser usada em produção/);
    expect(parseEnv({ ...prod, APP_URL: 'http://localhost:3000', WHATSAPP_SANDBOX: '1', ...exemplo }).WHATSAPP_SANDBOX).toBe('1'); // E2E com `next start`
    expect(parseEnv({ ...base, WHATSAPP_SANDBOX: '1', ...exemplo }).WHATSAPP_SANDBOX).toBe('1');
    // a constante é o valor que o .env.example traz (sem imprimir o valor se divergir)
    const linha = /^EVOLUTION_WEBHOOK_SECRET=(.*)$/m.exec(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'))?.[1];
    expect(linha === EVOLUTION_WEBHOOK_SECRET_EXEMPLO, '.env.example e EVOLUTION_WEBHOOK_SECRET_EXEMPLO divergem').toBe(true);
  });
  it('sandbox: recusado em produção fora de localhost; exige o segredo do webhook (o E2E assina os eventos); só o segredo, sem URL e chave, não é configuração pela metade', () => {
    expect(() => parseEnv({ ...prod, WHATSAPP_SANDBOX: '1', EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32) })).toThrow(/WHATSAPP_SANDBOX só fora de produção/);
    expect(() => parseEnv({ ...base, WHATSAPP_SANDBOX: '1' })).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
    expect(parseEnv({ ...base, WHATSAPP_SANDBOX: '1', EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32) }).WHATSAPP_SANDBOX).toBe('1');
    expect(() => parseEnv({ ...base, WHATSAPP_SANDBOX: '1', EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32), EVOLUTION_API_KEY: evo.EVOLUTION_API_KEY })).toThrow(/juntas/);
  });
  it('worker: URL e chave juntas ou nenhuma; não exige o segredo do webhook', () => {
    const w = { NODE_ENV: 'development', DATABASE_URL, APP_URL: 'http://localhost:3000', ENCRYPTION_KEY: KEY, DATA_DIR: './data', EMAIL_FROM: 'NutriDebby <x@y.dev>', MAILPIT_URL: 'http://localhost:8025' };
    expect(parseWorkerEnv({ ...w, EVOLUTION_API_URL: evo.EVOLUTION_API_URL, EVOLUTION_API_KEY: evo.EVOLUTION_API_KEY }).EVOLUTION_API_KEY).toBe(evo.EVOLUTION_API_KEY);
    expect(() => parseWorkerEnv({ ...w, EVOLUTION_API_KEY: evo.EVOLUTION_API_KEY })).toThrow(/juntas/);
  });
});

describe('push (Plano 06, D7): chave pública do VAPID no app', () => {
  it('opcional; vazia conta como ausente; fora do formato → erro com o nome', () => {
    const publica = webpush.generateVAPIDKeys().publicKey; // só para o teste
    expect(parseEnv(base).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(parseEnv({ ...base, VAPID_PUBLIC_KEY: '' }).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(parseEnv({ ...base, VAPID_PUBLIC_KEY: publica }).VAPID_PUBLIC_KEY).toBe(publica);
    expect(() => parseEnv({ ...base, VAPID_PUBLIC_KEY: `${publica}=` })).toThrow(/VAPID_PUBLIC_KEY deve ser/);
    expect(() => parseEnv({ ...base, VAPID_PUBLIC_KEY: 'curta' })).toThrow(/VAPID_PUBLIC_KEY/);
  });
});

describe('push (INT-03): VAPID no worker', () => {
  const w = { NODE_ENV: 'development', DATABASE_URL, APP_URL: 'http://localhost:3000', ENCRYPTION_KEY: KEY, DATA_DIR: './data', EMAIL_FROM: 'NutriDebby <x@y.dev>', MAILPIT_URL: 'http://localhost:8025' };
  // par gerado na hora, só para este teste (nunca gravado em arquivo)
  const par = webpush.generateVAPIDKeys();
  const vapid = { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'mailto:suporte@exemplo.com' };
  it('as três juntas ou nenhuma; formato das chaves e do subject', () => {
    expect(parseWorkerEnv({ ...w, ...vapid }).VAPID_SUBJECT).toBe('mailto:suporte@exemplo.com');
    expect(parseWorkerEnv({ ...w, ...vapid, VAPID_SUBJECT: 'https://nutridebby.com.br' }).VAPID_PUBLIC_KEY).toBe(par.publicKey);
    expect(parseWorkerEnv(w).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(parseWorkerEnv({ ...w, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }).VAPID_SUBJECT).toBeUndefined(); // linhas em branco do .env.example
    expect(() => parseWorkerEnv({ ...w, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY })).toThrow(/juntas/);
    expect(() => parseWorkerEnv({ ...w, ...vapid, VAPID_SUBJECT: 'suporte@exemplo.com' })).toThrow(/mailto:/);
    expect(() => parseWorkerEnv({ ...w, ...vapid, VAPID_SUBJECT: 'http://exemplo.com' })).toThrow(/mailto:/);
    expect(() => parseWorkerEnv({ ...w, ...vapid, VAPID_PRIVATE_KEY: 'curta' })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(() => parseWorkerEnv({ ...w, ...vapid, VAPID_PUBLIC_KEY: `${par.publicKey}=` })).toThrow(/VAPID_PUBLIC_KEY deve ser/);
  });
  it('chave pública e privada do mesmo par (senão todo push volta 403); a mensagem não repete as chaves', () => {
    const outro = webpush.generateVAPIDKeys();
    let msg = '';
    try {
      parseWorkerEnv({ ...w, ...vapid, VAPID_PRIVATE_KEY: outro.privateKey });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/não são do mesmo par/);
    expect(msg.includes(outro.privateKey) || msg.includes(par.publicKey), 'a mensagem não pode trazer as chaves').toBe(false);
  });
});
