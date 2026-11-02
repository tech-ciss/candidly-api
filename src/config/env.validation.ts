export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  CORS_ORIGIN: string;
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
        url.password
      ) {
        throw new Error();
      }
    } catch {
      errors.push(
        'CORS_ORIGIN doit contenir des origines HTTP(S) explicites séparées par des virgules, sans chemin ni joker',
      );
    }
  }
  // Seuls les noms et règles sont affichés, jamais les valeurs reçues.
  if (errors.length > 0) {
    throw new EnvironmentValidationError(
      `Configuration invalide : ${errors.join('; ')}.`,
    );
  }
  return {
    NODE_ENV: nodeEnv as Environment['NODE_ENV'],
    PORT: apiPort,
    DATABASE_URL: databaseUrl,
    REDIS_HOST: redisHost,
    REDIS_PORT: redisPort,
    CORS_ORIGIN: corsOrigin,
  };
}
