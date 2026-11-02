import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponseDto } from './error.dto.js';

const messages: Record<number, string> = {
  400: 'La requête est invalide.',
  401: 'Authentification requise.',
  403: 'Accès interdit.',
  404: 'Ressource introuvable.',
  405: 'Méthode non autorisée.',
  409: 'La requête est en conflit avec la ressource.',
  422: 'Les données fournies sont invalides.',
  429: 'Trop de requêtes. Réessayer plus tard.',
  500: 'Une erreur interne est survenue.',
  503: 'Un service est temporairement indisponible.',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ErrorResponseDto = {
      success: false,
      error: {
        code:
          typeof HttpStatus[status] === 'string'
            ? HttpStatus[status]
            : 'HTTP_ERROR',
        message: messages[status] ?? 'La requête ne peut pas être traitée.',
      },
      timestamp: new Date().toISOString(),
      // Ne pas recopier la query string (tokens ou autres valeurs privées).
      path: request.path,
    };
    const payload: unknown =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    if (
      status === 503 &&
      typeof payload === 'object' &&
      payload !== null &&
      'services' in payload
    ) {
      const services: unknown = payload.services;
      if (
        typeof services === 'object' &&
        services !== null &&
        'database' in services &&
        'redis' in services &&
        ['up', 'down'].includes(String(services.database)) &&
        ['up', 'down'].includes(String(services.redis))
      ) {
        body.services = {
          database: services.database as 'up' | 'down',
          redis: services.redis as 'up' | 'down',
        };
      }
    }
    if (status >= 500) this.logger.error(`Requête échouée : HTTP ${status}.`);
    response.status(status).json(body);
  }
}
