import { randomBytes } from 'node:crypto';
export const environment = {
  NODE_ENV: 'test',
  JWT_SIGNING_KEY: randomBytes(32).toString('base64'),
  PORT: '3001',
  DATABASE_URL:
    'postgresql://candidly:example_only@127.0.0.1:5432/candidly_test',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  CORS_ORIGIN: 'http://localhost:3000',
};
