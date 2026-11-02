import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { setupApplication } from './config/setup-application.js';
import { EnvironmentValidationError } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  // Import dynamique pour intercepter aussi les erreurs de validation initiales.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { abortOnError: false });
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

bootstrap().catch((error: unknown) => {
  // Les erreurs de configuration détaillent seulement les noms des variables.
  // Les exceptions de drivers ne doivent jamais être journalisées ici.
  Logger.error(
    error instanceof EnvironmentValidationError
      ? error.message
      : 'Démarrage impossible. Vérifier les variables d’environnement et la disponibilité de PostgreSQL.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
