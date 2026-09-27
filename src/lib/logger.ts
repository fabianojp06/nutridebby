import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'nutridebby' },
  redact: {
    paths: [
      'password',
      'newPassword',
      'token',
      'url',
      '*.password',
      '*.newPassword',
      '*.token',
      'req.headers.cookie',
      'req.headers.authorization',
    ],
    censor: '[removido]',
  },
});
