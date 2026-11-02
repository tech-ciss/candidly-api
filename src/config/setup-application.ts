import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import type { AppConfiguration } from './configuration.js';

export function setupApplication(app: INestApplication): void {
  const config = app.get(ConfigService).getOrThrow<AppConfiguration>('app');
  // Un seul préfixe, sans versionnement URI supplémentaire.
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  if (config.swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Candidly API')
      .setDescription('API REST du Personal Career CRM Candidly.')
      .setVersion('1.0')
      .addTag('health', 'Disponibilité de l’application et de ses dépendances.')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }
}
