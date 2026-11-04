import type { NestExpressApplication } from '@nestjs/platform-express';
import { observeHttp } from '../common/observability/http-observability.js';
import { proxyTrust } from './proxy-trust.js';
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
  app.use(observeHttp);
  const expressApp = app as NestExpressApplication;
  expressApp.set(
    'trust proxy',
    proxyTrust(app.get(ConfigService).getOrThrow<string>('TRUSTED_PROXY_IP')),
  );
  expressApp.set('x-powered-by', false);
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Candidly-CSRF'],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  });
  const limit = app
    .get(ConfigService)
    .getOrThrow<number>('HTTP_BODY_LIMIT_BYTES');
  expressApp.useBodyParser('json', { limit, strict: true, inflate: false });
  expressApp.useBodyParser('urlencoded', {
    limit,
    extended: false,
    parameterLimit: 20,
    inflate: false,
  });
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
      .addBearerAuth()
      .addCookieAuth('candidly_refresh')
      .addTag('health', 'Disponibilité de l’application et de ses dépendances.')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }
}
