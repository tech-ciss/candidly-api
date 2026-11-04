import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { setupApplication } from './config/setup-application.js';
import {
  StructuredLogger,
  structuredLog,
} from './common/observability/structured-logger.js';
Logger.overrideLogger(new StructuredLogger());

async function bootstrap(): Promise<void> {
  // Import dynamique pour intercepter aussi les erreurs de validation initiales.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: new StructuredLogger(),
  });
  try {
    setupApplication(app);
    await app.listen(
      app.get(ConfigService).getOrThrow<number>('PORT'),
      '127.0.0.1',
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch(() => {
  structuredLog({
    level: 'error',
    module: 'Application',
    event: 'application.bootstrap_failed',
  });
  process.exitCode = 1;
});
