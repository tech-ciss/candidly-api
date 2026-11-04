import { isIP } from 'node:net';
export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  HTTP_BODY_LIMIT_BYTES: number;
  TRUSTED_PROXY_IP: string;
  JWT_SIGNING_KEY: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_SECONDS: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  CORS_ORIGIN: string;
  FRONTEND_URL: string;
  EMAIL_TRANSPORT: 'local' | 'disabled';
  EMAIL_LOCAL_DIRECTORY: string;
  EMAIL_VERIFICATION_TTL_SECONDS: number;
  EMAIL_RESEND_COOLDOWN_SECONDS: number;
  EMAIL_RETRY_INTERVAL_SECONDS: number;
  PASSWORD_RESET_TTL_SECONDS: number;
  PASSWORD_RESET_COOLDOWN_SECONDS: number;
}

export class EnvironmentValidationError extends Error {}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const errors: string[] = [];
  const required = (name: string): string => {
    const value = input[name];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${name} est obligatoire et doit être une chaîne non vide`);
      return '';
    }
    return value.trim();
  };
  const port = (name: string): number => {
    const value = required(name);
    const parsed = Number(value);
    if (
      !/^\d+$/.test(value) ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > 65535
    ) {
      errors.push(`${name} doit être un port entier entre 1 et 65535`);
    }
    return parsed;
  };
  const nodeEnv = required('NODE_ENV');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV doit être development, test ou production');
  }
  const apiPort = port('PORT');
  const databaseUrl = required('DATABASE_URL');
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.pathname.length <= 1
    ) {
      throw new Error();
    }
  } catch {
    errors.push(
      'DATABASE_URL doit être une URL PostgreSQL valide avec utilisateur, hôte et base',
    );
  }
  const redisHost = required('REDIS_HOST');
  if (!/^[a-zA-Z0-9._:-]+$/.test(redisHost)) {
    errors.push(
      'REDIS_HOST doit être un nom d’hôte ou une adresse IP sans URL',
    );
  }
  const redisPort = port('REDIS_PORT');
  const corsOrigin = required('CORS_ORIGIN');
  for (const origin of corsOrigin.split(',').map((value) => value.trim())) {
    try {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== origin ||
        url.username ||
        url.password ||
        (nodeEnv === 'production' && url.protocol !== 'https:')
      ) {
        throw new Error();
      }
    } catch {
      errors.push(
        'CORS_ORIGIN doit contenir des origines HTTP(S) explicites séparées par des virgules, sans chemin ni joker',
      );
    }
  }
  const frontendUrl = input.FRONTEND_URL ?? 'http://localhost:3000';
  try {
    if (typeof frontendUrl !== 'string') throw new Error();
    const url = new URL(frontendUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== frontendUrl ||
      url.username ||
      url.password
    )
      throw new Error();
    if (nodeEnv === 'production' && url.protocol !== 'https:')
      throw new Error();
  } catch {
    errors.push(
      'FRONTEND_URL doit être une origine HTTP(S) explicite (HTTPS en production)',
    );
  }
  const transport =
    input.EMAIL_TRANSPORT ?? (nodeEnv === 'production' ? 'disabled' : 'local');
  if (
    typeof transport !== 'string' ||
    !['local', 'disabled'].includes(transport) ||
    (nodeEnv === 'production' && transport === 'local')
  )
    errors.push('EMAIL_TRANSPORT invalide ou local interdit en production');
  const directory = input.EMAIL_LOCAL_DIRECTORY ?? '.local-emails';
  if (typeof directory !== 'string' || directory.trim() === '')
    errors.push('EMAIL_LOCAL_DIRECTORY doit être non vide');
  const positiveInteger = (
    name: string,
    fallback: number,
    max: number,
  ): number => {
    const value = input[name] ?? String(fallback);
    const number = Number(value);
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > max
    )
      errors.push(
        name + ' doit être un entier positif dans les limites documentées',
      );
    return number;
  };
  const ttl = positiveInteger('EMAIL_VERIFICATION_TTL_SECONDS', 86400, 604800);
  const cooldown = positiveInteger('EMAIL_RESEND_COOLDOWN_SECONDS', 60, 86400);
  const retry = positiveInteger('EMAIL_RETRY_INTERVAL_SECONDS', 30, 3600);
  const resetTtl = positiveInteger('PASSWORD_RESET_TTL_SECONDS', 1800, 86400);
  const resetCooldown = positiveInteger(
    'PASSWORD_RESET_COOLDOWN_SECONDS',
    60,
    86400,
  );
  const bodyLimit = positiveInteger('HTTP_BODY_LIMIT_BYTES', 16384, 1048576);
  const trustedProxy = input.TRUSTED_PROXY_IP ?? '';
  if (
    typeof trustedProxy !== 'string' ||
    (trustedProxy !== '' && isIP(trustedProxy) === 0)
  )
    errors.push('TRUSTED_PROXY_IP doit être vide ou une adresse IP exacte');
  const signingKey = required('JWT_SIGNING_KEY');
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signingKey) ||
    Buffer.from(signingKey, 'base64').length < 32 ||
    Buffer.from(signingKey, 'base64').toString('base64') !== signingKey
  )
    errors.push(
      'JWT_SIGNING_KEY doit être du base64 canonique de 32 octets minimum',
    );
  const jwtIssuer = input.JWT_ISSUER ?? 'candidly-api';
  const jwtAudience = input.JWT_AUDIENCE ?? 'candidly-web';
  for (const [name, value] of [
    ['JWT_ISSUER', jwtIssuer],
    ['JWT_AUDIENCE', jwtAudience],
  ] as const) {
    if (
      typeof value !== 'string' ||
      value.trim() !== value ||
      value.length < 1 ||
      value.length > 200
    )
      errors.push(
        name + ' doit être une chaîne explicite de 1 à 200 caractères',
      );
  }
  const accessTtl = positiveInteger('ACCESS_TOKEN_TTL_SECONDS', 900, 3600);
  const refreshTtl = positiveInteger(
    'REFRESH_TOKEN_TTL_SECONDS',
    2592000,
    7776000,
  );
  if (accessTtl > refreshTtl)
    errors.push(
      'ACCESS_TOKEN_TTL_SECONDS ne doit pas dépasser REFRESH_TOKEN_TTL_SECONDS',
    );
  if (
    typeof frontendUrl === 'string' &&
    !corsOrigin
      .split(',')
      .map((value) => value.trim())
      .includes(frontendUrl)
  )
    errors.push('FRONTEND_URL doit être autorisée dans CORS_ORIGIN');
  // Seuls les noms et règles sont affichés, jamais les valeurs reçues.
  if (errors.length > 0) {
    throw new EnvironmentValidationError(
      `Configuration invalide : ${errors.join('; ')}.`,
    );
  }
  return {
    NODE_ENV: nodeEnv as Environment['NODE_ENV'],
    PORT: apiPort,
    HTTP_BODY_LIMIT_BYTES: bodyLimit,
    TRUSTED_PROXY_IP: trustedProxy as string,
    JWT_SIGNING_KEY: signingKey,
    JWT_ISSUER: jwtIssuer as string,
    JWT_AUDIENCE: jwtAudience as string,
    ACCESS_TOKEN_TTL_SECONDS: accessTtl,
    REFRESH_TOKEN_TTL_SECONDS: refreshTtl,
    DATABASE_URL: databaseUrl,
    REDIS_HOST: redisHost,
    REDIS_PORT: redisPort,
    CORS_ORIGIN: corsOrigin,
    FRONTEND_URL: frontendUrl as string,
    EMAIL_TRANSPORT: transport as Environment['EMAIL_TRANSPORT'],
    EMAIL_LOCAL_DIRECTORY: directory as string,
    EMAIL_VERIFICATION_TTL_SECONDS: ttl,
    EMAIL_RESEND_COOLDOWN_SECONDS: cooldown,
    EMAIL_RETRY_INTERVAL_SECONDS: retry,
    PASSWORD_RESET_TTL_SECONDS: resetTtl,
    PASSWORD_RESET_COOLDOWN_SECONDS: resetCooldown,
  };
}
