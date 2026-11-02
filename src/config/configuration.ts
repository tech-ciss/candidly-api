import { validateEnvironment } from './env.validation.js';

export interface AppConfiguration {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  swaggerEnabled: boolean;
}

export default function configuration(): { app: AppConfiguration } {
  const env = validateEnvironment(process.env);
  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      corsOrigins: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
      swaggerEnabled: env.NODE_ENV !== 'production',
    },
  };
}
